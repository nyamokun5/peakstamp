import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../sposched-production-ui.mjs',import.meta.url),'utf8');
test('production staged continuation is explicitly surfaced and wired',()=>{
 assert.match(html,/id="productionAppend"[^>]*hidden/);
 assert.match(ui,/productionAppend'\)\.addEventListener\('click'/);
 assert.match(ui,/\/production\/batch\/append-second-round/);
 assert.match(ui,/buildProductionSecondRoundAppend/);
});
test('production stage one excludes second-round operations without changing legacy path',()=>{
 assert.match(ui,/layout_mode:'four-knockout-staged-v1'/);
 assert.match(ui,/original\.operations\.filter\(op=>op\.seq<=2\)/);
 assert.match(ui,/post\('\/production\/batch\/start'/);
 assert.match(ui,/post\('\/production\/batch\/inspect'/);
});
