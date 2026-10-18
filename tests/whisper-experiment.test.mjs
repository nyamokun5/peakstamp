import test from 'node:test';
import assert from 'node:assert/strict';
import { snippetWindow, resampleMono, matchingKeywords } from '../whisper-experiment.mjs';

test('snippet stays within 16 seconds and starts before peak', () => {
  assert.deepEqual(snippetWindow(8, 120), { start: 2, end: 18 });
  assert.deepEqual(snippetWindow(0, 120), { start: 0, end: 16 });
  assert.deepEqual(snippetWindow(119, 120), { start: 104, end: 120 });
  assert.deepEqual(snippetWindow(2, 4), { start: 0, end: 4 });
  assert.throws(() => snippetWindow(10, 0), /長さ/);
});
test('mono resampling produces 16 kHz Float32Array without changing tone', () => {
  const samples = new Float32Array(48000);
  samples.fill(0.3);
  const result = resampleMono(samples, 48000);
  assert.equal(result.length, 16000);
  assert.equal(result[0], samples[0]);
  assert.ok(Math.abs(result[1234] - 0.3) < 0.000001);
  assert.equal(resampleMono(new Float32Array(), 48000).length, 0);
  assert.throws(() => resampleMono(samples, 0), /サンプルレート/);
});
test('Japanese commentary hints do not change highlight decisions', () => {
  assert.deepEqual(matchingKeywords('ナイス ゴール！惜しい！'), ['ナイス', 'ゴール', '惜しい']);
  assert.deepEqual(matchingKeywords('サイドに出して'), []);
  assert.deepEqual(matchingKeywords(''), []);
});
