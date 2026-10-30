import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');
const prod=readFileSync(new URL('../sposched-production-ui.mjs',import.meta.url),'utf8');

test('mobile SpoSched flow uses concise steps and hides optional settings',()=>{
 assert.match(html,/id="ssModeBadge"/);
 assert.match(html,/id="ssSessionOptions"/);
 assert.match(html,/id="quickProductionHelp"[^>]*>AI候補と登録予定/);
 assert.match(html,/id="quickSummary"/);
 assert.match(html,/動画・判定の詳細/);
 assert.match(html,/AI候補','quick-compare-label'/);
 assert.match(html,/登録予定','quick-compare-label'/);
 assert.doesNotMatch(html,/一昨日のTEST版|本番SSは読み取りのみ|イベント単位の承認後のみ登録可/);
});

test('production registration remains two explicit steps with a hidden technical audit',()=>{
 assert.match(html,/id="productionCheck"[^>]*>① 登録内容を確認（送信なし）/);
 assert.match(html,/id="productionStart"[^>]*disabled>② 4試合を本番登録/);
 assert.match(html,/id="productionAudit" hidden/);
 assert.match(prod,/validateProductionReleaseEvidence/);
 assert.match(prod,/productionAuditIds/);
 assert.match(prod,/await inspect\(\)/);
 assert.match(prod,/await post\('\/production\/batch\/start',earlier\.plan\)/);
 assert.doesNotMatch(prod,/window\.confirm/);
});
