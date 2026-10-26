import test from 'node:test';
import assert from 'node:assert/strict';
import {TEST_TEAM_ID,selectBatchOperations,previewReviewedBatch,
 executeReviewedBatch,BatchStopped} from '../sposched-staging-batch.mjs';
const ID='4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d';
const op=(seq,scorer,assist='')=>({action:'record_goal',args:{
 event_id:'5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e',seq,team:'チーム1',
 scorer,...(assist?{assist}:{})},fromPeakStamp:{source:'game1.mov',goalId:'g'+seq+scorer}});
const plan={operations:[op(1,'太郎','花子'),op(2,'次郎'),{action:'record_match',args:{seq:1}}]};
const nameOf=operation=>operation.args.scorer;
const actionOf=operation=>({action:'create',match_id:ID,side:'left',
 scorer_id:operation.args.scorer,assist_id:operation.args.assist||null});
const preview=action=>({environment:'STAGING ONLY',team_id:TEST_TEAM_ID,
 preview_token:'signed-'+action.scorer_id,plan:{action:'create',match_id:ID,
 side:'left',goal_id:null,before:null,after:{scorer:action.scorer_id,assist:action.assist_id}}});
test('filters unsupported operations and requires only reviewed explicitly selected goals',()=>{
 const selected=selectBatchOperations(plan,[0,1]);
 assert.deepEqual(selected.map(x=>x.index),[0,1]);
 assert.throws(()=>selectBatchOperations(plan,[2]),/未対応/);
 assert.throws(()=>selectBatchOperations(plan,[1,1]),/重複/);
 assert.throws(()=>selectBatchOperations(plan,[]),/1～20/);
 assert.throws(()=>selectBatchOperations({operations:[op(1,'太郎'),op(1,'太郎')]},[0,1]),/同じ試合/);
});
test('previews all selected goals without any execute calls; verifies test tenant',async()=>{
 const selected=selectBatchOperations(plan,[0,1]);
 let posts=0;
 const entries=await previewReviewedBatch({selected,resolveAction:async op=>actionOf(op),
  previewAction:async action=>preview(action)});
 assert.equal(entries.length,2);
 assert.equal(posts,0);
 assert.deepEqual(entries.map(e=>e.plan.after.scorer),['太郎','次郎']);
 await assert.rejects(previewReviewedBatch({selected,resolveAction:async op=>actionOf(op),
  previewAction:async action=>({...preview(action),team_id:'WRONG'})}),/テスト団体/);
});
test('executes two selected goals in order using fresh signed previews, no overlap',async()=>{
 const selected=selectBatchOperations(plan,[0,1]);
 const entries=await previewReviewedBatch({selected,resolveAction:async op=>actionOf(op),
  previewAction:async action=>preview(action)});
 const events=[];
 const completed=await executeReviewedBatch({entries,
  resolveAction:async op=>{events.push('read '+nameOf(op));return actionOf(op)},
  previewAction:async action=>{events.push('preview '+action.scorer_id);return preview(action)},
  executeAction:async body=>{
   events.push('write '+body.scorer_id);
   assert.equal(body.confirm,'TEST-ONLY WRITE');
   assert.equal(body.preview_token,'signed-'+body.scorer_id);
   return {write_sent:true,readback:{verified:true}};
  },
  onProgress:event=>events.push(event.phase+' '+event.current)
 });
 assert.equal(completed.length,2);
 assert.deepEqual(events,[
  'sending 1','read 太郎','preview 太郎','write 太郎','verified 1',
  'sending 2','read 次郎','preview 次郎','write 次郎','verified 2']);
});
test('stops at the first ambiguous response with accurate partial successes; no retries',async()=>{
 const selected=selectBatchOperations(plan,[0,1]);
 const entries=await previewReviewedBatch({selected,resolveAction:async op=>actionOf(op),
  previewAction:async action=>preview(action)});
 const posts=[];
 let error;
 try{await executeReviewedBatch({entries,resolveAction:async op=>actionOf(op),
  previewAction:async action=>preview(action),
  executeAction:async action=>{
   posts.push(action.scorer_id);
   return action.scorer_id==='太郎'?
    {write_sent:true,readback:{verified:true}}:{write_sent:true,readback:{verified:false}};
  }});}catch(e){error=e}
 assert.ok(error instanceof BatchStopped);
 assert.equal(error.completed.length,1);
 assert.equal(error.failedIndex,1);
 assert.deepEqual(posts,['太郎','次郎']);
});
test('stops before POST if team verification, reviewed action or preview has changed',async()=>{
 const selected=selectBatchOperations(plan,[0,1]);
 const entries=await previewReviewedBatch({selected,resolveAction:async op=>actionOf(op),
  previewAction:async action=>preview(action)});
 let writeCount=0;
 await assert.rejects(executeReviewedBatch({entries,
  resolveAction:async op=>({...actionOf(op),scorer_id:'changed'}),
  previewAction:async action=>preview(action),
  executeAction:async()=>{writeCount++;return {write_sent:true,readback:{verified:true}};}}),
  /事前確認から変わりました/);
 assert.equal(writeCount,0);
 await assert.rejects(executeReviewedBatch({entries,
  resolveAction:async op=>actionOf(op),
  previewAction:async action=>({...preview(action),plan:{...preview(action).plan,
   after:{scorer:'unexpected',assist:null}}}),
  executeAction:async()=>{writeCount++;return {write_sent:true,readback:{verified:true}};}}),
  /一括確認時から変わりました/);
 assert.equal(writeCount,0);
});
