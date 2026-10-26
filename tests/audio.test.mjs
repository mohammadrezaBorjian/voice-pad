import { test } from "node:test";
import assert from "node:assert/strict";
import { pcm16, PhraseDetector } from "../static/audio.mjs";

const rate = 48000;
const frame = amplitude => new Float32Array(rate / 10).fill(amplitude);

test("48 kHz audio becomes bounded, signed little-endian 16 kHz PCM", () => {
  const bytes = pcm16([new Float32Array(rate).fill(0.5)], rate);
  assert.equal(bytes.byteLength, 32000);
  assert.equal(new DataView(bytes).getInt16(0, true), 16384);
  const clipped = new DataView(pcm16([new Float32Array([-2, 2])], 16000));
  assert.equal(clipped.getInt16(0, true), -32768);
  assert.equal(clipped.getInt16(2, true), 32767);
});

test("silence never creates a transcription; short final word survives Stop", () => {
  const finals = [];
  const detector = new PhraseDetector(rate, () => {}, p => finals.push(p));
  for (let i = 0; i < 40; i++) detector.push(frame(0));
  detector.flush();
  assert.equal(finals.length, 0);
  detector.push(frame(0));
  detector.push(frame(0.1));
  detector.push(frame(0.1));
  detector.flush();
  assert.equal(finals.length, 1);
  assert.equal(finals[0].chunks.length, 3);
  detector.flush();
  assert.equal(finals.length, 1, "Stop must not duplicate a phrase");
});

test("preview and final share an ID; silence completes a phrase without overlapping the next", () => {
  const previews = [], finals = [];
  const detector = new PhraseDetector(rate, p => previews.push(p), p => finals.push(p));
  for (let i = 0; i < 32; i++) detector.push(frame(0.1));
  assert.ok(previews.length >= 1);
  for (let i = 0; i < 10; i++) detector.push(frame(0));
  assert.equal(finals.length, 1);
  assert.equal(previews[0].id, finals[0].id);
  assert.ok(previews[0].chunks.length < finals[0].chunks.length, "snapshot must not grow after sending");
  for (let i = 0; i < 5; i++) detector.push(frame(0.1));
  detector.flush();
  assert.equal(finals.length, 2);
  assert.notEqual(finals[0].id, finals[1].id);
});

test("one short spoken word between pauses is not silently discarded", () => {
  const finals = [];
  const detector = new PhraseDetector(rate, () => {}, p => finals.push(p));
  for (let i = 0; i < 5; i++) detector.push(frame(0));
  detector.push(frame(0.1));
  for (let i = 0; i < 10; i++) detector.push(frame(0));
  assert.equal(finals.length, 1);
  assert.ok(finals[0].chunks.some(chunk => chunk[0] === Math.fround(0.1)));
});

test("continuous speech is split into bounded phrases and Stop drains the tail", () => {
  const finals = [];
  const detector = new PhraseDetector(rate, () => {}, p => finals.push(p));
  for (let i = 0; i < 275; i++) detector.push(frame(0.1));
  detector.flush();
  assert.equal(finals.length, 3);
  assert.equal(finals.reduce((n, p) => n + p.chunks.length, 0), 275);
  for (const phrase of finals) assert.ok(phrase.chunks.length <= 121);
});
