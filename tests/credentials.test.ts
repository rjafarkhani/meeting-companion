import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertPrivateLocation, CredentialVault, type SecretProtection } from '../electron/credentials';

// Only synthetic keys and a test-only cipher. The Electron smoke test separately
// verifies persistence with the real Windows account-backed protection.
const openai = 'sk-synthetic-vault-test-never-sent';
const deepgram = 'synthetic-deepgram-test-never-sent';
function protection(): SecretProtection {
  const encryptionKey = randomBytes(32);
  return { description: 'Test-only cipher', available: async () => true,
    encrypt: async text => { const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce); const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]); },
    decrypt: async bytes => { const decipher = createDecipheriv('aes-256-gcm', encryptionKey, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return { result: decipher.update(bytes.subarray(28)).toString() + decipher.final().toString(), shouldReEncrypt: false }; } };
}

test('only ciphertext is persisted and both keys restore in a fresh vault without exposing secrets in status', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'companion-vault-')), driver = protection();
  const first = new CredentialVault(profile, driver); await first.initialize(false);
  await first.update({ openai, deepgram }, true);
  const bytes = await readFile(first.file); assert.equal(bytes.includes(openai), false); assert.equal(bytes.includes(deepgram), false);
  assert.deepEqual(await readdir(first.directory), ['credentials.v1.enc']);
  assert.equal(JSON.stringify(first.status()).includes(openai), false);
  first.clearMemory(); assert.equal(first.get('openai'), '');
  const restored = new CredentialVault(profile, driver); await restored.initialize(false);
  assert.equal(restored.get('openai'), openai); assert.equal(restored.get('deepgram'), deepgram);
  assert.deepEqual(restored.status().saved, { openai: true, deepgram: true });
});

test('a backend without protected storage refuses persistence and allows explicit memory-only use', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'companion-vault-'));
  const vault = new CredentialVault(profile, { ...protection(), available: async () => false }); await vault.initialize(false);
  await assert.rejects(vault.update({ openai }, true), /Protected storage is unavailable/);
  assert.equal(vault.get('openai'), '');
  await vault.update({ openai }, false); assert.equal(vault.get('openai'), openai); assert.equal(vault.status().saved.openai, false);
  await assert.rejects(readFile(vault.file), { code: 'ENOENT' });
});

test('corrupt or differently protected saved keys are not returned and do not overwrite valid in-memory keys on a failed save', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'companion-vault-')), driver = protection();
  const first = new CredentialVault(profile, driver); await first.initialize(false); await first.update({ openai }, true);
  const wrongAccount = new CredentialVault(profile, protection()); await wrongAccount.initialize(false);
  assert.equal(wrongAccount.get('openai'), ''); assert.match(wrongAccount.status().warning, /could not be unlocked/);
  const existing = await readFile(first.file);
  driver.encrypt = async () => { throw new Error('Simulated encryption failure'); };
  await assert.rejects(first.update({ openai: 'sk-another-synthetic-test-only' }, true), /Could not save encrypted keys/);
  assert.deepEqual(await readFile(first.file), existing); assert.equal(first.get('openai'), openai);
});

test('session-only use and explicit removal delete saved copies, and malformed keys never change a saved vault', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'companion-vault-')); const vault = new CredentialVault(profile, protection());
  await vault.initialize(false); await vault.update({ openai, deepgram }, true);
  await assert.rejects(vault.update({ openai: 'invalid' }, true), /valid OpenAI/); assert.equal(vault.get('openai'), openai);
  await vault.update({}, false); await assert.rejects(readFile(vault.file), { code: 'ENOENT' }); assert.equal(vault.get('openai'), openai);
  await vault.update({ openai: '', deepgram: '' }, true); assert.equal(vault.get('openai'), ''); assert.equal(vault.get('deepgram'), '');
});

test('legacy encrypted keys migrate only after encryption succeeds and old encrypted files are removed', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'companion-vault-')), driver = protection();
  await writeFile(join(profile, 'credential.bin'), await driver.encrypt(openai));
  await writeFile(join(profile, 'deepgram-credential.bin'), await driver.encrypt(deepgram));
  const vault = new CredentialVault(profile, driver); await vault.initialize(true);
  assert.equal(vault.get('openai'), openai); assert.equal(vault.get('deepgram'), deepgram);
  await assert.rejects(readFile(join(profile, 'credential.bin')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(profile, 'deepgram-credential.bin')), { code: 'ENOENT' });
  assert.ok((await readFile(vault.file)).length);
});

test('persistence is refused inside a source checkout even when application data is overridden', async () => {
  const checkout = await mkdtemp(join(tmpdir(), 'companion-checkout-')); await mkdir(join(checkout, '.git'));
  await assert.rejects(assertPrivateLocation(join(checkout, 'nested', 'profile')), /source-control checkout/);
  const vault = new CredentialVault(join(checkout, 'profile'), protection()); await vault.initialize(false);
  assert.equal(vault.status().secureStorage, false); await assert.rejects(vault.update({ openai }, true));
  await assert.rejects(readFile(vault.file), { code: 'ENOENT' });
});
