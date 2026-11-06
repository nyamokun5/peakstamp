import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {verifyCompletedIndependentSnapshot,hasRecreatedIndependentFixtures} from '../sposched-independent-completion.mjs';
const html=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');
const fn=html.slice(html.indexOf('async function refreshWorkerBatch('),html.indexOf('// Recovery navigation is GET-only.'));
const eventId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const id=n=>'11111111-2222-4111-8111-11111111111'+n;
async function run({replacement=false,networkError=false}={}){
 const snapshot={eventId,matches:[1,2].map(seq=>({seq,matchId:id(seq+(replacement?5:0)),status:'finished'}))};
 const state={event_id:eventId,request_id:'saved-request',status:'completed',layout_mode:'independent-fixtures-v1',fixture_count:2,fixture_ids:{1:id(1),2:id(2)}};
 const saved=new Map([[eventId,'saved-request']]),nodes=new Map([['ssEnvironment',{value:'staging'}]]),calls=[];
 let shown=0;
 const ctx={snapshot,workerBatchPolling:false,loadedFromStagingDirect:true,
  $:key=>{if(!nodes.has(key))nodes.set(key,{});return nodes.get(key);},
  localStorage:{getItem:k=>saved.get(k),setItem:()=>{throw Error('unexpected saved-state write');},removeItem:()=>{throw Error('unexpected saved-state removal');}},
  workerBatchStorageKey:k=>k,workerBatchRecreatePendingKey:k=>k+':pending',
  postStaging:async route=>{calls.push(route);assert.equal(route,'/staging/batch/inspect');return state;},
  fetchSS:async route=>{calls.push(route);if(networkError)throw Error('network unavailable');return snapshot;},
  normalizeSpoSnapshot:x=>x,verifyCompletedIndependentSnapshot,hasRecreatedIndependentFixtures,
  hasRecreatedBracket:()=>false,hideCompletionPanel:()=>{},
  showWorkerBatchState:()=>shown++,rebuild:()=>{},setBatchBusy:()=>{}};
 vm.createContext(ctx);await vm.runInContext(fn+';refreshWorkerBatch({passive:true})',ctx);
 return {ctx,nodes,saved,calls,shown};
}
test('finished replacement fixtures stop without asking for a futile refresh or clearing saved evidence',async()=>{
 const r=await run({replacement:true});
 const message=r.nodes.get('workerBatchStatus').textContent;
 assert.match(message,/正式IDが異なります/);
 assert.match(message,/再登録・試合の作り直し・送信履歴の削除はせず/);
 assert.doesNotMatch(message,/「進捗を再取得」を押してください/);
 assert.equal(r.nodes.get('workerBatchRun').disabled,true);
 assert.equal(r.ctx.workerBatchPolling,false);
 assert.equal(r.saved.get(eventId),'saved-request');assert.equal(r.shown,0);
 assert.equal(r.calls.length,2);
});
test('temporary snapshot failure retains the existing progress recovery advice',async()=>{
 const r=await run({networkError:true});
 assert.match(r.nodes.get('workerBatchStatus').textContent,/「進捗を再取得」を押してください/);
 assert.doesNotMatch(r.nodes.get('workerBatchStatus').textContent,/再取得だけでは/);
 assert.equal(r.shown,0);assert.equal(r.saved.get(eventId),'saved-request');
});
test('matching finished fixture IDs still reach verified completion',async()=>{
 const r=await run();assert.equal(r.shown,1);assert.equal(r.saved.get(eventId),'saved-request');
});
