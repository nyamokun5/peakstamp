import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeSpoSnapshot} from '../sposched-review-core.mjs';
import {prepareWorkerIndependent,verifyIndependentWorkerCompletion,assertIndependentWorkerHealth,assertRetiredIndependentWorkerHealth,isRetiredIndependentJob,hasDifferentIndependentGeneration} from '../sposched-worker-independent.mjs';
const eventId='01234567-89ab-4cde-8abc-0123456789ab',requestId='11234567-89ab-4cde-8abc-0123456789ab';
const mid=i=>'21234567-89ab-4cde-8abc-'+String(i).padStart(12,'0');
const make=(count,overrides={})=>normalizeSpoSnapshot({event_id:eventId,
 matches:Array.from({length:count},(_,i)=>({
  seq:i+1,match_id:mid(i+1),title:count===5?'#'+(1+Math.floor(i/2))+' Pitch'+(1+i%2):'リーグ #'+(i+1),
  left_team:i%2?'Red':'White',right_team:i%2?'White':'Red',
  status:'scheduled',left_score:0,right_score:0,goals:[],
  ...overrides[i+1]
 })),
 roster:{White:['Aki','Sora'],Red:['Mika']}});
const build=(snapshot,rows=[],decisions=[])=>prepareWorkerIndependent({snapshot,rows,decisions,requestId});
test('SS one, three, five and eight independent fixtures use the exact official UUIDs',()=>{
 for(const n of [1,3,5,8]){
  const s=make(n),p=build(s);
  assert.equal(p.layout_mode,'independent-fixtures-v1');assert.equal(p.fixture_count,n);
  assert.equal(p.operations.length,n);
  assert.deepEqual(p.operations.map(x=>x.expected_match_id),Array.from({length:n},(_,i)=>mid(i+1)));
  assert.deepEqual(p.operations.map(x=>x.seq),Array.from({length:n},(_,i)=>i+1));
 }
});
test('reviewed goal is bound to official seq and unique match ID',()=>{
 const s=make(3);
 const row={include:true,seq:2,scorer:'Mika',team:'Red',assistMode:'named',assist:'Sora',
  goal:{}};
 assert.throws(()=>build(s,[row],[{state:'ready'}]),/所属/);
 row.assistMode='none';row.assist='';
 const p=build(s,[row],[{state:'ready'}]);
 assert.deepEqual(p.operations.slice(1,3),[
  {seq:2,action:'create',scorer:'Mika',team:'Red',assist:'',expected_match_id:mid(2)},
  {seq:2,action:'finish',winner:'auto',expected_match_id:mid(2)}
 ]);
});
test('unsafe fixtures and unreviewed goals stop before planning',()=>{
 for(const snapshot of [
  make(3,{2:{status:'waiting'}}),make(3,{3:{status:'finished'}}),
  make(3,{1:{left_score:2}}),make(3,{1:{match_id:''}}),
  make(3,{2:{title:'#2 決勝'}}),make(3,{2:{left_team:'White',right_team:'White'}}),
  make(3,{2:{goals:[{goal_id:mid(22),scorer:'Mika',team:'Red'}]}})
 ])assert.throws(()=>build(snapshot));
 const s=make(3),row={include:true,seq:1,scorer:'Aki',team:'White',
  assistMode:'none',goal:{}};
 for(const decision of [{state:'attention',reason:'名前が不明'}, {state:'waiting'},
  {state:'ready',helperPlan:{team:'White'}}])
  assert.throws(()=>build(s,[row],[decision]));
});
test('blocked 3-match schedules identify the exact SS fixture and never permit batch',()=>{
 const completed=make(3,{1:{status:'finished'}});
 assert.throws(()=>build(completed),/#1 終了済み/);
 const waiting=make(3,{3:{status:'waiting'}});
 assert.throws(()=>build(waiting),/#3 対戦待ち/);
 const unknown=make(3,{2:{status:'collecting'}});
 assert.throws(()=>build(unknown),/#2 状態 collecting/);
});

test('independent completion requires the same event and all fresh exact finished IDs',()=>{
 const s=make(3),state={event_id:eventId,status:'completed',
  layout_mode:'independent-fixtures-v1',fixture_count:3,
  fixture_ids:{'1':mid(1),'2':mid(2),'3':mid(3)}};
 const fresh=make(3,{1:{status:'finished'},2:{status:'finished'},3:{status:'finished'}});
 assert.equal(verifyIndependentWorkerCompletion(state,fresh,s),true);
 for(const bad of [make(2),make(3,{2:{status:'waiting'}}),
   make(3,{2:{status:'finished',match_id:mid(21)}})])
  assert.throws(()=>verifyIndependentWorkerCompletion(state,bad,s));
});

test('independent TEST batch fails closed when live Worker is stale or not write-ready',()=>{
 const good={service:'shoot-sunday-sync-staging',write_mode:'test-only',
  batch_job_configured:true,independent_batch_contract:'independent-fixtures-v1'};
 assert.equal(assertIndependentWorkerHealth(good),true);
 for(const changes of [
  {independent_batch_contract:undefined},{independent_batch_contract:'durable-four-match-v1'},
  {service:'shoot-sunday-sync'},{write_mode:'read-only'},{batch_job_configured:false}
 ])assert.throws(()=>assertIndependentWorkerHealth({...good,...changes}),/TEST Worker/);
 const ui=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');
 const listener=ui.indexOf("$('workerBatchRun').addEventListener('click'");
 assert.ok(listener>=0);
 const rest=ui.slice(listener,ui.indexOf("let workerControlBusy=false;",listener));
 const capability=rest.indexOf('if(isIndependent) await assertIndependentStagingWorkerReady();');
 const localMarker=rest.indexOf('localStorage.setItem(key,requestId);');
 const mutation=rest.indexOf("postStaging('/staging/batch/start',operations)");
 assert.ok(capability>=0&&localMarker>capability&&mutation>localMarker,
  'GET-only capability preflight must precede the local marker and mutation');
});

test('retired four-match completed job is shown as separate new 3-match generation',()=>{
 const fresh=make(3);
 const old={event_id:eventId,status:'completed',layout_mode:'four-knockout',
  fixture_count:4,fixture_ids:{1:mid(11),2:mid(12),3:mid(13),4:mid(14)}};
 assert.equal(hasDifferentIndependentGeneration(old,fresh),true);
 assert.equal(isRetiredIndependentJob(old,fresh),true);
 assert.equal(isRetiredIndependentJob({...old,status:'running'},fresh),false);
 assert.equal(isRetiredIndependentJob({...old,fixture_ids:{1:mid(11),2:mid(12)}},fresh),false);
 assert.equal(hasDifferentIndependentGeneration({...old,fixture_ids:{1:mid(11),2:mid(12)}},fresh),true,
  'missing IDs must still suppress misleading four-match completion assertion');
 assert.equal(isRetiredIndependentJob({...old,fixture_ids:{...old.fixture_ids,3:mid(2)}},fresh),false);
 assert.equal(isRetiredIndependentJob(old,make(3,{2:{left_score:1}})),false);
 assert.equal(isRetiredIndependentJob(old,make(3,{2:{status:'finished'}})),false);
 assert.equal(isRetiredIndependentJob(old,make(3,{2:{title:'#2 決勝'}})),false);
 assert.equal(hasDifferentIndependentGeneration(old,make(4,{1:{title:'#1 準決勝'},2:{title:'#2 準決勝'},
  3:{title:'#3 ３位決定戦',status:'waiting'},4:{title:'#4 決勝',status:'waiting'}})),false);
});

test('retired fixture migration refuses an old deployed Worker before any mutation',()=>{
 const health={service:'shoot-sunday-sync-staging',write_mode:'test-only',
  batch_job_configured:true,independent_batch_contract:'independent-fixtures-v1'};
 assert.equal(assertIndependentWorkerHealth(health),true);
 assert.throws(()=>assertRetiredIndependentWorkerHealth(health),/旧試合.*安全な切替/);
 assert.equal(assertRetiredIndependentWorkerHealth({...health,
  retired_generation_contract:'retired-independent-v1'}),true);
 const ui=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');
 assert.match(ui,/if\(recreation\)assertRetiredIndependentWorkerHealth\(health\)/);
 const recreate=ui.slice(ui.indexOf("$('workerBatchRecreate').addEventListener('click'"),
  ui.indexOf("$('workerBatchRun').addEventListener('click'"));
 const healthCheck=recreate.indexOf('assertIndependentStagingWorkerReady({recreation:true})');
 const pending=recreate.indexOf('localStorage.setItem(pendingKey');
 const mutation=recreate.indexOf("postStaging('/staging/batch/recreate'");
 assert.ok(healthCheck>=0&&pending>healthCheck&&mutation>pending,
  'public health feature gate must occur before any recreate pending marker or mutation');
});

test('completed Worker UI requires official readback proof before showing a green success panel',()=>{
 const html=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');
 assert.match(html,/let workerCompletionProof=null;/);
 assert.match(html,/function workerCompletionVerified\(state,current\)/);
 assert.match(html,/workerCompletionProof\.fixtureFingerprint!==workerFixtureFingerprint\(current\)/);
 assert.match(html,/workerCompletionProof\.requestId!==state\.request_id/);
 assert.match(html,/localStorage\.getItem\(workerBatchStorageKey\(current\.eventId\)\)!==state\.request_id/);
 const show=html.slice(html.indexOf('function showWorkerBatchState(state){'),
  html.indexOf('async function refreshWorkerBatch(',html.indexOf('function showWorkerBatchState(state){')));
 assert.match(show,/state\.status==='completed'&&workerCompletionVerified\(state,snapshot\)/,
  'Worker status=completed is insufficient to display green success');
 assert.match(show,/Workerの操作履歴は完了していますが、現在のSS公式試合ID・終了状態はまだ照合できていません/);
 const refresh=html.slice(html.indexOf('async function refreshWorkerBatch('),
  html.indexOf('function openPendingRecovery(',html.indexOf('async function refreshWorkerBatch(')));
 assert.ok(refresh.indexOf('hideCompletionPanel();')>=0);
 const proof=refresh.indexOf('workerCompletionProof={eventId,requestId:state.request_id');
 const finalCheck=refresh.indexOf('verifyCompletedWorkerSnapshot(state,fresh,snapshot)');
 const independentCheck=refresh.indexOf('verifyIndependentWorkerCompletion(state,fresh,snapshot)');
 assert.ok(proof>finalCheck&&proof>independentCheck,
  'proof must be issued only AFTER independently verifying official match IDs');
});
