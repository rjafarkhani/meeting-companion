import test from 'node:test';
import assert from 'node:assert/strict';
import { namedTranscript, meetingSpeakers, relatedInsights, upsertTranscript } from '../src/speakers';
import { demoMoment } from '../src/demo';
import { exportMarkdown } from '../src/core';
import { defaultPrep, type SpeakerProfiles } from '../src/shared';

test('renaming and marking yourself preserves transcript IDs and insight associations', () => {
  const a = demoMoment(0), b = demoMoment(1), c = demoMoment(3);
  const lines = [a.item, b.item, c.item], cards = [...a.cards, ...b.cards, ...c.cards];
  const profiles: SpeakerProfiles = { [a.item.speakerId!]: { name: 'Ramya', isMe: true } };
  const named = namedTranscript(lines, profiles);
  assert.equal(named[0].speaker, 'Ramya (you)'); assert.equal(named[2].speaker, 'Ramya (you)');
  assert.equal(named[0].id, a.item.id);
  assert.equal(meetingSpeakers(lines, profiles).length, 2);
  assert.equal(relatedInsights(cards, lines, profiles, a.item.speakerId!).length, 4);
  assert.equal(relatedInsights(cards, lines, profiles, '*').length, 6);
  const output = exportMarkdown(defaultPrep, named, cards, null, false);
  assert.match(output, /Ramya \(you\)/); assert.match(output, /transcript demo-0/);
});

test('matching a resumed label groups old and future turns without relying on editable names', () => {
  const old = demoMoment(0), next = demoMoment(1);
  const resumed = { ...next.item, speakerId: 'new-connection:speaker:0', speakerNumber: 4, speaker: 'Speaker 4' };
  const profiles: SpeakerProfiles = {
    [old.item.speakerId!]: { name: 'Alex', isMe: false },
    [resumed.speakerId]: { name: '', isMe: false, aliasOf: old.item.speakerId },
  };
  const lines = [old.item, resumed];
  assert.equal(meetingSpeakers(lines, profiles).length, 1);
  assert.deepEqual(namedTranscript(lines, profiles).map(t => t.speaker), ['Alex', 'Alex']);
  assert.equal(relatedInsights([...old.cards, ...next.cards], lines, profiles, old.item.speakerId!).length, 4);
});

test('equal display names do not merge distinct voices and interim labels do not create speakers', () => {
  const a = demoMoment(0).item, b = demoMoment(1).item;
  const profiles = { [a.speakerId!]: { name: 'Alex', isMe: false }, [b.speakerId!]: { name: 'Alex', isMe: false } };
  assert.equal(meetingSpeakers([a, b, { ...a, id: 'partial', speakerId: 'pending', final: false }], profiles).length, 2);
});

test('a revised interim transcript is atomically replaced by split final speaker turns', () => {
  const a = demoMoment(0).item, b = demoMoment(1).item;
  const provisional = { ...a, id: 'partial', final: false, text: 'provisional text' };
  const previous = upsertTranscript([], [provisional]);
  const final = upsertTranscript(previous, [a, b], ['partial']);
  assert.deepEqual(final.map(t => t.id), [a.id, b.id]);
  assert.deepEqual(upsertTranscript(final, [a, b]), final);
});
