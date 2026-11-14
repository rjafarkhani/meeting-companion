import test from 'node:test';
import assert from 'node:assert/strict';
import { demoArtifact, demoMoment } from '../src/demo';
import { exportMarkdown, parseInsights, safeUrl, validateSettings } from '../src/core';
import { defaultPrep, defaultSettings } from '../src/shared';
import { TurnSegmenter } from '../src/turns';

test('settings reject invalid input and clamp request frequency', () => {
  assert.throws(() => validateSettings({ ...defaultSettings, source: 'camera' }));
  assert.throws(() => validateSettings({ ...defaultSettings, model: '../../secret' }));
  assert.equal(validateSettings({ ...defaultSettings, insightInterval: 1 }).insightInterval, 2000);
  assert.equal(validateSettings({ ...defaultSettings, insightInterval: 999999 }).insightInterval, 15000);
});
test('external sources exclude executable protocols and credential URLs', () => {
  for (const u of ['javascript:alert(1)', 'file:///C:/secret', 'https://user:secret@x.com', 'not a url', 'http://x.com']) assert.equal(safeUrl(u), false);
  assert.equal(safeUrl('https://learn.microsoft.com/en-us/windows'), true);
});
test('insights require a real transcript id and cannot assert retrieved provenance', () => {
  const cards = [
    { category: 'risk', title: 'A risk', body: 'A failure window', triggerId: 'real', provenance: 'retrieved', citations: [{ url: 'https://fake.com' }] },
    { category: 'insight', title: 'Invented context', body: 'Unsupported', triggerId: 'invented' },
    { category: 'invalid', title: 'Unknown', body: 'Unknown', triggerId: 'real' },
  ];
  const out = parseInsights({ cards }, new Set(['real']), 1);
  assert.equal(out.length, 1); assert.equal(out[0].provenance, 'inference'); assert.deepEqual(out[0].citations, []);
});
test('demo recap never leaks future decisions or owners', () => {
  for (let n = 0; n < 7; n++) { assert.deepEqual(demoArtifact(n).decisions, []); assert.deepEqual(demoArtifact(n).actions, []); }
  assert.equal(demoArtifact(7).decisions.length, 1); assert.equal(demoArtifact(7).actions.length, 2);
});
test('export labels scripted data and excludes unfinished speech', () => {
  const moment = demoMoment(0);
  const markdown = exportMarkdown(defaultPrep, [moment.item, { ...moment.item, id: 'unfinished', text: 'UNFINISHED_SENTINEL', final: false }], moment.cards, null, true);
  assert.match(markdown, /SCRIPTED DEMO/); assert.match(markdown, /transcript demo-0/); assert.doesNotMatch(markdown, /UNFINISHED_SENTINEL/);
});
test('segmenter does not send indefinite silence; retains only 300ms of preroll', () => {
  const sent: ArrayBuffer[] = []; const turns = new TurnSegmenter(b => sent.push(b));
  for (let i = 0; i < 500; i++) turns.push(new ArrayBuffer(4800), 0);
  assert.equal(sent.length, 0);
  turns.push(new ArrayBuffer(4800), .03); assert.equal(sent.length, 3);
});
test('segmenter commits after 700ms silence and bounds uninterrupted speech to five seconds', () => {
  const commits: boolean[] = []; const turns = new TurnSegmenter((_, c) => commits.push(c));
  turns.push(new ArrayBuffer(4800), .03);
  for (let i = 0; i < 7; i++) turns.push(new ArrayBuffer(4800), 0);
  assert.equal(commits.filter(Boolean).length, 1);
  commits.length = 0;
  for (let i = 0; i < 50; i++) turns.push(new ArrayBuffer(4800), .03);
  assert.equal(commits.length, 50); assert.equal(commits[49], true);
});
test('clearing a segment drops paused audio rather than committing it', () => {
  const commits: boolean[] = []; const turns = new TurnSegmenter((_, c) => commits.push(c));
  turns.push(new ArrayBuffer(4800), .03); turns.clear();
  for (let i = 0; i < 7; i++) turns.push(new ArrayBuffer(4800), 0);
  assert.equal(commits.filter(Boolean).length, 0);
});
