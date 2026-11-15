import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareWorkerTournament} from '../sposched-worker-batch.mjs';
import {buildProductionSecondRoundAppend} from '../sposched-production-continuation.mjs';
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

test('production continuation records an append attempt before sending and never blindly retries',()=>{
 assert.match(ui,/localStorage\.setItem\(appendKey\(prepared\.event_id,prepared\.request_id\)/);
 assert.match(ui,/sendAttempted=true;\s*await post\('\/production\/batch\/append-second-round'/);
 assert.match(ui,/localStorage\.getItem\(appendKey\(eventId,requestId\)\)!==null/);
});

test('planner and continuation compose across two completed semifinal fixtures',()=>{
 const ids=[1,2,3,4].map(n=>String(n).repeat(8)+'-'+String(n).repeat(4)+'-4'+String(n).repeat(3)+'-8'+String(n).repeat(3)+'-'+String(n).repeat(12));
 const eventId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const requestId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const matches=ids.map((matchId,i)=>({seq:i+1,matchId:i<2?matchId:null,status:i<2?'scheduled':'waiting'}));
 const first=prepareWorkerTournament({snapshot:{eventId,matches},rows:[],decisions:[],requestId});
 const firstOperations=first.operations.filter(op=>op.seq<=2);
 assert.deepEqual(firstOperations.map(op=>op.seq),[1,2]);
 const finished=ids.map((matchId,i)=>({seq:i+1,matchId,status:i<2?'finished':'scheduled'}));
 const projected=finished.map(m=>m.seq<=2?{...m,status:'scheduled'}:m);
 const second=prepareWorkerTournament({snapshot:{eventId,matches:projected},rows:[],decisions:[],requestId});
 const job={environment:'PRODUCTION',event_id:eventId,request_id:requestId,
  inspection_only:true,execution_active:false,inspection_contract:'event-inspect-v1',
  layout_mode:'four-knockout-staged-v1',status:'awaiting_second_round',phase:'preparing',
  cursor:2,total:2,completed:2,fixture_ids:{1:ids[0],2:ids[1]}};
 const appended=buildProductionSecondRoundAppend({snapshot:{eventId,matches:finished},workerJob:job,
  operations:second.operations.filter(op=>op.seq>=3)});
 assert.deepEqual(appended.operations.map(op=>op.seq),[3,4]);
 assert.equal(appended.confirm,'PRODUCTION EVENT BATCH APPEND');
});
