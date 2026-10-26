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
