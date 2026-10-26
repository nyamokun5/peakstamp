import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeSpoSnapshot,prepareGoalRows,preserveReviewRows}
 from '../sposched-review-core.mjs';
import {quickGoalDecisions,prepareQuickGoalBatch}
 from '../sposched-quick-review.mjs';
import {selectBatchOperations,previewReviewedBatch,executeReviewedBatch}
 from '../sposched-staging-batch.mjs';

const E='5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e';
const M='4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d';
const snap=()=>normalizeSpoSnapshot({event_id:E,event:'TEST Sunday',
 roster:{'チーム1':['西村','佐藤'],'チーム2':['橋本','豊田']},
 matches:[{seq:1,match_id:M,left_team:'チーム1',right_team:'チーム2',
  left_score:0,right_score:0,goals:[]}]});
const video=(id,scorer,assist=null)=>({
 id,source:{name:'VIDEO_'+id+'.MOV'},matchSeq:1,
 goalTimeSeconds:100,scorer,assist,
 assistStatus:assist?'named':'none',matchLabel:'チーム1対チーム2',
 teamA:'1',teamB:'2'
});
const rows=s=>prepareGoalRows({goals:[video('v1','西村','佐藤'),video('v2','橋本')]},s);
test('normal video-derived goals require one bulk approval, never checkbox per row',()=>{
 const s=snap(),r=rows(s);assert.equal(r[0].confirmed,false);
 const p=prepareQuickGoalBatch(s,r);
 assert.deepEqual(p.decisions.map(x=>x.state),['ready','ready']);
 assert.equal(p.payload.status,'human-reviewed-NOT-SENT');
 assert.deepEqual(p.payload.operations.map(x=>x.action),['record_goal','record_goal']);
 assert.equal(p.payload.operations.length,2);
 assert.equal(r[0].confirmed,false,'quick planning must not mutate legacy confirmation');
 assert.equal(p.selected.length,2);
});
test('missing scorer, unknown assist, wrong match and AI ambiguity are held, never silently approved',()=>{
 const s=snap(),r=rows(s);
 r[0].scorer='';r[1].assistMode='unknown';
 assert.deepEqual(quickGoalDecisions(s,r).map(x=>x.state),['attention','attention']);
 r[0].scorer='西村';r[0].matchGuess.conflict=true;
 r[1].assistMode='none';
 assert.equal(quickGoalDecisions(s,r)[0].state,'attention');
 r[0].quickEdited=true;
 assert.equal(quickGoalDecisions(s,r)[0].state,'ready',
  'human-changed selections still undergo strict row and final validation');
 r[0].seq=99;
 assert.equal(quickGoalDecisions(s,r)[0].state,'attention');
});
test('existing duplicates are omitted while unrelated goals remain available',()=>{
 const s=snap();s.matches[0].existingGoals.push({
  id:'2ff908ce-70a2-4930-8c2a-e5fce089179b',
  scorer:'西村',assist:'佐藤',team:'チーム1'
 });
 const r=rows(s),p=prepareQuickGoalBatch(s,r);
 assert.deepEqual(p.decisions.map(x=>x.state),['duplicate','ready']);
 assert.equal(p.payload.operations.length,1);
 assert.equal(p.payload.operations[0].args.scorer,'橋本');
});
test('two identical selected video goals are held to protect TEST duplicate constraints',()=>{
 const s=snap();
 const r=prepareGoalRows({goals:[video('v1','西村','佐藤'),video('v2','西村','佐藤')]},s);
 const p=prepareQuickGoalBatch(s,r);
 assert.deepEqual(p.decisions.map(x=>x.state),['attention','attention']);
 assert.equal(p.payload,null);
});
test('manual, PATCH and deliberately excluded rows do not enter default video bulk',()=>{
 const s=snap(),r=rows(s);
 r.push({...r[0],key:'manual::1',goal:{...r[0].goal,manual:true}});
 r.push({...r[0],key:'patch::2',updateGoalId:'2ff908ce-70a2-4930-8c2a-e5fce089179b'});
 r.push({...r[1],key:'skip::3',include:false});
 const p=prepareQuickGoalBatch(s,r);
 assert.deepEqual(p.decisions.map(x=>x.state),[
  'ready','ready','manual','patch','skipped'
 ]);
 assert.equal(p.payload.operations.length,2);
});
test('human editor fixes can be retained after same-event refresh but not after event change',()=>{
 const s=snap(),a=rows(s);a[0].quickEdited=true;
 const b=rows(s);
 const stayed=preserveReviewRows(b,a,{sameEvent:true,snapshot:s});
 assert.equal(stayed[0].quickEdited,true);
 const changed=preserveReviewRows(rows(s),a,{sameEvent:false,snapshot:s});
 assert.equal(changed[0].quickEdited,undefined);
});
test('quick flow uses safe two-action dry preview and sequential send, no auto write',async()=>{
 const s=snap(),r=rows(s),p=prepareQuickGoalBatch(s,r);
 const selected=selectBatchOperations(p.payload,[0,1]);
 let writes=0;const before=[];
 const action=x=>({action:'create',match_id:M,side:x.args.team==='チーム1'?'left':'right',
  scorer_id:x.args.scorer,assist_id:x.args.assist||null});
 const preview=async op=>({
  environment:'STAGING ONLY',team_id:'dbb50f85-9d9a-408c-9482-497abbca399c',
  preview_token:'fake-for-test',plan:{action:'create',side:op.side,
   before:null,after:{scorer:op.scorer_id,assist:op.assist_id}}
 });
 const entries=await previewReviewedBatch({selected,resolveAction:async x=>action(x),
  previewAction:preview});
 assert.equal(writes,0);
 const done=await executeReviewedBatch({entries,resolveAction:async x=>action(x),
  previewAction:preview,beforeExecute:async item=>before.push(item.index),
  executeAction:async payload=>{
   writes++;assert.equal(payload.confirm,'TEST-ONLY WRITE');
   return {write_sent:true,readback:{verified:true,goal_id:'TEST-goal-'+writes}};
  }});
 assert.equal(writes,2);assert.equal(done.length,2);
 assert.deepEqual(before,[0,1]);
});
test('default UI has no row confirmation and only final explicit TEST submit can start writes',()=>{
 const html=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');
 assert.match(html,/id="quickPanel"/);
 assert.match(html,/id="quickPreview"/);
 assert.match(html,/id="quickExecute"/);
 assert.match(html,/prepareQuickGoalBatch\(snapshot,rows\)/);
 assert.match(html,/quickSending=true/);
 assert.match(html,/\$\('batchExecute'\)\.click\(\)/);
 assert.match(html,/\$\('reviewArea'\)\.hidden=true/);
 const preview=html.split("$('quickPreview').addEventListener('click',async()=>{")[1]
  .split("$('quickExecute').addEventListener('click'")[0];
 assert.doesNotMatch(preview,/\/staging\/execute/);
 assert.doesNotMatch(preview,/\$\('batchExecute'\)\.click/);
 assert.match(preview,/\/staging\/preview/);
 assert.match(html,/if\(\$\('ssEnvironment'\)\.value!=='staging'\|\|!loadedFromStagingDirect\)/);
});
