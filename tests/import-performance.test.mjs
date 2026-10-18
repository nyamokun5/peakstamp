import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.mjs',import.meta.url),'utf8');

test('local video is not eagerly opened for original preview when files are selected',()=>{
  assert.match(html,/id="preview"[^>]*preload="none"[^>]*hidden/);
  assert.match(html,/id="loadPreview"/);
  const rendering=app.split('function renderSourceList() {')[1].split('function chooseFiles(')[0];
  assert.ok(rendering);
  assert.doesNotMatch(rendering,/preview\.src\s*=\s*first\.objectUrl/);
  assert.match(rendering,/if \(preview\.hasAttribute\('src'\)\)/);
  assert.match(app,/\$\('loadPreview'\)\.addEventListener\('click'/);
  assert.match(app,/preview\.src = first\.objectUrl/);
});

test('import timings separate native picker from app list paint with honest caveat',()=>{
  assert.match(html,/id="fileImportTiming"/);
  assert.match(html,/iCloud取得だけを個別に計測することはできません/);
  assert.match(app,/filePickerOpenedAt = performance\.now\(\)/);
  assert.match(app,/const receivedAt = performance\.now\(\)/);
  assert.match(app,/requestAnimationFrame\(\(\) =>/);
  assert.match(app,/PeakStampの一覧表示/);
});
