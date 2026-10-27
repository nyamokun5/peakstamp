import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeSpoSnapshot,prepareGoalRows,preserveReviewRows}
 from '../sposched-review-core.mjs';
import {quickGoalDecisions,prepareQuickGoalBatch,editQuickGoalField,quickAIObservation}
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
 // Changing a player or team does NOT approve an ambiguous match.
 r[0].quickEdited=true;
 r[0].quickReviewedFields={team:true};
 assert.equal(quickGoalDecisions(s,r)[0].state,'attention');
 r[0].quickReviewedFields={match:true};
 assert.equal(quickGoalDecisions(s,r)[0].state,'ready',
  'explicit match-field verification does not bypass strict final validation');
 r[0].seq=99;
 assert.equal(quickGoalDecisions(s,r)[0].state,'attention');
});
test('editing team cannot silently approve an uncertain scorer or assist',()=>{
 const s=snap(),r=rows(s);
 r[0].scorerGuess={confidence:'medium'};
 r[0].assistGuess={confidence:'medium'};
 r[0].quickEdited=true;
 r[0].quickReviewedFields={team:true};
 assert.equal(quickGoalDecisions(s,r)[0].state,'attention');
 r[0].quickReviewedFields={team:true,scorer:true};
 assert.equal(quickGoalDecisions(s,r)[0].state,'attention',
  'uncertain assist remains blocked after only scorer review');
 r[0].quickReviewedFields={team:true,scorer:true,assist:true};
 assert.equal(quickGoalDecisions(s,r)[0].state,'ready');
 r[0].quickReviewedAll=true;
 r[0].scorer='';
 assert.equal(quickGoalDecisions(s,r)[0].state,'attention',
  'explicit review never bypasses a missing required field');
});
test('reviewing an uncertain row requires explicit action and is not inherited by a different event',()=>{
 const s=snap(),r=rows(s);
 r[0].matchGuess.conflict=true;
 r[0].scorerGuess={confidence:'medium'};
 assert.equal(quickGoalDecisions(s,r)[0].state,'attention');
 r[0].quickReviewedAll=true;
 assert.equal(quickGoalDecisions(s,r)[0].state,'ready');
 const next=preserveReviewRows(rows(s),r,{sameEvent:true,snapshot:s});
 assert.equal(next[0].quickReviewedAll,true);
 const different=preserveReviewRows(rows(s),r,{sameEvent:false,snapshot:s});
 assert.equal(different[0].quickReviewedAll,undefined);
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
 const s=snap(),a=rows(s);a[0].quickEdited=true;a[0].quickReviewedFields={scorer:true};
 const b=rows(s);
 const stayed=preserveReviewRows(b,a,{sameEvent:true,snapshot:s});
 assert.equal(stayed[0].quickEdited,true);
 assert.deepEqual(stayed[0].quickReviewedFields,{scorer:true});
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
 assert.match(html,/\$\('reviewArea'\)\.hidden=quickMode&&!\(preserveEdits&&wasEditing\)/);
 const preview=html.split("$('quickPreview').addEventListener('click',async()=>{")[1]
  .split("$('quickExecute').addEventListener('click'")[0];
 assert.doesNotMatch(preview,/\/staging\/execute/);
 assert.doesNotMatch(preview,/\$\('batchExecute'\)\.click/);
 assert.match(preview,/\/staging\/preview/);
 assert.match(html,/if\(\$\('ssEnvironment'\)\.value!=='staging'\|\|!loadedFromStagingDirect\)/);
});

test('compact editing fixes uncertain goal without any per-goal checkbox',()=>{
 const x=snap(),r=rows(x);
 r[0].scorer='';r[0].assistMode='unknown';r[0].assist='';
 assert.equal(quickGoalDecisions(x,r)[0].state,'attention');
 editQuickGoalField(x,r[0],'scorer','西村');
 assert.equal(r[0].scorer,'西村');
 assert.equal(r[0].quickReviewedFields.scorer,true);
 assert.equal(quickGoalDecisions(x,r)[0].state,'attention','unknown assist still blocked');
 editQuickGoalField(x,r[0],'assistMode','none');
 assert.equal(r[0].assistMode,'none');
 assert.equal(r[0].quickReviewedFields.assist,true);
 const result=quickGoalDecisions(x,r)[0];
 assert.equal(result.state,'ready');
 assert.equal(result.assist,'なし');
 assert.equal(r[0].confirmed,false,'one final batch approval still required');
 assert.equal(prepareQuickGoalBatch(x,r).payload.operations.length,2);
});
test('changing match does not silently approve an uncertain scorer',()=>{
 const x=snap(),r=rows(x);
 r[0].scorerGuess={confidence:'medium'};
 editQuickGoalField(x,r[0],'match',1);
 assert.equal(r[0].quickReviewedFields.match,true);
 assert.equal(r[0].quickReviewedFields.scorer,undefined);
 assert.equal(quickGoalDecisions(x,r)[0].state,'attention');
 editQuickGoalField(x,r[0],'scorer','西村');
 assert.equal(quickGoalDecisions(x,r)[0].state,'ready');
});
test('assist player is not silently assumed, and cross-team selection fails closed',()=>{
 const x=snap(),r=rows(x);
 r[0].assistMode='unknown';
 editQuickGoalField(x,r[0],'assistMode','named');
 assert.equal(quickGoalDecisions(x,r)[0].state,'attention');
 editQuickGoalField(x,r[0],'assist','佐藤');
 assert.equal(quickGoalDecisions(x,r)[0].state,'ready');
 editQuickGoalField(x,r[0],'assist','橋本');
 assert.equal(quickGoalDecisions(x,r)[0].state,'attention');
 assert.match(quickGoalDecisions(x,r)[0].reason,/得点チーム/);
});
test('team mismatch, invalid roster names and unknown fields never become sendable',()=>{
 const x=snap(),r=rows(x);
 editQuickGoalField(x,r[0],'team','チーム2');
 assert.equal(quickGoalDecisions(x,r)[0].state,'attention');
 assert.match(quickGoalDecisions(x,r)[0].reason,/得点チーム/);
 assert.throws(()=>editQuickGoalField(x,r[0],'scorer','不正選手'),/名簿/);
 assert.throws(()=>editQuickGoalField(x,r[0],'match',99),/試合番号/);
 assert.throws(()=>editQuickGoalField(x,r[0],'team','チーム9'),/得点チーム/);
 assert.throws(()=>editQuickGoalField(x,r[0],'assistMode','nothing'),/アシスト/);
 assert.throws(()=>editQuickGoalField(x,r[0],'whoops','西村'),/未知/);
 const restored=editQuickGoalField(x,r[0],'scorer','橋本');
 assert.equal(restored.team,'チーム2');
 assert.equal(quickGoalDecisions(x,r)[0].state,'attention',
  'cross-team selected assist is not permitted');
});
test('compact UI renders assist -> scorer in review and pre-send summary',()=>{
 const html=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');
 assert.match(html,/item\.assist\+' → '\+\(item\.scorer\|\|'得点者未確定'\)/);
 assert.match(html,/\\nアシスト → 得点：/);
 assert.match(html,/const quickOpenRows=new Set\(\)/);
 assert.match(html,/editQuickGoalField\(snapshot,row,field,menu\.value\)/);
 assert.match(html,/quick-field/);
 assert.match(html,/renderGoals\(\); \/\/ keep exceptional detail editor in sync/);
 assert.doesNotMatch(html,/top\.append\(node\('strong','#'\+\(item\.index\+1\)\+' '\+\(item\.scorer/);
});

test('original AI-heard player names remain visible after correcting official roster selections',()=>{
 const x=snap(),r=rows(x);
 const aiBefore=quickAIObservation(r[0]);
 assert.equal(aiBefore.assistRaw,'佐藤');
 assert.equal(aiBefore.scorerRaw,'西村');
 assert.deepEqual(aiBefore.scorerCandidates,['西村']);
 assert.deepEqual(aiBefore.assistCandidates,['佐藤']);
 editQuickGoalField(x,r[0],'scorer','橋本');
 editQuickGoalField(x,r[0],'assistMode','none');
 assert.deepEqual(quickAIObservation(r[0]),aiBefore,
  'The AI original is not rewritten to the newly selected official scorer or assist');
 assert.equal(r[0].scorer,'橋本');
 assert.equal(r[0].assistMode,'none');
});

test('unheard goal, AI no-assist and ambiguous name candidates are described accurately',()=>{
 const x=snap(),r=rows(x);
 r[0].goal.scorer='';
 r[0].goal.assist='';
 r[0].goal.assistStatus='unknown';
 r[0].scorerHints=[
  {name:'西村'}, {name:'橋本'}, {name:'西村'}, {name:'佐藤'},{name:'豊田'}
 ];
 r[0].assistHints=[];
 const ambiguous=quickAIObservation(r[0]);
 assert.equal(ambiguous.scorerRaw,'聞き取れず');
 assert.equal(ambiguous.assistRaw,'不明（AI判定）');
 assert.deepEqual(ambiguous.scorerCandidates,['西村','橋本','佐藤']);
 assert.deepEqual(ambiguous.assistCandidates,[]);
 r[0].goal.assistStatus='named';
 assert.equal(quickAIObservation(r[0]).assistRaw,'名前を聞き取れず');
 r[0].goal.assistStatus='none';
 const withoutAssist=quickAIObservation(r[0]);
 assert.equal(withoutAssist.assistRaw,'なし（AI判定）');
 assert.equal(withoutAssist.noAssist,true);
 assert.deepEqual(withoutAssist.assistCandidates,[]);
});

test('conflicting AI assist text and no-assist status do not silently erase extracted words',()=>{
 const x=snap(),r=rows(x);
 r[0].goal.assist='豊田';
 r[0].goal.assistStatus='none';
 assert.equal(quickAIObservation(r[0]).assistRaw,'豊田（AI判定：アシストなし）');
});

test('all quick goal cards show AI original and suggested roster names without confirmation checks',()=>{
 const html=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');
 assert.match(html,/const heard=quickAIObservation\(row\)/);
 assert.match(html,/AI聞き取り：/);
 assert.match(html,/SS名簿候補：アシスト /);
 assert.match(html,/heard\.assistRaw\+' → '\+heard\.scorerRaw/);
 assert.match(html,/quick-ai-evidence/);
 assert.match(html,/el\.append\(aiBox\)/);
 const quick=html.slice(html.indexOf('function renderQuick(){'),
  html.indexOf("$('quickEdit').addEventListener"));
 assert.doesNotMatch(quick,/\.innerHTML\s*=/);
 assert.match(quick,/node\('div','AI聞き取り：'/);
 assert.match(quick,/id='no-op-impossible'|el\.append\(aiBox\)/);
});
