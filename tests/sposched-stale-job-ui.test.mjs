import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');
const fn=html.slice(html.indexOf('function showWorkerBatchState(state){'),html.indexOf('async function refreshWorkerBatch('));
for(const mode of ['independent-fixtures-v1','knockout-four-v1'])test(`rejected new request cannot show old ${mode} job as current completion`,()=>{
 const nodes=new Map(),saved=new Map([['event','rejected-new-request']]);let hidden=0,rendered=0;
 const context={workerLatestState:null,workerBatchPolling:true,snapshot:{eventId:'event'},
  $:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);},
  localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},
  workerBatchStorageKey:id=>id,workerBatchRecreatePendingKey:id=>id+':pending',
  jobControlPayload:()=>{throw Error('no job controls');},
  hasRecreatedBracket:()=>mode==='knockout-four-v1',
  hasRecreatedIndependentFixtures:()=>mode==='independent-fixtures-v1',
  hideCompletionPanel:()=>hidden++,setBatchBusy:()=>{},renderAutoSummary:()=>rendered++};
 vm.createContext(context);vm.runInContext(fn+';showWorkerBatchState({event_id:"event",request_id:"official-old-request",status:"completed",layout_mode:'+JSON.stringify(mode)+'});',context);
 assert.equal(saved.get('event'),'official-old-request');assert.equal(hidden,1);assert.equal(rendered,1);
 assert.match(nodes.get('workerBatchStatus').textContent,/古い試合ID/);
 assert.doesNotMatch(nodes.get('workerBatchStatus').textContent,/全操作.*完了/);
});
