/** Build an independent official-fixtures batch for the TEST Worker.
 * Pure function; the worker re-verifies current SS IDs, tenant and scores.
 * Existing four-match knockout is handled by the old separate builder.
 */
import {describeOfficialFixtures} from './sposched-fixture-layout.mjs';
import {normalizeTeam,normalizePerson,validateGoalRow,matchingExistingGoals} from './sposched-review-core.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const fail=reason=>{throw Error(reason)};
const name=v=>typeof v==='string'?v.trim():'';
/** A public GET /health preflight, before the first mutation or local job marker.
 * Verify the deployed STAGING Worker actually supports the independent batch path.
 */
export function assertIndependentWorkerHealth(health){
 if(health?.service!=='shoot-sunday-sync-staging'||
    health?.write_mode!=='test-only'||
    health?.batch_job_configured!==true||
    health?.independent_batch_contract!=='independent-fixtures-v1')
  fail('TEST Workerが可変試合数の最新版ではありません。Cloudflare WorkerのSTAGINGデプロイを確認してください。送信は開始していません');
 return true;
}
/** Pure UI eligibility: an older COMPLETED generation may have been deleted
 * and replaced by a new independent schedule within the SAME TEST event.
 * This is only a button visibility gate. The Worker MUST still prove that
 * every old UUID returns HTTP 404 before any new job is persisted.
 */
/** Different generation detection is observational only. It is intentionally
 * broader than isRetiredIndependentJob: even when missing old UUIDs prevent
 * any safe re-register, the UI must never attempt legacy 4-game completion
 * verification against a newly published 3-game league.
 */
export function hasDifferentIndependentGeneration(state,snapshot){
 if(!state||!snapshot||state.event_id!==snapshot.eventId||
    state.status!=='completed')return false;
 const layout=describeOfficialFixtures(snapshot);
 if(layout.automaticFourMatch||layout.count<1||layout.count>24)return false;
 const expectedCount=state.fixture_count||4;
 if(layout.count!==expectedCount)return true;
 const old=state.fixture_ids||{};
 return layout.matches.some(m=>UUID.test(old[m.seq]||'')&&
  UUID.test(m.matchId||'')&&m.matchId.toLowerCase()!==old[m.seq].toLowerCase());
}
/** Read-only, event-scoped comparison. A saved browser request ID is not
 * authoritative for what is stored in the Durable Object: report mismatch
 * even if localStorage was lost, replaced, or belongs to an earlier job.
 * Never return authorisation to write from this diagnostic.
 */
export function describeCompletedWorkerMismatch(state,snapshot,localRequestId){
 if(!state||!snapshot||state.status!=='completed'||
    state.event_id!==snapshot.eventId)return null;
 const official=describeOfficialFixtures(snapshot);
 const workerCount=Number.isInteger(state.fixture_count)?state.fixture_count:4;
 const currentCount=official.count;
 const ids=state.fixture_ids||{};
 const known=Array.from({length:workerCount},(_,i)=>ids[i+1])
  .filter(id=>UUID.test(id||'')).length;
 const localMatches=Boolean(localRequestId&&state.request_id===localRequestId);
 const numberMismatch=workerCount!==currentCount;
 const differentIds=official.matches.filter(m=>
  UUID.test(ids[m.seq]||'')&&UUID.test(m.matchId||'')&&
  ids[m.seq].toLowerCase()!==m.matchId.toLowerCase()).map(m=>m.seq);
 const unverified=official.matches.filter(m=>m.status!=='finished').map(m=>m.seq);
 const changed=numberMismatch||differentIds.length>0;
 return {changed,workerCount,currentCount,known,localMatches,differentIds,unverified,
  detail:changed
   ?'Workerは旧'+workerCount+'試合、現在のSS公式は'+currentCount+
    '試合です。旧ジョブの正式試合IDは'+known+'/'+workerCount+'件確認できます。'+
    (differentIds.length?'変更された試合番号：#'+differentIds.join('、#')+'。':'')+
    (localMatches?'端末の保存ジョブIDとWorkerは一致しています。':
     '端末の保存ジョブIDとWorkerが一致しません。端末側の記録を削除・上書きしないでください。')
   :'Worker側は'+workerCount+'試合です。'+
    (unverified.length?'SS公式で終了未確認の試合：#'+unverified.join('、#')+'。':
     '現在のSS公式ID・終了状態について最終の再取得照合が必要です。')+
    (localMatches?'':'端末の保存ジョブIDとWorkerが一致しません。')
 };
}
/** A local-only rescue of the event's Worker request pointer.
 * IMPORTANT: This is not a release gate or server-side permission to recreate.
 * Always re-read the authenticated /inspect on the real Worker before invoking.
 */
export function assertRetiredWorkerReconnectable({state,snapshot,storedRequestId,
 pendingGoals=false,pendingRecreation=false}={}){
 if(pendingGoals||pendingRecreation)fail('未照合の登録記録が残っています。先に照合してください');
 if(!UUID.test(storedRequestId||''))fail('端末の旧ジョブIDが不正です。自動復旧しません');
 if(state?.environment!=='STAGING ONLY'||
    state?.inspection_contract!=='event-inspect-v1'||
    state?.inspection_only!==true||
    !UUID.test(state?.request_id||'')||
    !UUID.test(state?.event_id||'')||
    state.request_id===storedRequestId||
    state.status!=='completed'||
    state.execution_active===true||
    !snapshot||state.event_id!==snapshot.eventId)
  fail('TEST Workerの完了記録・ジョブID・イベント範囲を確認できません。変更しません');
 if(!isRetiredIndependentJob(state,snapshot))
  fail('旧試合IDと新公式試合IDを安全に照合できません。変更しません');
 const count=state.fixture_count||4;
 if(!Number.isInteger(state.completed)||!Number.isInteger(state.total)||
    state.total< count||state.completed!==state.total)
  fail('旧Workerの全操作が完了した証明がありません。変更しません');
 return {eventId:state.event_id,previousRequestId:storedRequestId,
  workerRequestId:state.request_id,oldCount:count,
  newCount:describeOfficialFixtures(snapshot).count};
}
export function isRetiredIndependentJob(state,snapshot){
 if(!state||!snapshot||state.event_id!==snapshot.eventId||
    state.status!=='completed')return false;
 const layout=describeOfficialFixtures(snapshot);
 if(layout.automaticFourMatch||layout.count<1||layout.count>24||
    layout.ready!==layout.count||layout.waiting||layout.finished)return false;
 const old=state.fixture_ids||{},oldCount=state.fixture_count||4;
 if(!Number.isInteger(oldCount)||oldCount<1||oldCount>24||
    Object.keys(old).length!==oldCount||
    !Array.from({length:oldCount},(_,i)=>String(i+1)).every(k=>UUID.test(old[k]||'')))
  return false;
 const oldIds=new Set(Object.values(old).map(id=>id.toLowerCase()));
 if(oldIds.size!==oldCount)return false;
 const newIds=new Set();
 for(let i=0;i<layout.count;i++){
  const m=layout.matches[i];
  if(m.seq!==i+1||!UUID.test(m.matchId||'')||
     m.status!=='scheduled'||!m.leftTeam||!m.rightTeam||
     m.leftTeam===m.rightTeam||m.leftScore!==0||m.rightScore!==0||
     m.existingGoals?.length!==0||
     /準決勝|3位決定|３位決定|順位決定|決勝|semifinal|semi-final|final|playoff/i.test(m.title||''))
   return false;
  const id=m.matchId.toLowerCase();
  if(oldIds.has(id)||newIds.has(id))return false;
  newIds.add(id);
 }
 return true;
}
export function assertRetiredIndependentWorkerHealth(health){
 assertIndependentWorkerHealth(health);
 if(health?.retired_generation_contract!=='retired-independent-v1')
  fail('TEST Workerは旧試合から新試合への安全な切替に未対応です。STAGINGの最新版デプロイを確認してください。送信はしていません');
 return true;
}
export function prepareWorkerIndependent({snapshot,rows,decisions,requestId}){
 if(!snapshot||!UUID.test(snapshot.eventId||'')||!UUID.test(requestId||''))
  fail('正式なTESTイベントとジョブIDを確認できません');
 const layout=describeOfficialFixtures(snapshot);
 if(layout.automaticFourMatch||layout.count<1||layout.count>24)
  fail('この試合構成では独立試合の一括登録は使えません');
 if(layout.waiting||layout.finished||layout.ready!==layout.count){
  // Report exactly which SS fixture blocks a safe whole-event write, without
  // guessing a pending/finished match is safe to replay.
  const unsafe=layout.matches.filter(m=>m.status!=='scheduled'||
   !m.matchId||!m.leftTeam||!m.rightTeam);
  const details=unsafe.slice(0,6).map(m=>'#'+m.seq+' '+
   (m.status==='finished'?'終了済み':
    m.status==='waiting'?'対戦待ち':
    m.status!=='scheduled'?'状態 '+(m.status||'不明'):
    '対戦相手または公式試合IDが未設定')).join(' / ');
  fail('対戦確定待ち・終了済みの試合があります。'+
   (details?'該当するSS公式試合：'+details+'。':'')+
   '再登録せずSSの正式な試合状態を確認してください');
 }
 if(!layout.matches.every((m,i)=>m.seq===i+1&&UUID.test(m.matchId||'')&&
    m.status==='scheduled'&&m.leftTeam&&m.rightTeam&&
    m.leftTeam!==m.rightTeam&&m.existingGoals.length===0&&
    m.leftScore===0&&m.rightScore===0))
  fail('試合番号・公式試合ID・初期スコアを確認してください。既存ゴールがある場合は個別確認してください');
 // A repeated two-team pairing still requires a DIFFERENT canonical UUID per
 // game. Match IDs must never be inferred from the same visible teams.
 if(new Set(layout.matches.map(m=>m.matchId.toLowerCase())).size!==layout.count)
  fail('SS公式の試合IDが重複しています。新規登録せず試合番号と正式IDを確認してください');
 if(layout.matches.some(m=>/準決勝|3位決定|３位決定|順位決定|決勝|semifinal|semi-final|final|playoff/i.test(m.title||'')))
  fail('順位決定戦・トーナメントの対戦は独立試合として登録できません');
 if(!Array.isArray(rows)||!Array.isArray(decisions)||decisions.length!==rows.length)
  fail('ゴールの確認結果が揃っていません');
 const selected=[],used=new Set();
 for(let i=0;i<rows.length;i++){
  const row=rows[i],decision=decisions[i];
  if(!row?.include)continue;
  // A video-free goal is permitted ONLY for independent STAGING fixtures,
  // after the operator has explicitly confirmed this exact manual row.
  // It never bypasses the same signed Worker + official UUID verification.
  const manual=row.goal?.manual===true;
  if(manual){
   if(row.goal.source?.name!=='SS手動入力'||!UUID.test(row.goal.id||'')||
      row.goal.sent!==false||decision?.state!=='manual')
    fail('ゴール'+(i+1)+'：未送信のSS手動ゴールであることを確認してください');
   const issue=validateGoalRow(row,snapshot);
   if(issue)fail('ゴール'+(i+1)+'：'+issue);
   if(matchingExistingGoals(row,snapshot).length)
    fail('ゴール'+(i+1)+'：SS登録済みゴールと重複する可能性があります。個別確認してください');
  }else if(decision?.state!=='ready'){
   fail('ゴール'+(i+1)+'：'+(decision?.reason||'選手・試合の確認が必要です'));
  }
  if(row.updateGoalId||row.guest||row.fixtureIdentityChanged||
     decision?.helperPlan||decision?.deferredAssist)
   fail('ゴール'+(i+1)+'：助っ人・既存修正・試合ID変更は個別登録を使ってください');
  const seq=Number(row.seq),match=layout.matches.find(m=>m.seq===seq);
  const team=name(row.team||snapshot.playerTeam?.get(row.scorer)),scorer=name(row.scorer);
  const assist=row.assistMode==='named'?name(row.assist):'';
  if(!match||!team||!scorer||!['named','none'].includes(row.assistMode)||
     row.assistMode==='named'&&!assist||
     ![match.leftTeam,match.rightTeam].some(t=>normalizeTeam(t)===normalizeTeam(team))||
     !snapshot.playerTeam?.has(scorer)||
     normalizeTeam(snapshot.playerTeam.get(scorer))!==normalizeTeam(team)||
     assist&&(!snapshot.playerTeam.has(assist)||
       normalizeTeam(snapshot.playerTeam.get(assist))!==normalizeTeam(team)||
       normalizePerson(assist)===normalizePerson(scorer)))
   fail('ゴール'+(i+1)+'：試合・得点者・所属チームを確認してください');
  const key=[seq,normalizeTeam(team),normalizePerson(scorer),normalizePerson(assist)].join('|');
  if(used.has(key))fail('ゴール'+(i+1)+'：重複の可能性があります。個別確認してください');
  used.add(key);
  selected.push({seq,action:'create',team,scorer,assist,expected_match_id:match.matchId});
 }
 if(selected.length>20)fail('一括登録できるゴールは最大20件です');
 const operations=[];
 for(const m of layout.matches){
  operations.push(...selected.filter(g=>g.seq===m.seq));
  operations.push({seq:m.seq,action:'finish',winner:'auto',expected_match_id:m.matchId});
 }
 return {event_id:snapshot.eventId,request_id:requestId,confirm:'TEST-ONLY BATCH WRITE',
  layout_mode:'independent-fixtures-v1',fixture_count:layout.count,operations};
}
export function verifyIndependentWorkerCompletion(state,fresh,previous){
 if(state?.status!=='completed'||state?.layout_mode!=='independent-fixtures-v1'||
    fresh?.eventId!==state.event_id||previous?.eventId!==state.event_id)
  fail('独立試合ジョブの終了イベントが一致しません');
 const n=state.fixture_count;
 if(!Number.isInteger(n)||n<1||n>24||fresh.matches?.length!==n)
  fail('登録後のSS試合数が一致しません');
 for(const seq of Array.from({length:n},(_,i)=>i+1)){
  const m=fresh.matches.find(item=>item.seq===seq);
  const expected=state.fixture_ids?.[seq];
  if(!m||!UUID.test(expected||'')||m.matchId.toLowerCase()!==expected.toLowerCase()||
     m.status!=='finished')fail('試合 #'+seq+' の正式ID・終了状態を確認できません');
 }
 return true;
}
