import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { CredentialProvider, CredentialStatus } from '../src/shared';

export interface SecretProtection {
  available(): Promise<boolean>;
  description: string;
  encrypt(text: string): Promise<Buffer>;
  decrypt(bytes: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}
type Keys = Partial<Record<CredentialProvider, string>>;
const providers: CredentialProvider[] = ['openai', 'deepgram'];
export function validateKey(provider: CredentialProvider, value: unknown): string {
  if (typeof value !== 'string' || value.length > 1000) throw new Error('Invalid API key.');
  const candidate = value.trim();
  const valid = provider === 'openai' ? /^sk-[\w-]{10,}$/.test(candidate) : /^[a-zA-Z0-9_-]{10,1000}$/.test(candidate);
  if (candidate && !valid) throw new Error(`Enter a valid ${provider === 'openai' ? 'OpenAI' : 'Deepgram'} API key.`);
  return candidate;
}

/** Refuse credential persistence in a source checkout, even with --user-data-dir.
 * Resolve existing parent links so a symlink into a checkout is also rejected. */
export async function assertPrivateLocation(directory: string): Promise<void> {
  let ancestor = resolve(directory), suffix: string[] = [];
  while (true) {
    try { ancestor = join(await realpath(ancestor), ...suffix.reverse()); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(ancestor); if (parent === ancestor) throw error;
      suffix.push(ancestor.slice(parent.length).replace(/^[/\\]/, '')); ancestor = parent;
    }
  }
  for (let current = ancestor; ; current = dirname(current)) {
    for (const marker of ['.git', '.hg', '.svn']) {
      try { await lstat(join(current, marker)); throw new Error('Credentials cannot be saved inside a source-control checkout. Use the default application data directory.'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    if (dirname(current) === current) break;
  }
}

export class CredentialVault {
  private keys: Keys = {};
  private persisted: Keys = {};
  private secure = false;
  private warning = '';
  readonly directory: string;
  readonly file: string;
  constructor(private profile: string, private protection: SecretProtection) {
    this.directory = join(profile, 'secrets'); this.file = join(this.directory, 'credentials.v1.enc');
  }
  get(provider: CredentialProvider) { return this.keys[provider] || ''; }
  status(): CredentialStatus {
    return { secureStorage: this.secure, protection: this.protection.description, warning: this.warning,
      saved: { openai: !!this.persisted.openai, deepgram: !!this.persisted.deepgram } };
  }
  async initialize(rememberLegacy: boolean): Promise<void> {
    try {
      await assertPrivateLocation(this.directory);
      this.secure = await this.protection.available();
      if (!this.secure) { this.warning = 'Protected credential storage is unavailable. Keys can be used for this launch only.'; return; }
      let bytes: Buffer;
      try { bytes = await readFile(this.file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await this.migrate(rememberLegacy); return; }
      if (bytes.length > 20000) throw new Error('Invalid credential file.');
      const decrypted = await this.protection.decrypt(bytes);
      const record = JSON.parse(decrypted.result);
      if (record.version !== 1) throw new Error('Invalid credential version.');
      const restored: Keys = {};
      for (const provider of providers) if (record[provider]) restored[provider] = validateKey(provider, record[provider]);
      this.keys = restored; this.persisted = { ...restored };
      if (decrypted.shouldReEncrypt) {
        try { await this.write(restored); }
        catch { this.warning = 'Keys unlocked, but refreshed encryption could not be saved. Save them again in Settings.'; }
      }
    } catch {
      // Never propagate cryptography/parser errors containing secret input to IPC or logs.
      this.warning = 'Saved keys could not be unlocked or their storage location is unsafe. Enter them again, or use keys for this launch only.';
    }
  }
  async update(changes: Keys, persist: boolean): Promise<void> {
    const next = { ...this.keys };
    for (const provider of providers) if (changes[provider] !== undefined) {
      const value = validateKey(provider, changes[provider]);
      if (value) next[provider] = value; else delete next[provider];
    }
    this.warning = '';
    if (persist && Object.keys(next).length) {
      if (!this.secure) throw new Error('Protected storage is unavailable. Choose keys for this launch only.');
      try { await this.write(next); } catch { throw new Error('Could not save encrypted keys. Retry or choose keys for this launch only.'); }
    } else {
      // An explicit session-only choice or key removal also forgets saved copies.
      try { await this.remove(this.file); await this.removeLegacy(); }
      catch { throw new Error('Saved keys could not be removed. Check access to the application data directory.'); }
    }
    this.keys = next; this.persisted = persist ? { ...next } : {};
  }
  clearMemory() { this.keys = {}; this.persisted = {}; }
  private async write(keys: Keys) {
    await assertPrivateLocation(this.directory);
    const encrypted = await this.protection.encrypt(JSON.stringify({ version: 1, ...keys }));
    // Only ciphertext ever touches disk, including the atomic-write temporary file.
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, `credentials-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(encrypted); await file.sync(); } finally { await file.close(); }
      await rename(temporary, this.file);
    } finally { await this.remove(temporary); }
    try { await this.removeLegacy(); }
    catch { this.warning = 'Keys saved securely, but an older encrypted copy could not be removed from application data.'; }
  }
  private async migrate(enabled: boolean) {
    if (!enabled) return;
    const restored: Keys = {};
    for (const [provider, filename] of [['openai', 'credential.bin'], ['deepgram', 'deepgram-credential.bin']] as const) {
      try {
        const bytes = await readFile(join(this.profile, filename));
        if (bytes.length > 20000) throw new Error('Invalid legacy credential.');
        restored[provider] = validateKey(provider, (await this.protection.decrypt(bytes)).result);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    if (Object.keys(restored).length) { await this.write(restored); this.keys = restored; this.persisted = { ...restored }; }
  }
  private async remove(file: string) { try { await unlink(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
  private async removeLegacy() { await this.remove(join(this.profile, 'credential.bin')); await this.remove(join(this.profile, 'deepgram-credential.bin')); }
}
