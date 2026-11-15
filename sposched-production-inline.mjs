// In-place production registration. Reuses production gates and canonical
// planners; no TEST transport, confirmation strings or journals are used.
import {confirmedGoalExport,createGoalDrafts} from './goal-stats.mjs';
import {prepareGoalRows} from './sposched-review-core.mjs?v=official-guest1';
import {projectFourMatchTournament} from './sposched-inline-tournament.mjs';
import {quickGoalDecisions} from './sposched-quick-review.mjs';
import {prepareProductionBatch,validateProductionReleaseEvidence,
 validateIndependentProductionReleaseEvidence,productionBatchStorageKey} from './sposched-production-release.mjs';
import {prepareIndependentWorkerBatch} from './sposched-independent-worker-batch.mjs';
import {prepareWorkerTournament,verifyCompletedWorkerSnapshot} from './sposched-worker-batch.mjs';
import {buildProductionSecondRoundAppend} from './sposched-production-continuation.mjs';
import {verifyCompletedIndependentSnapshot} from './sposched-independent-completion.mjs';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const independent=s=>['1team','2teams_1pitch','3teams_1pitch'].includes(s?.officialFormat);
const fail=message=>{throw Error(message)};
const personIdentity=p=>p?{name:p.name,memberId:p.memberId,playerId:p.playerId,team:p.team}:null;
const semanticGoals=goals=>JSON.stringify((goals?.goals||[]).map(g=>({id:g.id,source:g.source,
 time:g.time,goalTimeSeconds:g.goalTimeSeconds,scorer:g.scorer,assist:g.assist,
 assistStatus:g.assistStatus,matchSeq:g.matchSeq,teamA:g.teamA,teamB:g.teamB,manual:g.manual,
 identityEnvironment:g.ssIdentity?.environment,identityEvent:g.ssIdentity?.eventId,
 scorerIdentity:personIdentity(g.ssIdentity?.scorer),assistIdentity:personIdentity(g.ssIdentity?.assist)})));
function assertJob(job,eventId,requestId=null){
 if(!job||job.environment!=='PRODUCTION'||job.event_id!==eventId||!UUID.test(job.request_id||'')||
    requestId&&job.request_id!==requestId||job.inspection_only!==true||
    job.inspection_contract!=='event-inspect-v1'||job.scope!=='event')
  fail('本番の保存済み登録ジョブを確認できません。再送しないでください');
 return job;
}
function releaseIdentity(snapshot,official,release){
 if(snapshot?.environment!=='production'||!UUID.test(snapshot.eventId||'')||
    release?.environment!=='PRODUCTION'||release.event_id!==snapshot.eventId||
    release.target_event_id!==snapshot.eventId||release.scope!=='current-target'||release.release_ready!==true||
    official?.environment!=='PRODUCTION'||official.event_id!==snapshot.eventId||
    official.mode!=='read-only'||official.team_pinned!==true||official.write_allowed!==false||official.release_approved!==false||
    !UUID.test(official.team_id||'')||!Array.isArray(official.matches)||official.matches.length!==snapshot.matches?.length)
  fail('本番の対象イベント・団体・登録許可を確認できません');
 for(const match of snapshot.matches){
  const found=official.matches.filter(m=>Number(m.seq)===Number(match.seq));
  if(found.length!==1||String(found[0].match_id||'').toLowerCase()!==String(match.matchId||'').toLowerCase()||
     found[0].status!==match.status)fail('本番の公式試合ID・状態が変わりました');
 }
 return {team:official.team_id,fixtures:snapshot.matches.map(m=>({seq:m.seq,id:m.matchId,status:m.status,leftTeam:m.leftTeam,rightTeam:m.rightTeam}))};
}
export function createProductionInlineController({getSnapshot,getGoals,refreshContext,readOfficial,
 inspectBatch,startBatch,appendSecondRound,decideBatch,storage,
 wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),maxChecks=120,
 onStatus=()=>{},onDecision=()=>{},onComplete=()=>{},randomUUID=()=>crypto.randomUUID()}){
 let busy=false,pendingDecision=null;
 const key=productionBatchStorageKey;
 const inputKey=id=>key(id)+':inline-inputs';
 const appendKey=(id,requestId)=>key(id)+':append:'+requestId;
 const verify=(id,signature)=>{
  if(getSnapshot()?.eventId!==id||getSnapshot()?.environment!=='production')fail('SSイベントが変更されました。登録を停止しました');
  if(semanticGoals(getGoals())!==signature)fail('ゴールの登録内容が変更されました。再送せず進捗を確認してください');
 };
 const currentJob=async(id,requestId)=>assertJob(await inspectBatch(id),id,requestId);
 async function evidence(id,signature){
  const snapshot=await refreshContext(id);verify(id,signature);
  const [official,release]=await Promise.all([
   readOfficial('/production/inspect?event_id='+encodeURIComponent(id)),
   readOfficial('/production/release-state?event_id='+encodeURIComponent(id))]);
  verify(id,signature);return {snapshot,official,release,identity:releaseIdentity(snapshot,official,release)};
 }
 function rowsFor(snapshot){
  const rows=prepareGoalRows(getGoals(),snapshot);
  if(!rows.length)fail('SS登録対象の確定済みゴールがありません');
  return rows;
 }
 function startPlan(e,requestId){
  const {snapshot,official,release}=e,rows=rowsFor(snapshot);
  const validate=independent(snapshot)?validateIndependentProductionReleaseEvidence:validateProductionReleaseEvidence;
  validate(snapshot,official,release);
  const staged=!independent(snapshot)&&snapshot.matches.some(m=>[3,4].includes(m.seq)&&m.status==='waiting');
  // Validate all reviewed goals before the first write, including the later
  // pairings when semifinal scores unambiguously determine them.
  if(!independent(snapshot))projectFourMatchTournament(snapshot,rows);
  const selected=rows;
  const decisions=quickGoalDecisions(snapshot,selected);
  const plan=independent(snapshot)?prepareIndependentWorkerBatch({snapshot,rows:selected,decisions,requestId}):
   prepareProductionBatch({snapshot,rows:selected,decisions,requestId});
  return staged?{...plan,layout_mode:'four-knockout-staged-v1',operations:plan.operations.filter(op=>op.seq<=2)}:plan;
 }
 async function completed(job,baseline,id,signature){
  const fresh=await refreshContext(id);verify(id,signature);
  if(!Number.isInteger(job.total)||job.total<1||job.completed!==job.total||job.cursor!==job.total)
   fail('登録完了の件数を確認できません。再送しないでください');
  if(independent(baseline))verifyCompletedIndependentSnapshot(job,fresh,baseline);
  else verifyCompletedWorkerSnapshot(job,fresh,baseline);
  const receiptIds=new Set();
  for(const receipt of job.goal_receipts||[]){
   const goalId=receipt.official_goal_id||receipt.goal_id,matchId=receipt.official_match_id||receipt.match_id;
   if(!UUID.test(goalId||'')||receiptIds.has(goalId)||
      !fresh.matches.find(m=>m.matchId===matchId)?.existingGoals?.some(g=>g.id===goalId))
    fail('登録したゴールの公式記録を確認できません。再送しないでください');
   receiptIds.add(goalId);
  }
  onStatus('✓ '+fresh.matches.length+'試合の登録完了');onComplete(job,fresh);return job;
 }
 async function continuation(job,id,signature){
  const before=await currentJob(id,job.request_id);verify(id,signature);
  const e=await evidence(id,signature);
  const snapshot=e.snapshot,rows=rowsFor(snapshot).filter(r=>[3,4].includes(Number(r.seq)));
  const projected={...snapshot,matches:snapshot.matches.map(m=>[1,2].includes(m.seq)?{...m,status:'scheduled'}:m)};
  const plan=prepareWorkerTournament({snapshot:projected,rows,decisions:quickGoalDecisions(snapshot,rows),requestId:job.request_id});
  const payload=buildProductionSecondRoundAppend({snapshot,workerJob:before,operations:plan.operations.filter(op=>op.seq>=3)});
  const again=await currentJob(id,job.request_id);
  if(JSON.stringify({status:again.status,cursor:again.cursor,total:again.total,fixtures:again.fixture_ids})!==
     JSON.stringify({status:before.status,cursor:before.cursor,total:before.total,fixtures:before.fixture_ids}))
   fail('準決勝ジョブが変更されました。進捗を確認してください');
  verify(id,signature);
  const pending=appendKey(id,job.request_id);
  if(storage.getItem(pending)!==null)fail('後半登録は送信済みの可能性があります。再送せず進捗を確認してください');
  storage.setItem(pending,JSON.stringify({operation_count:payload.operations.length,attempted_at:Date.now()}));
  onStatus('後半2試合を登録中…');
  const result=await appendSecondRound(payload);verify(id,signature);
  if(result?.event_id!==id||result?.request_id!==job.request_id)fail('後半登録の応答が不明です。再送しないでください');
  return currentJob(id,job.request_id);
 }
 async function follow(job,{id,signature,baseline,allowAppend}){
  for(let n=0;n<maxChecks;n++){
   verify(id,signature);assertJob(job,id,job.request_id);
   if(job.status==='completed')return completed(job,baseline,id,signature);
   if(job.status==='needs_decision'){
    pendingDecision={job,id,signature,baseline,allowAppend};onDecision(job);
    onStatus('同点の試合があります。勝者を選んでください');return job;
   }
   if(job.status==='awaiting_second_round'){
    if(!allowAppend){onStatus('準決勝は登録済みです。「ゴールをSSに登録」で後半を続けられます');return job;}
    job=await continuation(job,id,signature);allowAppend=false;continue;
   }
   if(job.status!=='running'||job.execution_active!==true)
    fail('登録は停止中、または結果未確認です。再送せず進捗を確認してください');
   onStatus('SSに登録中… '+job.completed+'/'+job.total);
   await wait(1500);verify(id,signature);job=await currentJob(id,job.request_id);
  }
  fail('完了確認に時間がかかっています。「登録結果を確認」で進捗を確認してください');
 }
 async function operation(task){
  if(busy)return null;busy=true;
  try{return await task();}finally{busy=false;}
 }
 const controller={
  isBusy:()=>busy,
  start:()=>operation(async()=>{
   pendingDecision=null;
   const initial=getSnapshot(),id=initial?.eventId;
   if(initial?.environment!=='production'||!UUID.test(id||''))fail('最初の画面で本番SSイベントに接続してください');
   const signature=semanticGoals(getGoals());verify(id,signature);
   onStatus('登録履歴を確認中…');
   const known=await inspectBatch(id);verify(id,signature);
   const local=storage.getItem(key(id));
   if(known){
    assertJob(known,id,local||null);
    if(local&&local!==known.request_id)fail('保存済みジョブが一致しません。再送しないでください');
    storage.setItem(key(id),known.request_id);
    // Reopening an old job never creates a new one. An explicit registration
    // tap may append its waiting second round after fresh official validation.
    const prior=storage.getItem(inputKey(id));
    if(prior&&prior!==signature)fail('前回送信したゴールと内容が異なります。再送せずSSを確認してください');
    const allowAppend=known.status==='awaiting_second_round'||prior===signature;
    if(!prior&&known.status==='awaiting_second_round')storage.setItem(inputKey(id),signature);
    return follow(known,{id,signature,baseline:initial,allowAppend});
   }
   if(local)fail('端末に送信履歴があります。結果を確認できるまで再送できません');
   if(!(getGoals()?.goals||[]).length)fail('確定済みのゴールがありません');
   onStatus('登録内容を確認中…');
   const requestId=randomUUID(),first=await evidence(id,signature),plan=startPlan(first,requestId);
   const latest=await evidence(id,signature),checked=startPlan(latest,requestId);
   if(JSON.stringify(first.identity)!==JSON.stringify(latest.identity)||JSON.stringify(plan)!==JSON.stringify(checked))
    fail('登録先の試合またはゴールが変更されました');
   const raced=await inspectBatch(id);verify(id,signature);
   if(raced)fail('別の登録ジョブが見つかりました。登録結果を確認してください');
   if(storage.getItem(key(id)))fail('別の送信履歴が見つかりました。再送しないでください');
   storage.setItem(inputKey(id),signature);storage.setItem(key(id),requestId);
   onStatus('SSに登録中…');
   const result=await startBatch(plan);verify(id,signature);
   if(result?.event_id!==id||result?.request_id!==requestId)fail('登録の応答が不明です。再送しないでください');
   return follow(await currentJob(id,requestId),{id,signature,baseline:first.snapshot,allowAppend:true});
  }),
  inspect:()=>operation(async()=>{
   pendingDecision=null;
   const initial=getSnapshot(),id=initial?.eventId;
   if(initial?.environment!=='production'||!UUID.test(id||''))fail('本番SSイベントを選択してください');
   onStatus('登録結果を確認中…');
   const signature=semanticGoals(getGoals()),job=await inspectBatch(id);verify(id,signature);
   if(!job){onStatus(storage.getItem(key(id))?'送信履歴がありますが結果を確認できません。再送しないでください':'登録履歴がありません');return null;}
   assertJob(job,id,storage.getItem(key(id))||null);
   storage.setItem(key(id),job.request_id);
   return follow(job,{id,signature,baseline:initial,allowAppend:false});
  }),
  decide:winner=>operation(async()=>{
   const pending=pendingDecision;if(!pending)fail('勝者確認待ちのジョブがありません');
   const {id,signature,baseline,allowAppend}=pending;
   const job=await currentJob(id,pending.job.request_id),fresh=await refreshContext(id);verify(id,signature);
   const d=job.decision,m=fresh.matches.find(m=>m.seq===d?.seq);
   if(job.status!=='needs_decision'||job.phase!=='preparing'||!d?.choices?.includes(winner)||
      !['left','right','draw'].includes(winner)||!m||!UUID.test(m.matchId||'')||d.match_id!==m.matchId||
      m.status!=='scheduled'||m.leftScore!==m.rightScore||m.leftScore!==d.left_score||m.rightScore!==d.right_score||
      JSON.stringify(job.decision)!==JSON.stringify(pending.job.decision)||job.cursor!==pending.job.cursor)
    fail('勝者確認の対象試合・得点が変わりました');
   for(const [seq,matchId] of Object.entries(job.fixture_ids||{})){
    if(matchId&&(!UUID.test(matchId)||fresh.matches.find(m=>m.seq===Number(seq))?.matchId!==matchId))
     fail('保存済みジョブと公式試合IDが一致しません');
   }
   await evidence(id,signature);
   const marker=key(id)+':decision:'+job.request_id+':'+d.seq;
   if(storage.getItem(marker)!==null)fail('結果指定は送信済みの可能性があります。再送せず進捗を確認してください');
   storage.setItem(marker,JSON.stringify({winner,cursor:job.cursor}));pendingDecision=null;
   const result=await decideBatch({event_id:id,request_id:job.request_id,seq:d.seq,winner,confirm:'PRODUCTION EVENT BATCH DECISION'});
   if(result?.event_id!==id||result?.request_id!==job.request_id)fail('結果指定の応答が不明です。再送しないでください');
   return follow(await currentJob(id,job.request_id),{id,signature,baseline,allowAppend});
  })
 };
 return controller;
}

export function installProductionInline({state,ssNames,goalReview,document=globalThis.document,storage=globalThis.localStorage,wait,maxChecks}){
 const $=id=>document.getElementById(id),button=$('ssInlinePreview'),status=$('ssInlineStatus'),matches=$('ssInlineMatches');
 if(!button||!status)return null;
 const showError=e=>{status.textContent=e?.message||'登録結果を確認できません。再送せず進捗を確認してください';};
 const invoke=async task=>{
  if(controller.isBusy())return;button.disabled=true;
  button.textContent='確認中…';button.setAttribute('aria-busy','true');
  status.textContent='登録状況を確認中…';
  try{await task();}catch(e){showError(e);}finally{
   button.disabled=false;button.textContent='ゴールをSSに登録';button.removeAttribute('aria-busy');
  }
 };
 const controller=createProductionInlineController({
  getSnapshot:()=>state.ssNameContext?.snapshot,
  getGoals:()=>confirmedGoalExport(state.sources,storage),
  refreshContext:async id=>{
   await ssNames.refresh();goalReview.refresh();
   const snapshot=state.ssNameContext?.snapshot;
   if(snapshot?.eventId!==id||snapshot.environment!=='production')fail('本番SSイベントが変更されました');
   return snapshot;
  },readOfficial:path=>ssNames.readOfficial(path),inspectBatch:id=>ssNames.inspectBatch(id),
  startBatch:plan=>ssNames.startBatch(plan),appendSecondRound:plan=>ssNames.appendSecondRound(plan),
  decideBatch:plan=>ssNames.decideBatch(plan),storage,wait,maxChecks,
  onStatus:message=>{status.textContent=message;},
  onComplete:()=>{matches?.replaceChildren();if(matches)matches.hidden=true;},
  onDecision:job=>{
   matches.replaceChildren();matches.hidden=false;
   for(const winner of job.decision?.choices||[]){
    const choice=document.createElement('button');choice.type='button';choice.className='whisper-run';
    choice.textContent=winner==='draw'?'引き分け':(winner==='left'?job.decision.left_team:job.decision.right_team)+'の勝ち';
    choice.addEventListener('click',()=>invoke(async()=>{
     for(const element of matches.querySelectorAll('button'))element.disabled=true;
     await controller.decide(winner);
    }));matches.append(choice);
   }
  }
 });
 button.textContent='ゴールをSSに登録';
 button.addEventListener('click',()=>invoke(async()=>{
  const unresolved=state.sources.flatMap(source=>createGoalDrafts(source,storage).items.filter(g=>g.status!=='excluded'&&g.status!=='confirmed'));
  if(unresolved.length){goalReview.refresh();fail('未確定のゴールが'+unresolved.length+'件あります。選手名と動画を確認してください');}
  matches?.replaceChildren();if(matches)matches.hidden=true;
  await controller.start();
 }));
 const inspect=()=>invoke(()=>controller.inspect());
 $('ssInlineInspect')?.addEventListener('click',inspect);$('ssInlineHistory')?.addEventListener('click',inspect);
 if($('ssInlineSummary'))$('ssInlineSummary').textContent='確認済みゴールと試合結果を、この画面で登録します。';
 return controller;
}
