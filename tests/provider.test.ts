import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { LiveSession, responseCitations, responseText } from '../electron/provider';
import { defaultPrep, defaultSettings, type ServiceEvent } from '../src/shared';

test('only actual web-search URL annotations become citations', () => {
  const result = { output: [{ content: [{ type: 'output_text', text: 'Result', annotations: [
    { type: 'url_citation', title: 'Docs', url: 'https://example.com/doc' },
    { type: 'url_citation', title: 'Duplicate', url: 'https://example.com/doc' },
    { type: 'url_citation', title: 'Unsafe', url: 'javascript:alert(1)' },
  ] }] }] };
  assert.equal(responseText(result), 'Result'); assert.deepEqual(responseCitations(result), [{ title: 'Docs', url: 'https://example.com/doc' }]);
});
test('realtime protocol configures PCM, handles deltas/finals, and stops sends after pause', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: '{"cards":[]}' }] }] })));
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const messages: any[] = []; const events: ServiceEvent[] = [];
  const service = new LiveSession('test-key', { ...defaultSettings, transcriptionProvider: 'openai' }, defaultPrep, e => events.push(e), { url: `ws://127.0.0.1:${port}` });
  server.on('connection', socket => socket.on('message', bytes => {
    const e = JSON.parse(bytes.toString()); messages.push(e);
    if (e.type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated' }));
    if (e.type === 'input_audio_buffer.commit') {
      socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', item_id: 't1', delta: 'hello' }));
      socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 't1', transcript: 'hello world' }));
    }
  }));
  try {
    await service.connect();
    assert.equal(messages[0].session.audio.input.format.rate, 24000);
    assert.equal(messages[0].session.audio.input.turn_detection, null);
    service.audio(new Uint8Array([0, 1]).buffer, true);
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => { clearInterval(check); reject(new Error('No final transcript')); }, 1500);
      const check = setInterval(() => { if (events.some(e => e.type === 'transcript' && e.item.final)) { clearInterval(check); clearTimeout(deadline); resolve(); } }, 10);
    });
    service.stop();
    assert.ok(events.some(e => e.type === 'transcript' && !e.item.final && e.item.text === 'hello'));
    assert.ok(events.some(e => e.type === 'transcript' && e.item.final && e.item.text === 'hello world'));
    const count = messages.length; service.audio(new ArrayBuffer(2), true);
    await new Promise(r => setTimeout(r, 30)); assert.equal(messages.length, count);
  } finally { service.stop(); server.clients.forEach(c => c.terminate()); await new Promise<void>(r => server.close(() => r())); }
});
test('provider errors reject startup instead of silently presenting a live session', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('External requests disabled in protocol tests'); });
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await once(server, 'listening');
  const service = new LiveSession('test-key', { ...defaultSettings, transcriptionProvider: 'openai' }, defaultPrep, () => {}, { url: `ws://127.0.0.1:${(server.address() as { port: number }).port}` });
  server.on('connection', socket => socket.on('message', () => socket.send(JSON.stringify({ type: 'error', error: { message: 'Model unavailable' } }))));
  try { await assert.rejects(service.connect(), /Model unavailable/); }
  finally { service.stop(); server.clients.forEach(c => c.terminate()); await new Promise<void>(r => server.close(() => r())); }
});

test('speaker names and self marker reach insights while cards retain validated transcript associations', async t => {
  const inputs: any[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    const payload = JSON.parse(String(options.body)), input = JSON.parse(payload.input); inputs.push(input);
    return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ cards: [
      { category: 'question', title: 'Ask about the budget', body: 'Clarify the latency target.', detail: 'Related to this discussion.', triggerId: input.transcript[0].id },
      { category: 'answer', title: 'The target is not established', question: 'What is the target?', body: 'The meeting has not established a target yet. Ask for an end-to-end latency budget.', detail: 'Do not infer a number from preparation alone.', triggerId: input.transcript[0].id, priority: 'normal' },
      { category: 'question', title: 'Wrong trigger', body: 'Should be rejected.', triggerId: 'invented' },
    ] }) }] }] }));
  });
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await once(server, 'listening');
  const events: ServiceEvent[] = [];
  const service = new LiveSession('synthetic-openai-key', defaultSettings, defaultPrep, event => {
    events.push(event);
    if (event.type === 'transcript-batch' && event.items[0]?.final) service.updateSpeakers({ [event.items[0].speakerId!]: { name: 'Ramya', isMe: true } });
  }, { url: `ws://127.0.0.1:${(server.address() as { port: number }).port}`, deepgramKey: 'synthetic-deepgram-key' });
  server.on('connection', socket => socket.on('message', (_bytes, binary) => {
    if (binary) socket.send(JSON.stringify({ type: 'Results', is_final: true, start: 0, duration: 1,
      channel: { alternatives: [{ transcript: 'What is the target?', words: [{ punctuated_word: 'What is the target?', speaker: 0, start: 0 }] }] } }));
  }));
  try {
    await service.connect(); service.audio(new ArrayBuffer(4800), false);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { clearInterval(check); reject(new Error('No speaker-grounded insights received')); }, 1500);
      const check = setInterval(() => { if (events.some(e => e.type === 'insights')) { clearTimeout(timeout); clearInterval(check); resolve(); } }, 10);
    });
    assert.equal(inputs[0].transcript[0].speaker, 'Ramya (you)');
    const cards = events.find(e => e.type === 'insights'); assert.ok(cards?.type === 'insights');
    assert.equal(cards.items.length, 2); assert.equal(cards.items[0].triggerId, inputs[0].transcript[0].id);
    assert.equal(cards.items[0].category, 'answer'); assert.equal(cards.items[0].priority, 'high');
    assert.equal(cards.items[0].question, 'What is the target?');
  } finally { service.stop(); server.clients.forEach(c => c.terminate()); await new Promise<void>(r => server.close(() => r())); }
});
