import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');
const fn=html.slice(html.indexOf('function renderIndependentTestSummary(root){'),html.indexOf('function renderAutoSummary(){'));
function render({count=1,verified=false,unresolved=false,marker='existing-job',unfinished=false}={}){
 const nodes=new Map();
 const context={snapshot:{eventId:'event',matches:Array.from({length:count},(_,i)=>({seq:i+1,status:unfinished&&i===0?'scheduled':'finished'}))},rows:[],
  workerLatestState:null,workerRestoredEvent:'event',batchBusy:false,autoBusy:false,workerBatchPolling:false,
  $:id=>{if(!nodes.has(id))nodes.set(id,{dataset:{}});return nodes.get(id);},
  localStorage:{getItem:()=> marker},workerBatchStorageKey:id=>id,workerBatchRecreatePendingKey:id=>id,
  hasRecreatedIndependentFixtures:()=>false,pendingForEvent:()=>unresolved?[{}]:[],
  hasVerifiedCurrentCompletion:()=>verified,node:()=>({}),quickGoalDecisions:()=>[],
  prepareIndependentWorkerBatch:()=>{throw Error('公式試合の番号・ID・未開始状態を確認できません');}};
 vm.createContext(context);vm.runInContext(fn+';renderIndependentTestSummary({append(){}})',context);
 return nodes;
}
for(const count of [1,2,3])test(`${count} verified finished fixtures show completion, not a new-write readiness error`,()=>{
 const nodes=render({count,verified:true});
 assert.match(nodes.get('workerBatchReadiness').textContent,new RegExp('現在の'+count+'試合は登録・照合済み'));
 assert.doesNotMatch(nodes.get('workerBatchReadiness').textContent,/修正が必要/);
 assert.equal(nodes.get('workerBatchRun').disabled,true);
 assert.equal(nodes.get('workerBatchJumpToGoal').hidden,true);
});
for(const count of [1,2,3])for(const marker of ['existing-job',null])test(`${count} finished fixtures with marker ${marker} show official completion without claiming job verification`,()=>{
 const nodes=render({count,marker});
 const text=nodes.get('workerBatchReadiness').textContent;
 assert.match(text,/SSでは全試合終了済み/);
 assert.match(text,/再登録は不要/);
 assert.match(text,/保存済みジョブとの照合は未完了/);
 assert.doesNotMatch(text,/登録・照合済み|登録前に修正が必要/);
 assert.equal(nodes.get('workerBatchRun').disabled,true);
 assert.equal(nodes.get('workerBatchRecreate').disabled,true);
});
for(const options of [{count:0},{count:2,unfinished:true}])test(`unfinished or empty fixtures retain readiness errors: ${JSON.stringify(options)}`,()=>{
 const nodes=render(options);
 assert.match(nodes.get('workerBatchReadiness').textContent,/登録前に修正が必要/);
 assert.doesNotMatch(nodes.get('workerBatchReadiness').textContent,/全試合終了済み/);
 assert.equal(nodes.get('workerBatchRun').disabled,true);
});
test('unresolved writes take precedence over an unverified finished snapshot',()=>{
 const nodes=render({unresolved:true});
 assert.match(nodes.get('workerBatchReadiness').textContent,/未照合の送信記録/);
 assert.doesNotMatch(nodes.get('workerBatchReadiness').textContent,/全試合終了済み/);
 assert.equal(nodes.get('workerBatchRun').disabled,true);
});
test('unresolved writes retain the recovery warning even after verified completion',()=>{
 assert.match(render({verified:true,unresolved:true}).get('workerBatchReadiness').textContent,/未照合/);
});
test('switching events clears another event\'s completion, timing and decision controls',()=>{
 const reset=html.slice(html.indexOf('function clearOtherWorkerEvent(){'),html.indexOf('function renderAutoSummary(){'));
 const nodes=new Map();
 const context={snapshot:{eventId:'new'},workerLatestState:{event_id:'old',status:'completed'},
  $:id=>{if(!nodes.has(id))nodes.set(id,{textContent:'old success',hidden:false});return nodes.get(id);}};
 vm.createContext(context);vm.runInContext(reset+';clearOtherWorkerEvent()',context);
 assert.equal(context.workerLatestState,null);
 assert.equal(nodes.get('workerBatchStatus').textContent,'');
 for(const id of ['workerTimingDetails','workerBatchDecision','workerBatchPause','workerBatchResume'])assert.equal(nodes.get(id).hidden,true);
 context.workerLatestState={event_id:'new',status:'running'};
 nodes.get('workerBatchStatus').textContent='current progress';
 vm.runInContext('clearOtherWorkerEvent()',context);
 assert.equal(nodes.get('workerBatchStatus').textContent,'current progress');
});
