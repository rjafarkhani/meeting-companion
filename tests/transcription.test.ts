import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer, type WebSocket } from 'ws';
import { TranscriptionStream } from '../electron/transcription';
import { defaultSettings, type ServiceEvent, type Transcript } from '../src/shared';

async function fixture() {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await once(server, 'listening');
  const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
  const events: ServiceEvent[] = [], finals: Transcript[] = [];
  let socket: WebSocket; let auth = ''; const messages: Buffer[] = [];
  server.on('connection', (ws, request) => { socket = ws; auth = request.headers.authorization || ''; ws.on('message', (bytes, binary) => { if (binary) messages.push(Buffer.from(bytes as Buffer)); }); });
  const stream = new TranscriptionStream('unused-openai-key', defaultSettings, e => events.push(e), lines => finals.push(...lines), { url, deepgramKey: 'test-deepgram-key' });
  await stream.connect();
  return { server, stream, events, finals, messages, auth: () => auth,
    send: async (payload: object) => { const received = Promise.race([once(socket!, 'pong'), once(socket!, 'close')]); socket!.send(JSON.stringify(payload)); socket!.ping(); await received; await new Promise(r => setImmediate(r)); },
    close: async () => { stream.stop(); server.clients.forEach(c => c.terminate()); await new Promise<void>(r => server.close(() => r())); } };
}
const result = (overrides: object = {}) => ({ type: 'Results', start: 1, duration: 2, is_final: true, channel: { alternatives: [{ transcript: 'Hello. Yes.', words: [
  { word: 'hello', punctuated_word: 'Hello.', start: 1.2, end: 1.5, speaker: 0 },
  { word: 'yes', punctuated_word: 'Yes.', start: 2, end: 2.5, speaker: 1 },
] }] }, ...overrides });

test('diarization authenticates separately, streams raw PCM, splits speakers, preserves stable labels and timestamps', async () => {
  const f = await fixture();
  try {
    assert.equal(f.auth(), 'Token test-deepgram-key');
    f.stream.audio(new Uint8Array([0, 1, 2, 3]).buffer, true);
    await f.send(result());
    assert.deepEqual([...f.messages[0]], [0, 1, 2, 3]);
    assert.deepEqual(f.finals.map(t => t.speaker), ['Speaker 1', 'Speaker 2']);
    assert.deepEqual(f.finals.map(t => t.at), [1.2, 2]);
    const firstId = f.finals[0].speakerId;
    await f.send(result({ start: 3, duration: 2 }));
    assert.equal(f.finals[2].speakerId, firstId);
    const count = f.finals.length; await f.send(result({ start: 3, duration: 2 })); assert.equal(f.finals.length, count);
    f.stream.stop(); f.stream.audio(new ArrayBuffer(2), false); await new Promise(r => setTimeout(r, 20)); assert.equal(f.messages.length, 1);
  } finally { await f.close(); }
});

test('interim labels are provisional; finals replace them and unknown speech is never assigned a guessed person', async () => {
  const f = await fixture();
  try {
    await f.send(result({ is_final: false }));
    const provisional = f.events.find(e => e.type === 'transcript-batch');
    assert.ok(provisional?.type === 'transcript-batch'); assert.equal(provisional.items[0].final, false);
    assert.equal(f.finals.length, 0);
    await f.send(result());
    const final = f.events.filter(e => e.type === 'transcript-batch').at(-1);
    assert.ok(final?.type === 'transcript-batch'); assert.ok(final.replaceIds.includes(provisional.items[0].id));
    await f.send(result({ start: 8, channel: { alternatives: [{ transcript: 'Unlabeled speech', words: [] }] } }));
    assert.equal(f.finals.at(-1)?.speaker, 'Unidentified speaker');
    assert.ok(f.events.some(e => e.type === 'error' && !e.fatal));
  } finally { await f.close(); }
});

test('resume uses a new identity namespace and continues speaker numbering without assuming a voice match', async () => {
  const first = await fixture(); let history: Transcript[] = [];
  try { await first.send(result()); history = [...first.finals]; } finally { await first.close(); }
  const next = await fixture();
  try {
    next.stream.seed(history); await next.send(result());
    assert.equal(next.finals[0].speaker, 'Speaker 3');
    assert.notEqual(next.finals[0].speakerId, history[0].speakerId);
    assert.notEqual(next.finals[0].id, history[0].id);
  } finally { await next.close(); }
});

test('missing diarization credentials reject startup, and service errors stop audio', async () => {
  const missing = new TranscriptionStream('openai-key', defaultSettings, () => {}, () => {});
  await assert.rejects(missing.connect(), /Deepgram API key/); missing.stop();
  const f = await fixture();
  try {
    await f.send({ type: 'Error', description: 'Quota exceeded' });
    assert.ok(f.events.some(e => e.type === 'error' && e.fatal && e.message === 'Quota exceeded'));
    f.stream.audio(new ArrayBuffer(2), false); assert.equal(f.messages.length, 0);
  } finally { await f.close(); }
});
