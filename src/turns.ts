/** Memory-only speech chunker. 100 ms, mono PCM16 chunks at 24 kHz. */
export class TurnSegmenter {
  private active = false;
  private quietFrames = 0;
  private frames = 0;
  private preroll: ArrayBuffer[] = [];
  constructor(private send: (chunk: ArrayBuffer, commit: boolean) => void) {}
  push(data: ArrayBuffer, rms: number) {
    const speech = rms > 0.008;
    if (!this.active) {
      this.preroll.push(data); if (this.preroll.length > 3) this.preroll.shift();
      if (!speech) return;
      this.active = true; this.frames = this.preroll.length; this.quietFrames = 0;
      this.preroll.splice(0).forEach(chunk => this.send(chunk, false)); return;
    }
    this.frames++; this.quietFrames = speech ? 0 : this.quietFrames + 1;
    const commit = this.quietFrames >= 7 || this.frames >= 50;
    this.send(data, commit);
    if (commit) this.clear();
  }
  clear() { this.active = false; this.frames = 0; this.quietFrames = 0; this.preroll = []; }
}
