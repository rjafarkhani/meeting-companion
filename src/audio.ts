import type { Settings } from './shared';
import { TurnSegmenter } from './turns';
export class AudioCapture {
  private streams: MediaStream[] = [];
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private alive = false;
  async start(settings: Settings, send: (data: ArrayBuffer, commit: boolean) => void,
    meter: (level: number) => void, ended: () => void) {
    this.alive = true;
    try {
      if (settings.source !== 'system') {
        const mic = await navigator.mediaDevices.getUserMedia({ video: false, audio: {
          ...(settings.deviceId ? { deviceId: { exact: settings.deviceId } } : {}), echoCancellation: true, noiseSuppression: true,
        } });
        this.streams.push(mic);
        if (!this.alive) throw new Error('Capture canceled.');
      }
      if (settings.source !== 'microphone') {
        const desktop = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        this.streams.push(desktop);
        // No screen frames are processed, transmitted, or retained.
        desktop.getVideoTracks().forEach(t => t.stop());
        if (!this.alive) throw new Error('Capture canceled.');
        if (!desktop.getAudioTracks().some(t => t.readyState === 'live')) throw new Error('Windows did not provide a system-audio track. Check the output device or use the microphone.');
      }
      this.context = new AudioContext({ sampleRate: 24000 });
      if (this.context.sampleRate !== 24000) throw new Error('This audio device cannot provide the required 24 kHz format.');
      await this.context.audioWorklet.addModule(new URL('pcm-worklet.js', document.baseURI).href);
      if (!this.alive) throw new Error('Capture canceled.');
      this.node = new AudioWorkletNode(this.context, 'pcm-processor');
      this.node.connect(this.context.destination); // Worklet outputs silence; no microphone monitoring.
      for (const stream of this.streams) {
        const audio = new MediaStream(stream.getAudioTracks());
        this.context.createMediaStreamSource(audio).connect(this.node);
        audio.getTracks().forEach(t => t.onended = () => { if (this.alive) ended(); });
      }
      const turns = new TurnSegmenter(send);
      this.node.port.onmessage = ({ data: { data, rms } }: MessageEvent<{ data: ArrayBuffer; rms: number }>) => {
        if (!this.alive) return;
        meter(Math.min(1, rms * 9));
        // Diarization needs a continuous timeline, including silence. Do not cut
        // or commit the stream on RMS boundaries; Deepgram detects speech turns.
        if (settings.transcriptionProvider === 'deepgram') send(data, false);
        else turns.push(data, rms);
      };
      await this.context.resume();
    } catch (err) { await this.stop(); throw err; }
  }
  async stop() {
    this.alive = false;
    this.streams.forEach(s => s.getTracks().forEach(t => { t.onended = null; t.stop(); })); this.streams = [];
    if (this.node) { this.node.port.onmessage = null; this.node.disconnect(); this.node = undefined; }
    const context = this.context; this.context = undefined;
    if (context && context.state !== 'closed') await context.close().catch(() => {});
  }
}
