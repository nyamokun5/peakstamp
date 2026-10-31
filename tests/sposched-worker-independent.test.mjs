import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeSpoSnapshot,prepareGoalRows} from '../sposched-review-core.mjs';
import {makeManualGoal} from '../sposched-manual-goals.mjs';
import {quickGoalDecisions} from '../sposched-quick-review.mjs';
import {prepareWorkerIndependent,verifyIndependentWorkerCompletion,assertIndependentWorkerHealth,assertRetiredIndependentWorkerHealth,isRetiredIndependentJob,hasDifferentIndependentGeneration,describeCompletedWorkerMismatch,assertRetiredWorkerReconnectable} from '../sposched-worker-independent.mjs';
const eventId='01234567-89ab-4cde-8abc-0123456789ab',requestId='11234567-89ab-4cde-8abc-0123456789ab';
const mid=i=>'21234567-89ab-4cde-8abc-'+String(i).padStart(12,'0');
const make=(count,overrides={})=>normalizeSpoSnapshot({event_id:eventId,roster_source:'official-current-event-teams',
 matches:Array.from({length:count},(_,i)=>({
  seq:i+1,match_id:mid(i+1),title:count===5?'#'+(1+Math.floor(i/2))+' Pitch'+(1+i%2):'リーグ #'+(i+1),
  left_team:i%2?'Red':'White',right_team:i%2?'White':'Red',
  status:'scheduled',left_score:0,right_score:0,goals:[],
  ...overrides[i+1]
 })),
 roster:{White:['Aki','Sora'],Red:['Mika']}});
const build=(snapshot,rows=[],decisions=[])=>prepareWorkerIndependent({snapshot,rows,decisions,requestId});
test('SS one, two, three, five and eight independent fixtures use the exact official UUIDs',()=>{
 for(const n of [1,2,3,5,8]){
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

test('retired completed Worker diagnosis works without local marker authority and never claims safe success',()=>{
 const official=make(3);
 const old={event_id:eventId,request_id:requestId,status:'completed',
  layout_mode:'four-knockout',fixture_count:4,
  fixture_ids:{1:mid(11),2:mid(12),3:mid(13),4:mid(14)}};
 const otherId='41234567-89ab-4cde-8abc-0123456789ab';
 const mismatched=describeCompletedWorkerMismatch(old,official,otherId);
 assert.equal(mismatched.changed,true);
 assert.equal(mismatched.workerCount,4);
 assert.equal(mismatched.currentCount,3);
 assert.equal(mismatched.known,4);
 assert.equal(mismatched.localMatches,false);
 assert.match(mismatched.detail,/旧4試合.*3試合/);
 assert.match(mismatched.detail,/保存ジョブIDとWorkerが一致しません/);
 assert.equal(mismatched.detail.includes(mid(11)),false,'diagnostic must not reveal UUIDs');
 const matching=describeCompletedWorkerMismatch(old,official,requestId);
 assert.equal(matching.localMatches,true);
 assert.equal(describeCompletedWorkerMismatch(old,official,null).changed,true);
 assert.equal(describeCompletedWorkerMismatch({...old,status:'running'},official,otherId),null);
 assert.equal(describeCompletedWorkerMismatch({...old,event_id:otherId},official,otherId),null);
 const partial=describeCompletedWorkerMismatch({...old,fixture_ids:{1:mid(11),2:mid(12)}},official,requestId);
 assert.equal(partial.known,2);
 assert.match(partial.detail,/2\/4件/);
 const same={...old,layout_mode:'independent-fixtures-v1',
  fixture_count:3,fixture_ids:{1:mid(1),2:mid(2),3:mid(3)}};
 const unverified=describeCompletedWorkerMismatch(same,official,requestId);
 assert.equal(unverified.changed,false);
 assert.deepEqual(unverified.unverified,[1,2,3]);
 assert.match(unverified.detail,/終了未確認の試合/);
});

test('local-only reattachment demands two authentic completed fixtures, no uncertainty or active execution',()=>{
 const snapshot=make(3), oldRequest='41234567-89ab-4cde-8abc-0123456789ab';
 const state={environment:'STAGING ONLY',inspection_contract:'event-inspect-v1',
  inspection_only:true,execution_active:false,status:'completed',event_id:eventId,
  request_id:requestId,layout_mode:'four-knockout',fixture_count:4,
  fixture_ids:{1:mid(11),2:mid(12),3:mid(13),4:mid(14)},
  completed:11,total:11};
 const check=(changes={},other={})=>assertRetiredWorkerReconnectable({
  state:{...state,...changes},snapshot,storedRequestId:oldRequest,...other
 });
 assert.deepEqual(check(),{eventId,previousRequestId:oldRequest,
  workerRequestId:requestId,oldCount:4,newCount:3});
 for(const modification of [
  {status:'running'},{completed:10},{total:10},{inspection_only:false},
  {inspection_contract:'unknown'},{execution_active:true},{environment:'PRODUCTION'},
  {fixture_ids:{1:mid(11),2:mid(12)}},{fixture_ids:{...state.fixture_ids,1:mid(1)}},
  {event_id:'11234567-89ab-4cde-8abc-0123456789ab'}
 ])assert.throws(()=>check(modification));
 assert.throws(()=>check({}, {pendingGoals:true}));
 assert.throws(()=>check({}, {pendingRecreation:true}));
 assert.throws(()=>check({}, {storedRequestId:requestId}),
  'same current job must never be silently reattached');
 assert.throws(()=>check({}, {storedRequestId:'invalid'}));
 assert.throws(()=>assertRetiredWorkerReconnectable({
  state,snapshot:make(3,{1:{status:'finished'}}),storedRequestId:oldRequest}));
 const html=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');
 const listener=html.slice(
  html.indexOf("$('workerBatchReconnect').addEventListener('click'"),
  html.indexOf("$('workerBatchRecreate').addEventListener('click'"));
 assert.match(listener,/\/staging\/batch\/inspect/);
 assert.doesNotMatch(listener,/\/staging\/batch\/(?:start|recreate|decision|resume)/);
 const backup=listener.indexOf("localStorage.setItem(backupKey");
 const pointer=listener.indexOf('localStorage.setItem(key,second.request_id)');
 assert.ok(backup>0&&pointer>backup,'backup must be written BEFORE changing pointer');
 assert.match(listener,/snapKey\(fresh\)!==initial/);
 assert.match(listener,/journalKey\(first\)!==journalKey\(second\)/);
});

test('two teams can play one official game or repeated fixtures with distinct IDs and a confirmed scorer',()=>{
 const single=make(1);
 const p1=build(single);
 assert.equal(p1.fixture_count,1);
 assert.deepEqual(p1.operations,[{seq:1,action:'finish',winner:'auto',expected_match_id:mid(1)}]);

 const repeat=make(2,{1:{title:'第1試合 チーム1 vs チーム2'},
  2:{title:'第2試合 チーム1 vs チーム2',left_team:'White',right_team:'Red'}});
 const row={include:true,seq:2,scorer:'Aki',team:'White',assistMode:'none',assist:'',goal:{}};
 const plan=build(repeat,[row],[{state:'ready'}]);
 assert.equal(plan.fixture_count,2);
 assert.deepEqual(plan.operations.map(x=>[x.action,x.seq,x.expected_match_id]),[
  ['finish',1,mid(1)],['create',2,mid(2)],['finish',2,mid(2)]
 ]);
 assert.equal(plan.operations[1].scorer,'Aki');
 assert.equal(plan.operations[1].team,'White');
 // An identical team pairing does NOT allow reusing the first match UUID.
 assert.throws(()=>build(make(2,{2:{match_id:mid(1)}})),/試合|ID|公式/);
 assert.throws(()=>build(make(2,{2:{status:'finished'}})),/#2 終了済み/);
 assert.throws(()=>build(make(2,{2:{left_score:1}})),/スコア|ゴール|試合/);
 assert.throws(()=>build(make(2,{2:{goals:[{goal_id:mid(77)}]}})),/ゴール|試合/);
 const wrong={...row,seq:1};
 const swapped=build(repeat,[wrong],[{state:'ready'}]);
 assert.equal(swapped.operations[0].expected_match_id,mid(1));
});

test('two-team completion verifies every current official match independently, not just team names',()=>{
 const fresh=make(2,{1:{status:'finished'},2:{status:'finished'}});
 const state={event_id:eventId,status:'completed',layout_mode:'independent-fixtures-v1',
  fixture_count:2,fixture_ids:{1:mid(1),2:mid(2)}};
 assert.equal(verifyIndependentWorkerCompletion(state,fresh,make(2)),true);
 for(const wrong of [
  make(2,{1:{status:'finished'},2:{status:'scheduled'}}),
  make(2,{1:{status:'finished'},2:{status:'finished',match_id:mid(11)}}),
  make(1,{1:{status:'finished'}})
 ])assert.throws(()=>verifyIndependentWorkerCompletion(state,wrong,make(2)));
 assert.throws(()=>verifyIndependentWorkerCompletion({...state,fixture_ids:{1:mid(2),2:mid(1)}},
  fresh,make(2)));
});

test('video-free manual goal with explicitly confirmed SS players joins two-team Worker fixture batch',()=>{
 const official=make(2,{2:{left_team:'White',right_team:'Red',title:'#2 紅白戦'}});
 const g=makeManualGoal('31234567-89ab-4cde-8abc-0123456789ab');
 const [row]=prepareGoalRows({goals:[g]},official);
 assert.equal(row.confirmed,false);
 Object.assign(row,{seq:2,scorer:'Aki',team:'White',
  assistMode:'named',assist:'Sora'});
 let decisions=quickGoalDecisions(official,[row]);
 assert.equal(decisions[0].state,'manual','manual draft must never be auto-eligible before human approval');
 assert.equal(build(official,[row],decisions).operations.filter(x=>x.action==='create').length,1,
  'manual row is approved with the single final Worker submit, not a per-goal checkbox');
 row.confirmed=true;
 decisions=quickGoalDecisions(official,[row]);
 const plan=build(official,[row],decisions);
 assert.equal(plan.fixture_count,2);
 assert.deepEqual(plan.operations,[
  {seq:1,action:'finish',winner:'auto',expected_match_id:mid(1)},
  {seq:2,action:'create',team:'White',scorer:'Aki',assist:'Sora',expected_match_id:mid(2)},
  {seq:2,action:'finish',winner:'auto',expected_match_id:mid(2)}
 ]);
 assert.equal(plan.operations[1].expected_match_id,official.matches[1].matchId);
});

test('video-free manual goal is blocked on bad SS identity, guest, duplicates, stale or not explicitly approved',()=>{
 const snapshot=make(2),g=makeManualGoal('31234567-89ab-4cde-8abc-0123456789ab');
 const valid={...prepareGoalRows({goals:[g]},snapshot)[0],seq:1,scorer:'Aki',
  team:'White',assist:'Sora',assistMode:'named',confirmed:true};
 const run=row=>build(snapshot,[row],quickGoalDecisions(snapshot,[row]));
 assert.equal(run(valid).operations.filter(x=>x.action==='create').length,1);
 const mutations=[
  {goal:{...g,sent:true}},
  {goal:{...g,source:{name:'動画の偽装'}}},
  {goal:{...g,id:'not-uuid'}},{guest:true},{updateGoalId:mid(50)},
  {fixtureIdentityChanged:true},{seq:99},{team:'Red'},
  {scorer:'nobody'},{assist:'nobody'},
  {assist:'Aki'},{assistMode:'unknown'},{include:true,scorer:''}
 ];
 for(const changes of mutations){
  assert.throws(()=>run({...valid,...changes}),undefined,
   'manual goal must fail closed: '+JSON.stringify(changes));
 }
 const duplicate=make(2,{1:{goals:[{
  goal_id:mid(88),scorer:'Aki',assist:'Sora',team:'White'
 }]}});
 assert.throws(()=>build(duplicate,[valid],quickGoalDecisions(duplicate,[valid])));
 const r1={...valid,goal:makeManualGoal('31234567-89ab-4cde-8abc-0123456789ab')};
 const r2={...valid,goal:makeManualGoal('41234567-89ab-4cde-8abc-0123456789ab')};
 assert.throws(()=>build(snapshot,[r1,r2],quickGoalDecisions(snapshot,[r1,r2])),/重複|確認/);
});

test('manual goal cannot be bundled with the legacy four-knockout Worker',()=>{
 const knockout=make(4,{1:{title:'#1 準決勝'},2:{title:'#2 準決勝'},
  3:{title:'#3 3位決定戦',status:'waiting',left_team:'',right_team:''},
  4:{title:'#4 決勝',status:'waiting',left_team:'',right_team:''}});
 const row={...prepareGoalRows({goals:[makeManualGoal('31234567-89ab-4cde-8abc-0123456789ab')]},knockout)[0],
  seq:1,scorer:'Aki',team:'White',assistMode:'none',confirmed:true};
 assert.throws(()=>build(knockout,[row],quickGoalDecisions(knockout,[row])),/独立試合/);
});

test('video-free Worker blocks an otherwise confirmed draft from a stale or unverified event roster',()=>{
 const current=make(2),draft=makeManualGoal('31234567-89ab-4cde-8abc-0123456789ab');
 const [row]=prepareGoalRows({goals:[draft]},current);
 Object.assign(row,{seq:1,scorer:'Aki',team:'White',assistMode:'none',confirmed:true});
 const choices=quickGoalDecisions(current,[row]);
 assert.equal(build(current,[row],choices).operations.filter(op=>op.action==='create').length,1);
 const old={...current,rosterSource:''};
 assert.throws(()=>build(old,[row],choices),/現在の(?:SSチーム編成|チーム名簿)/);
});

test('missing current-roster proof blocks even zero-goal independent match finishes',()=>{
 const good=make(2);
 assert.equal(build(good).fixture_count,2);
 for(const rosterSource of ['', 'event-embedded-fallback','unverified-refresh-failed']){
  assert.throws(()=>build({...good,rosterSource}),/現在のチーム名簿/);
 }
});

