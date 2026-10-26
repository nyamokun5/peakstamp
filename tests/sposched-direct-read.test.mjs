import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// This page is a module script embedded in HTML, so Node cannot import it.
// Compile its script separately to catch syntax errors without loading the DOM.
const html = readFileSync(new URL('../sposched-review.html', import.meta.url),'utf8');

test('SpoSched direct import is present and accepts only read-only gateway routes',()=>{
  assert.match(html,/id="ssBridgeToken"/);
  assert.match(html,/id="ssLoadEvents"/);
  assert.match(html,/id="ssEventSelect"/);
  assert.match(html,/id="ssLoadSnapshot"/);
  assert.match(html,/\/events\?limit=100/);
  assert.match(html,/\/snapshot\?event_id=/);
  assert.match(html,/method:'GET'/);
  assert.doesNotMatch(html,/fetch\(SS_GATEWAY\s*\+\s*path\s*,\s*\{[^}]*method:'POST'/);
  assert.doesNotMatch(html,/localStorage\.setItem\([^)]*ssBridgeToken/);
});

test('existing goal review remains available and old JSON import is retained',()=>{
  assert.match(html,/id="loadSnapshot"/);
  assert.match(html,/id="snapshotText"/);
  assert.match(html,/snapshot=normalizeSpoSnapshot\(data\)/);
  assert.match(html,/buildReviewPayload\(snapshot,rows,scores\)/);
});

test('embedded module JavaScript parses without runtime DOM initialization',()=>{
  const module = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(module,'Embedded module script should exist');
  const body = module[1].split('\n').filter(line=>!line.startsWith('import ')).join('\n');
  assert.doesNotThrow(()=>new Function(body));
});

test('verified already-registered goals show no update rather than an error',()=>{
  assert.match(html,/matchingAndSkipped/);
  assert.match(html,/rows\.every\(row=>!row\.include&&matchingExistingGoals\(row,snapshot\)\.length>0\)/);
  assert.match(html,/noScoreChanges/);
  assert.match(html,/追加・更新する操作はありません/);
});

test('existing-goal correction requires selecting a real goal ID and explicit confirmation',()=>{
 assert.match(html,/id="ssLoadSnapshot"/);
 assert.match(html,/修正対象の既存ゴールを選択/);
 assert.match(html,/row\.updateGoalId=selected\.id/);
 assert.match(html,/row\.confirmed=false;confirm\.checked=false/);
 assert.match(html,/この登録済みゴールを修正対象に指定/);
 assert.match(html,/未送信/);
 assert.doesNotMatch(html,/method:\s*['"](POST|PATCH|PUT|DELETE)['"]/i);
});
