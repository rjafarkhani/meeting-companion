import { _electron as electron } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

await mkdir('test-results', { recursive: true });
const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '0' }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.COMPANION_EXE;
const app = await electron.launch({ executablePath, args: [...(executablePath ? [] : ['.']), `--user-data-dir=${resolve('test-results/profile')}`], env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const waitText = async text => page.getByText(text, { exact: true }).first().waitFor();
try {
  await waitText('A little context. A clearer conversation.');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox), true);
  await page.screenshot({ path: 'test-results/welcome.png' });
  await page.getByRole('button', { name: 'Run demo', exact: true }).click();
  await waitText('p99 is a tail-latency measure');
  // Exercise the real Chromium AudioWorklet with a synthetic oscillator. The worklet
  // outputs silence; this opens no microphone, captures no device, and sends no data.
  const pcm = await page.evaluate(async () => {
    const context = new AudioContext({ sampleRate: 24000 });
    let oscillator;
    try {
      await context.audioWorklet.addModule(new URL('pcm-worklet.js', document.baseURI).href);
      const processor = new AudioWorkletNode(context, 'pcm-processor');
      oscillator = context.createOscillator(); const gain = context.createGain(); gain.gain.value = .02;
      oscillator.connect(gain).connect(processor).connect(context.destination); oscillator.start();
      await context.resume();
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('No synthetic PCM audio received')), 3000);
        processor.port.onmessage = ({ data }) => { clearTimeout(timer); resolve({ bytes: data.data.byteLength, rms: data.rms, rate: context.sampleRate }); };
      });
    } finally { oscillator?.stop(); await context.close(); }
  });
  assert.equal(pcm.bytes, 4800); assert.equal(pcm.rate, 24000); assert.ok(pcm.rms > .008);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await waitText('Capture paused');
  const roster = page.getByRole('group', { name: 'Select a speaker' });
  await roster.getByRole('button', { name: /^Speaker 1 / }).click();
  assert.equal(await page.locator('.insight-card').count(), 2);
  // Draft recap must not reveal decisions from unplayed future demo moments.
  await page.getByRole('button', { name: 'Meeting recap', exact: true }).click();
  await waitText('No confirmed decisions captured.');
  await page.getByRole('button', { name: 'Live workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Resume session', exact: true }).click();
  await page.getByRole('button', { name: 'Next moment', exact: true }).click();
  assert.equal(await roster.getByRole('button', { name: /^Speaker 1 / }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.insight-card').count(), 2);
  await page.getByRole('button', { name: 'Follow latest speaker', exact: true }).click();
  assert.equal(await roster.getByRole('button', { name: /^Speaker 2 / }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Next moment', exact: true }).click();
  assert.equal(await roster.getByRole('button', { name: /^Speaker 3 / }).getAttribute('aria-pressed'), 'true');
  // Selecting a transcript speaker holds a snapshot while more speech arrives.
  await page.getByRole('button', { name: 'Show insights for Speaker 1', exact: true }).click();
  const heldTitle = await page.locator('.insight-card h3').first().textContent();
  await page.getByRole('button', { name: 'Next moment', exact: true }).click();
  assert.equal(await page.locator('.insight-card h3').first().textContent(), heldTitle);
  await page.getByRole('button', { name: /^Load 2 new/ }).click();
  assert.notEqual(await page.locator('.insight-card h3').first().textContent(), heldTitle);
  const answer = page.locator('.insight-card').first();
  assert.equal(await answer.getAttribute('class'), 'insight-card answer response-card');
  await answer.locator('.answered-question').waitFor();
  assert.match(await answer.locator('.answered-question').textContent(), /What happens when analytics is down for an hour\?/);
  await page.screenshot({ path: 'test-results/answer-summary.png' });
  const summaryBounds = await answer.locator('.response-text').boundingBox();
  const feedBounds = await page.locator('.insight-feed').boundingBox();
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  assert.ok(summaryBounds && feedBounds && summaryBounds.y + summaryBounds.height < Math.min(viewportHeight, feedBounds.y + feedBounds.height));
  const originalBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1080, height: 720 }));
  await page.screenshot({ path: 'test-results/answer-compact.png' });
  await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), originalBounds);
  const answerButton = answer.getByRole('button', { name: /^Show details:/ });
  assert.equal(await answerButton.getAttribute('aria-expanded'), 'false');
  await answerButton.click();
  await answer.getByRole('region', { name: /^Details:/ }).waitFor();
  assert.match(await answer.locator('.card-detail').textContent(), /exact recovery time depends/);
  assert.equal(await page.getByRole('button', { name: 'Follow latest speaker', exact: true }).getAttribute('aria-pressed'), 'false');
  await page.screenshot({ path: 'test-results/answer-details.png' });
  await answer.getByRole('button', { name: /^Hide details:/ }).click();
  await page.getByRole('button', { name: 'Answers', exact: true }).click();
  assert.equal(await page.locator('.insight-card').count(), 1);
  await page.getByRole('button', { name: 'Toggle quiet mode' }).click();
  assert.equal(await page.locator('.insight-card.answer').count(), 1);
  await page.getByRole('button', { name: 'Toggle quiet mode' }).click();
  await page.getByRole('button', { name: 'All insights', exact: true }).click();
  await page.getByRole('button', { name: /^View 1 answer \/ solution from other speakers/ }).click();
  assert.equal(await roster.getByRole('button', { name: /^All speakers/ }).getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('.insight-card').nth(0).getAttribute('class'), /answer response-card/);
  assert.match(await page.locator('.insight-card').nth(1).getAttribute('class'), /solution response-card/);
  await roster.getByRole('button', { name: /^Speaker 1 / }).click();
  await page.getByRole('button', { name: 'Next insight page' }).click();
  assert.equal(await page.locator('.insight-card h3').first().textContent(), heldTitle);
  await page.getByRole('button', { name: 'Edit speaker', exact: true }).click();
  await page.getByLabel('Speaker name', { exact: true }).fill('Ramya');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await page.getByLabel('This is me', { exact: true }).check();
  assert.equal(await page.getByRole('button', { name: 'Show insights for Ramya (you)', exact: true }).count(), 2);
  await page.getByRole('button', { name: 'Close speaker details', exact: true }).click();
  for (let i = 0; i < 3; i++) {
    if (await page.getByRole('button', { name: 'Next moment', exact: true }).isVisible()) await page.getByRole('button', { name: 'Next moment', exact: true }).click();
  }
  await waitText('Session complete');
  assert.equal(await page.locator('.transcript-line').count(), 7);
  await roster.getByRole('button', { name: /^All speakers/ }).click();
  assert.match(await page.locator('.insight-card').nth(0).getAttribute('class'), /answer response-card/);
  assert.match(await page.locator('.insight-card').nth(1).getAttribute('class'), /solution response-card/);
  await page.getByRole('button', { name: 'Solutions', exact: true }).click();
  assert.equal(await page.locator('.insight-card.solution').count(), 1);
  await page.getByRole('button', { name: 'All insights', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search insights' }).fill('analytics is down');
  assert.equal(await page.locator('.insight-card.answer').count(), 1);
  await page.getByRole('textbox', { name: 'Search insights' }).fill('');
  assert.equal(await page.locator('.insight-feed').evaluate(el => el.scrollTop), 0);
  const filter = page.getByRole('button', { name: 'Risks', exact: true }); await filter.click();
  assert.equal(await page.locator('.insight-card').count(), 2);
  await page.getByRole('button', { name: 'Next insight page' }).click();
  assert.equal(await page.locator('.insight-card').count(), 1);
  await page.getByRole('button', { name: 'All insights', exact: true }).click();
  const firstPin = page.getByRole('button', { name: /^Pin / }).first(); await firstPin.click();
  await page.getByRole('button', { name: 'Show pinned insights', exact: true }).click();
  assert.equal(await page.locator('.insight-card').count(), 1);
  await page.getByRole('button', { name: 'All insights', exact: true }).click();
  await page.getByRole('button', { name: 'View context', exact: true }).first().click();
  assert.equal(await page.locator('.transcript-line.highlighted').count(), 1);
  await page.screenshot({ path: 'test-results/workspace.png' });
  // A repeated acoustic label can be matched to an existing person.
  await roster.getByRole('button', { name: /^Speaker 3 / }).click();
  await page.getByRole('button', { name: 'Edit speaker', exact: true }).click();
  const existingId = await page.getByLabel('Match speaker with an existing person').locator('option').filter({ hasText: 'Ramya (you)' }).getAttribute('value');
  await page.getByLabel('Match speaker with an existing person').selectOption(existingId);
  assert.equal(await roster.locator('.speaker-chip').count(), 3); // All + two distinct people
  assert.equal(await page.getByRole('button', { name: 'Show insights for Ramya (you)', exact: true }).count(), 5);
  await page.getByRole('button', { name: 'View recap', exact: true }).click();
  await waitText('Prototype an outbox with idempotent consumers. The 200 ms latency target is not yet committed.');
  await page.getByRole('button', { name: 'Explore pattern', exact: true }).click();
  await waitText('Database + outbox');
  await page.screenshot({ path: 'test-results/recap.png' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await waitText('Privacy, by default');
  // Main-process consent check must run even without a configured key.
  const rejection = await page.evaluate(async () => {
    try { await window.companion.start({ consent: false }); return 'accepted'; } catch (e) { return e.message; }
  });
  assert.match(rejection, /consent/);
  await page.screenshot({ path: 'test-results/settings.png' });
  // No screen or media permission while idle, and unsafe link protocols are rejected.
  const blocked = await page.evaluate(async () => {
    try { await window.companion.openSource('file:///C:/Windows'); return false; } catch { return true; }
  }); assert.equal(blocked, true);
  await page.getByRole('button', { name: 'New session', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'New session', exact: true }).click();
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await page.getByRole('button', { name: 'Start listening', exact: true }).click();
  await waitText('Add your OpenAI API key, save settings, then start a live session.');
  // A synthetic key unlocks only the local consent screen; never start a cloud session.
  await page.getByLabel('OpenAI API key').fill('sk-synthetic-test-only-never-sent');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await waitText('Key configured');
  const config = await page.evaluate(() => window.companion.loadSettings());
  assert.equal(config.hasKey, true); assert.equal('key' in config, false); assert.equal(config.settings.rememberKey, false);
  await page.getByLabel('Transcription service').selectOption('deepgram');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await waitText('Settings saved.');
  await page.getByRole('button', { name: 'Live workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Start listening', exact: true }).click();
  await waitText('Add your Deepgram API key and save settings to recognize speakers.');
  await page.getByLabel('Deepgram API key').fill('synthetic-deepgram-key-never-sent');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await waitText('Deepgram key configured');
  const updated = await page.evaluate(() => window.companion.loadSettings());
  assert.equal(updated.hasDeepgramKey, true); assert.equal('deepgramKey' in updated, false);
  await page.getByRole('button', { name: 'Live workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Start listening', exact: true }).click();
  const consent = page.getByRole('dialog'); await consent.waitFor();
  assert.equal(await consent.getByRole('button', { name: 'Start listening', exact: true }).isDisabled(), true);
  assert.match(await consent.textContent(), /Deepgram: audio/);
  await page.screenshot({ path: 'test-results/consent.png' });
  await page.keyboard.press('Escape'); assert.equal(await consent.count(), 0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Remove configured key when saving').check();
  await page.getByLabel('Remove Deepgram key when saving').check();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click(); await waitText('Not configured');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1080, height: 720 }));
  await page.getByRole('button', { name: 'Live workspace', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.screenshot({ path: 'test-results/compact.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: answer/solution ranking, question search, expandable response details, quiet-mode answers, cross-speaker responses, speaker selection/following, held insight snapshots, new-result loading, pagination, rename/self identity, speaker matching, separate credential isolation and consent, desktop isolation, PCM worklet, recap boundaries, filters, pins, compact layout, and URL validation.');
} finally { await app.close(); }
