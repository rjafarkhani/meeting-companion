// The AudioContext resamples all input devices to 24 kHz before this processor.
class PCMProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.samples = new Int16Array(2400); this.offset = 0; this.power = 0; }
  process(inputs, outputs) {
    for (const channel of outputs[0] || []) channel.fill(0);
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] / channels.length;
      sample = Math.max(-1, Math.min(1, sample));
      this.power += sample * sample;
      this.samples[this.offset++] = sample < 0 ? sample * 32768 : sample * 32767;
      if (this.offset === this.samples.length) {
        this.port.postMessage({ data: this.samples.buffer, rms: Math.sqrt(this.power / this.offset) }, [this.samples.buffer]);
        this.samples = new Int16Array(2400); this.offset = 0; this.power = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
