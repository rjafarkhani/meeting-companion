import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { ServiceEvent, Settings, Transcript } from '../src/shared';

export interface TranscriptionOptions { url?: string; deepgramKey?: string }

/** One connection owns its acoustic speaker IDs. A resume must not silently
 * equate the new connection's speaker 0 with the previous connection's speaker 0. */
export class TranscriptionStream {
  private ws?: WebSocket;
  private alive = true;
  private ready = false;
  private keepAlive?: ReturnType<typeof setInterval>;
  private cancelConnect?: () => void;
  private partials = new Map<string, string>();
  private finalized = new Set<string>();
  private speakers = new Map<number, { id: string; number: number }>();
  private prefix = randomUUID();
  private started = Date.now();
  private nextSpeaker = 1;
  private warned = false;
  constructor(private key: string, private settings: Settings, private emit: (event: ServiceEvent) => void,
    private onFinal: (items: Transcript[]) => void, private options: TranscriptionOptions = {}) {}

  seed(history: Transcript[]) { this.nextSpeaker = Math.max(0, ...history.map(t => t.speakerNumber || 0)) + 1; }

  async connect() {
    const diarize = this.settings.transcriptionProvider === 'deepgram';
    if (diarize && !this.options.deepgramKey) throw new Error('Add a Deepgram API key in Settings for speaker recognition.');
    const url = this.options.url || (diarize
      ? 'wss://api.deepgram.com/v1/listen?' + new URLSearchParams({ model: 'nova-3', language: 'multi', encoding: 'linear16',
        sample_rate: '24000', channels: '1', diarize_model: 'latest', interim_results: 'true', smart_format: 'true', endpointing: '500' })
      : 'wss://api.openai.com/v1/realtime?intent=transcription');
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (err?: Error) => { if (settled) return; settled = true; clearTimeout(timeout); this.cancelConnect = undefined; err ? reject(err) : resolve(); };
      const timeout = setTimeout(() => { done(new Error('Transcription connection timed out. Check your key and network.')); this.stop(); }, 20000);
      this.cancelConnect = () => done(new Error('Transcription startup canceled.'));
      this.ws = new WebSocket(url, { headers: { Authorization: diarize ? `Token ${this.options.deepgramKey}` : `Bearer ${this.key}` }, maxPayload: 2 * 1024 * 1024 });
      this.ws.on('open', () => {
        if (!this.alive) return;
        this.started = Date.now();
        if (diarize) {
          this.ready = true; done();
          this.keepAlive = setInterval(() => {
            if (this.alive && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
          }, 4000);
        } else this.ws!.send(JSON.stringify({ type: 'session.update', session: { type: 'transcription', audio: { input: {
          format: { type: 'audio/pcm', rate: 24000 }, transcription: { model: this.settings.transcriptionModel }, turn_detection: null,
        } } } }));
      });
      this.ws.on('message', bytes => {
        if (!this.alive) return;
        try {
          const e = JSON.parse(bytes.toString());
          if (e.type === 'session.updated' && !diarize) { this.ready = true; done(); }
          if (e.type === 'error' || e.type === 'Error') {
            const message = String(e.error?.message || e.description || e.message || 'Transcription error');
            done(new Error(message)); this.fail(message); return;
          }
          if (diarize && e.type === 'Results') this.deepgramResult(e);
          else if (!diarize) this.openaiResult(e);
        } catch { this.emit({ type: 'error', message: 'An unreadable transcription event was received.', fatal: false }); }
      });
      this.ws.on('error', () => {
        const message = `Cannot connect to ${diarize ? 'Deepgram' : 'OpenAI'} transcription. Check the key, network, and model access.`;
        done(new Error(message)); if (this.alive) this.fail(message);
      });
      this.ws.on('close', () => {
        done(new Error('The transcription connection closed before it was ready.'));
        if (this.alive) this.fail('Transcription disconnected. Capture has stopped. Resume to reconnect.');
      });
    });
  }

  private deepgramResult(e: any) {
    const alternative = e.channel?.alternatives?.[0];
    if (!alternative) return;
    const partialId = `${this.prefix}:partial`;
    if (!e.is_final) {
      // Acoustic labels can change in interim output. Only finalized labels
      // create people in the roster or change the selected speaker.
      const text = String(alternative.transcript || '').trim();
      this.emit({ type: 'transcript-batch', replaceIds: [partialId], items: text ? [{ id: partialId,
        speaker: 'Identifying speaker…', text, at: Number(e.start) || 0, final: false }] : [] });
      return;
    }
    if (!Number.isFinite(e.start) || !Number.isFinite(e.duration)) return;
    const resultId = `${this.prefix}:${e.start}:${e.duration}`;
    if (this.finalized.has(resultId)) return;
    this.finalized.add(resultId);
    const groups: Array<{ raw?: number; text: string[]; at: number }> = [];
    for (const word of Array.isArray(alternative.words) ? alternative.words : []) {
      const text = String(word.punctuated_word || word.word || '').trim();
      if (!text) continue;
      const raw = Number.isInteger(word.speaker) && word.speaker >= 0 ? word.speaker as number : undefined;
      const last = groups[groups.length - 1];
      if (last && last.raw === raw) last.text.push(text);
      else groups.push({ raw, text: [text], at: Number.isFinite(word.start) ? word.start : e.start });
    }
    if (!groups.length && String(alternative.transcript || '').trim()) groups.push({ text: [String(alternative.transcript).trim()], at: e.start });
    const items: Transcript[] = groups.map((group, index) => {
      let identity = group.raw === undefined ? undefined : this.speakers.get(group.raw);
      if (group.raw !== undefined && !identity) {
        identity = { id: `${this.prefix}:speaker:${group.raw}`, number: this.nextSpeaker++ };
        this.speakers.set(group.raw, identity);
      }
      return { id: `${resultId}:${index}`, speakerId: identity?.id || `${this.prefix}:unknown`, speakerNumber: identity?.number,
        speaker: identity ? `Speaker ${identity.number}` : 'Unidentified speaker', text: group.text.join(' '), at: group.at, final: true };
    });
    this.emit({ type: 'transcript-batch', replaceIds: [partialId], items });
    if (items.length) this.onFinal(items);
    if (items.some(t => !t.speakerNumber) && !this.warned) {
      this.warned = true;
      this.emit({ type: 'error', message: 'Some speech has no speaker label. It is shown as Unidentified speaker; no identity was guessed.', fatal: false });
    }
  }

  private openaiResult(e: any) {
    if (e.type === 'conversation.item.input_audio_transcription.failed') {
      this.emit({ type: 'error', message: 'A speech segment could not be transcribed. No text was inferred.', fatal: false });
    }
    const id = `${this.prefix}:${e.item_id}`;
    if (e.type === 'conversation.item.input_audio_transcription.delta') {
      const text = (this.partials.get(id) || '') + (e.delta || ''); this.partials.set(id, text);
      this.emit({ type: 'transcript', item: { id, speakerId: 'meeting-audio', speaker: 'Meeting audio', text, at: this.elapsed(), final: false } });
    }
    if (e.type === 'conversation.item.input_audio_transcription.completed') {
      this.partials.delete(id);
      if (!String(e.transcript || '').trim() || this.finalized.has(id)) return;
      this.finalized.add(id);
      const item: Transcript = { id, speakerId: 'meeting-audio', speaker: 'Meeting audio', text: e.transcript, at: this.elapsed(), final: true };
      this.emit({ type: 'transcript', item }); this.onFinal([item]);
    }
  }
  private elapsed() { return Math.round((Date.now() - this.started) / 1000); }
  private fail(message: string) { this.emit({ type: 'error', message, fatal: true }); this.stop(); }
  audio(data: ArrayBuffer, commit: boolean) {
    if (!this.alive || !this.ready || this.ws?.readyState !== WebSocket.OPEN) return;
    if (this.ws.bufferedAmount > 512000) { this.fail('The network cannot keep up with audio. Capture stopped to avoid a growing delay.'); return; }
    if (this.settings.transcriptionProvider === 'deepgram') {
      if (data.byteLength) this.ws.send(Buffer.from(data));
    } else {
      if (data.byteLength) this.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: Buffer.from(data).toString('base64') }));
      if (commit) this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    }
  }
  stop() {
    this.alive = false; this.ready = false; clearInterval(this.keepAlive); this.cancelConnect?.();
    this.ws?.removeAllListeners('message');
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.close();
    else if (this.ws?.readyState === WebSocket.CONNECTING) this.ws.terminate();
    this.partials.clear(); this.finalized.clear(); this.speakers.clear(); this.key = ''; this.options.deepgramKey = '';
  }
}
