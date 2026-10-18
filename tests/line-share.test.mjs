import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lineShareUrl, addLineExternalBrowserParam, normalizeVisibleLineUrl } from '../line-share.mjs';

const base='https://nyamokun5.github.io/peakstamp/';

test('LINE copy link uses official openExternalBrowser flag',()=>{
  assert.equal(lineShareUrl(base),base+'?openExternalBrowser=1');
});
test('LINE copied link excludes temporary version parameters and fragments',()=>{
  assert.equal(
    lineShareUrl(base+'?v=ui16&openExternalBrowser=0#intro'),
    base+'?openExternalBrowser=1'
  );
});
test('index.html and nested entry URLs resolve to PeakStamp home',()=>{
  assert.equal(lineShareUrl(base+'index.html?v=ui16'),base+'?openExternalBrowser=1');
});
test('normal address bar keeps existing query while adding LINE external flag',()=>{
  assert.equal(
    normalizeVisibleLineUrl(base+'?v=ui16'),
    base+'?v=ui16&openExternalBrowser=1'
  );
});
test('already external-ready addresses are unchanged',()=>{
  assert.equal(normalizeVisibleLineUrl(base+'?openExternalBrowser=1&v=ui16'),null);
});
test('replace wrong/duplicated LINE flag instead of appending an ambiguous second one',()=>{
  assert.equal(
    addLineExternalBrowserParam(base+'?openExternalBrowser=0&v=2'),
    base+'?openExternalBrowser=1&v=2'
  );
});
test('invalid non-HTTPS share URLs are rejected',()=>{
  assert.throws(()=>addLineExternalBrowserParam('http://example.com/'));
  assert.throws(()=>lineShareUrl('file:///peakstamp/index.html'));
});
test('page includes actionable LINE copy control and non-blocking manual fallback',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
  assert.match(html,/id="lineShareCopy"/);
  assert.match(html,/id="lineShareFallback"/);
  assert.match(html,/app\.mjs\?v=[a-z0-9]+/);
  assert.match(app,/lineShareUrl\(window\.location\.href\)/);
  assert.match(app,/normalizeVisibleLineUrl\(window\.location\.href\)/);
  assert.match(app,/navigator\.clipboard\?\.writeText/);
  assert.match(app,/fallback\.select\(\)/);
});
