/** Resample a complete phrase to little-endian mono PCM16 for Whisper. */
export function pcm16(chunks, sampleRate, targetRate = 16000) {
  const length = chunks.reduce((n, chunk) => n + chunk.length, 0);
  const samples = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
  const count = Math.floor(length * targetRate / sampleRate);
  const result = new ArrayBuffer(count * 2);
  const view = new DataView(result);
  // Average source samples in each output interval, including fractional edges.
  // This also avoids the aliasing of simply dropping 2/3 of a 48 kHz signal.
  const ratio = sampleRate / targetRate;
  for (let i = 0; i < count; i++) {
    const start = i * ratio, end = Math.min((i + 1) * ratio, length);
    let sum = 0;
    for (let j = Math.floor(start); j < Math.ceil(end); j++) {
      sum += samples[j] * (Math.min(j + 1, end) - Math.max(j, start));
    }
    const value = Math.max(-1, Math.min(1, sum / (end - start)));
    view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return result;
}

/** Small client-side VAD; the model performs a second speech check. */
export class PhraseDetector {
  constructor(sampleRate, onPreview, onFinal, { threshold = 0.008 } = {}) {
    this.rate = sampleRate;
    this.onPreview = onPreview;
    this.onFinal = onFinal;
    this.threshold = threshold;
    this.id = 0;
    this.preRoll = [];
    this.reset();
  }
  reset() {
    this.chunks = [];
    this.duration = 0;
    this.silence = 0;
    this.speech = 0;
    this.previewAt = 2.5;
  }
  push(chunk) {
    const seconds = chunk.length / this.rate;
    let sum = 0;
    for (const sample of chunk) sum += sample * sample;
    const rms = Math.sqrt(sum / chunk.length);
    const speaking = rms >= this.threshold;
    if (!this.chunks.length) {
      if (!speaking) {
        this.preRoll.push(chunk);
        while (this.preRoll.length > 3) this.preRoll.shift();
        return rms;
      }
      this.id++;
      this.chunks = this.preRoll.splice(0);
      this.duration = this.chunks.reduce((n, c) => n + c.length / this.rate, 0);
    }
    this.chunks.push(chunk);
    this.duration += seconds;
    this.speech += speaking ? seconds : 0;
    this.silence = speaking ? 0 : this.silence + seconds;
    if (this.duration >= 12 || this.silence >= 0.7) {
      this.flush();
    } else if (this.duration >= this.previewAt && this.speech >= 0.25) {
      this.onPreview({ id: this.id, chunks: this.chunks.slice(), rate: this.rate });
      this.previewAt = this.duration + 2.5;
    }
    return rms;
  }
  flush() {
    // Keep even a short final word when Stop is clicked.
    if (this.chunks.length && this.speech >= 0.06 && this.duration >= 0.25) {
      this.onFinal({ id: this.id, chunks: this.chunks.slice(), rate: this.rate });
    }
    this.reset();
    this.preRoll = [];
  }
}
