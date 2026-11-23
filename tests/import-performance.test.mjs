import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.mjs',import.meta.url),'utf8');

test('local video is not eagerly opened for original preview when files are selected',()=>{
  assert.match(html,/id="preview"[^>]*preload="none"[^>]*hidden/);
  assert.match(html,/id="videoWrapper" hidden/);
  const rendering=app.split('function renderSourceList() {')[1].split('function chooseFiles(')[0];
  assert.ok(rendering);
  assert.doesNotMatch(rendering,/preview\.src\s*=(?!=)/);
  assert.match(rendering,/if \(preview\.hasAttribute\('src'\)\)/);
  assert.match(app,/timestamp\.addEventListener\('click', \(\) => openTimestampPreview\(source\)\)/);
  assert.match(app,/preview\.src = source\.objectUrl/);
});

test('import timings separate native picker from app list paint with honest caveat',()=>{
  assert.match(html,/id="fileImportTiming"/);
  assert.match(html,/iCloud取得だけを個別に計測することはできません/);
  assert.match(app,/filePickerOpenedAt = performance\.now\(\)/);
  assert.match(app,/const receivedAt = performance\.now\(\)/);
  assert.match(app,/requestAnimationFrame\(\(\) =>/);
  assert.match(app,/PeakStampの一覧表示/);
});

test('native photo picker cancel or empty file change receives an actionable local-files workaround',()=>{
  assert.match(app,/addEventListener\('cancel', showIncompleteFilePick\)/);
  assert.match(app,/if \(!filesProvided\) showIncompleteFilePick\(\)/);
  assert.match(app,/filePickerOpenedAt = null/);
  assert.match(app,/選択画面を開いてから約/);
  assert.match(app,/未編集のオリジナルを書き出す/);
  assert.match(html,/class="photo-picker-tip"/);
  assert.match(html,/1本ずつ選択/);
});
