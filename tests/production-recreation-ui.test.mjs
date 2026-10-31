import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ui=readFileSync(new URL('../sposched-production-ui.mjs',import.meta.url),'utf8');
const html=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');

test('production recreation is opt-in and disabled until explicit review',()=>{
 assert.match(html,/id="productionRecreate" hidden/);
 assert.match(html,/id="productionRecreateConfirm" type="checkbox"/);
 assert.match(html,/id="productionRecreateStart" type="button" disabled/);
 assert.match(ui,/job\.status!=='completed'/);
 assert.match(ui,/productionRecreateConfirm'\)\.checked!==true/);
 assert.match(ui,/latest\.matchIds/);
});
test('recreation preserves both job IDs before a write and never automatically resends',()=>{
 const prior=ui.indexOf("localStorage.setItem(key(next.id)+':previous',previous)");
 const next=ui.indexOf("localStorage.setItem(key(next.id),next.plan.request_id)",prior);
 const mutation=ui.indexOf("await post('/production/batch/recreate'",next);
 assert.ok(prior>0&&next>prior&&mutation>next);
 assert.match(ui,/previous_request_id:previous/);
 assert.match(ui,/confirm_recreation:'PRODUCTION EVENT RECREATE DELETED FIXTURES'/);
 assert.match(ui,/再登録の送信結果が不確定です/);
 assert.match(ui,/自動再送しません/);
 assert.match(ui,/旧ジョブID：/);
 assert.doesNotMatch(ui,/window\.confirm/);
});
