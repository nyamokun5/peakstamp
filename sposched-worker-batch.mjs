/** STAGING ONLY: turn the full human-reviewed 4-match PeakStamp goal set into
 * one durable Worker job. Pure, with no browser/network/storage side effects.
 * The Worker independently resolves official fixture/player UUIDs and checks
 * every signed mutation before calling the existing per-match write gate.
 */
import {waitingKnockoutGoalIssue,ssManualHelperGoal,deferredHelperAssist} from './sposched-quick-review.mjs?v=helper-wait-side1';
import {proposedMatchHelpers} from './sposched-helper-plan.mjs?v=wait-side1';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const name=v=>typeof v==='string'?v.trim():'';
const normalized=v=>name(v).normalize('NFKC').toLocaleLowerCase('en').replace(/[\s\u3000]/g,'');
const fail=message=>{throw Error(message)};
export const workerBatchStorageKey=eventId=>'peakstamp:test:worker-batch:'+eventId;
export function verifyCompletedWorkerSnapshot(state,fresh,previous){
 if(state?.status!=='completed'||fresh?.eventId!==state.event_id||
    previous?.eventId!==state.event_id)fail('完了したジョブのイベントIDが異なります');
 if(fresh.matches?.length!==4)fail('完了後の4試合を取得できません');
 for(const seq of [1,2,3,4]){
  const matches=fresh.matches.filter(m=>m.seq===seq);
  const expected=state.fixture_ids?.[seq]||previous.matches?.find(m=>m.seq===seq)?.matchId;
  const m=matches[0];
  if(matches.length!==1||!UUID.test(expected||'')||
     m.matchId?.toLowerCase()!==expected.toLowerCase()||m.status!=='finished')
   fail('試合 #'+seq+' の終了状態・正式な試合IDを確認できません。再登録せずSSを確認してください');
 }
 return true;
}
export function prepareWorkerTournament({snapshot,rows,decisions,requestId,winnerFor=()=>''}){
 if(!snapshot||!UUID.test(snapshot.eventId||'')||!UUID.test(requestId||''))
  fail('テストSSの正式なイベントとジョブIDが必要です');
 const matches=snapshot.matches||[];
 if(matches.length!==4||![1,2,3,4].every(seq=>matches.some(m=>m.seq===seq)))
  fail('4試合の正式なトーナメントのみ高速登録に対応しています');
 if(matches.some(m=>!['scheduled','waiting'].includes(m.status)))
  fail('すでに終了した試合があります。従来の個別確認を使ってください');
 if(!Array.isArray(rows)||!Array.isArray(decisions)||decisions.length!==rows.length)
  fail('全ゴールの確認結果を取得できません');
 const selected=[],signatures=new Set();
 for(let i=0;i<rows.length;i++){
  const row=rows[i],decision=decisions[i];
  if(!row?.include)continue;
  if(decision?.state==='manual-ss'){
   // Only automatically exclude a verified cross-team scenario from the
   // batch. Do not silently finalize a match while a manual goal is missing:
   // enter it directly in SS first, then GET-refresh the official snapshot.
   const manual=ssManualHelperGoal(snapshot,row);
   if(!manual||decision.registeredInSS!==manual.registered)
    fail('ゴール'+(i+1)+'：助っ人の登録状態が変わりました。SSを再取得してください');
   if(!manual.registered)
    fail('ゴール'+(i+1)+'：助っ人のゴールはSSで直接登録後、最新データを再取得してください');
   continue;
  }
  const seq=Number(row.seq),fixture=matches.find(m=>m.seq===seq);
  if(!fixture)fail('ゴール'+(i+1)+'：試合番号が未設定です');
  if(row.goal?.manual||row.updateGoalId||row.guest||row.fixtureIdentityChanged)
   fail('ゴール'+(i+1)+'：高速登録に未対応のデータがあります');
  if(decision?.state!=='ready'&&decision?.state!=='waiting')
   fail('ゴール'+(i+1)+'：'+(decision?.reason||'確認が必要です'));
  if(decision.state==='waiting'&&!decision.helperPlan){
   // A known 3rd-place/final slot is queued until SpoSched resolves its
   // opponents. Only uncertain match/player evidence needs correction.
   const issue=waitingKnockoutGoalIssue(snapshot,row);
   if(issue)fail('ゴール'+(i+1)+'：'+issue);
  }
  const scorer=name(row.scorer);
  const helperPlan=proposedMatchHelpers(snapshot,row);
  if(JSON.stringify(decision.helperPlan||null)!==JSON.stringify(helperPlan||null))
   fail('ゴール'+(i+1)+'：助っ人の登録計画が変わりました。再確認してください');
  const team=name(helperPlan?.team||row.team||snapshot.playerTeam?.get(scorer));
  // Recompute independently: a forged/obsolete UI flag cannot remove an
  // assistant from a goal or authorize a cross-team player.
  const verifiedDeferred=helperPlan?null:deferredHelperAssist(snapshot,row);
  if(Boolean(decision.deferredAssist)!==Boolean(verifiedDeferred)||
     (verifiedDeferred&&(
      decision.deferredAssist.person!==verifiedDeferred.person||
      decision.deferredAssist.homeTeam!==verifiedDeferred.homeTeam||
      decision.deferredAssist.scoringTeam!==verifiedDeferred.scoringTeam)))
   fail('ゴール'+(i+1)+'：助っ人のアシスト除外を再検証できません。最新情報を取得してください');
  const assist=verifiedDeferred?'':row.assistMode==='named'?name(row.assist):'';
  if(!scorer||!team||!['named','none'].includes(row.assistMode)||
     row.assistMode==='named'&&!verifiedDeferred&&!assist)
   fail('ゴール'+(i+1)+'：チーム・得点者・アシスト状態を確認してください');
  if(assist&&normalized(assist)===normalized(scorer))
   fail('ゴール'+(i+1)+'：同じ選手を得点者とアシスト者に指定できません');
  if(snapshot.playerTeam?.get(scorer)&&normalized(snapshot.playerTeam.get(scorer))!==normalized(team)&&
    !helperPlan?.helpers.some(h=>h.name===scorer&&normalized(h.team)===normalized(team)))
   fail('ゴール'+(i+1)+'：得点者の所属と得点チームが異なります');
  if(assist&&snapshot.playerTeam?.get(assist)&&normalized(snapshot.playerTeam.get(assist))!==normalized(team)&&
    !helperPlan?.helpers.some(h=>h.name===assist&&normalized(h.team)===normalized(team)))
   fail('ゴール'+(i+1)+'：アシスト者の所属と得点チームが異なります');
  const signature=[seq,normalized(team),normalized(scorer),normalized(assist)].join('|');
  if(signatures.has(signature))
   fail('同じ試合・得点者・アシストのゴールが複数あります。高速登録を中止します');
  signatures.add(signature);
  selected.push({seq,action:'create',team,scorer,assist,helpers:helperPlan?.helpers||[]});
 }
 if(selected.length>20)fail('高速登録は最大20ゴールです');
 const operations=[],seenHelpers=new Set();
 for(const seq of [1,2,3,4]){
  const fixture=matches.find(m=>m.seq===seq);
  const expected_match_id=UUID.test(fixture.matchId||'')?fixture.matchId:null;
  if(fixture.status==='scheduled'&&!expected_match_id)
   fail('試合 #'+seq+' の正式なmatch_idを取得できません');
  for(const goal of selected.filter(s=>s.seq===seq)){
   for(const helper of goal.helpers){
    const key=[seq,normalized(helper.team),normalized(helper.name)].join('|');
    if(seenHelpers.has(key))continue;
    seenHelpers.add(key);
    operations.push({seq,action:'helper',team:helper.team,
     name:helper.name,expected_match_id});
   }
   const {helpers,...create}=goal;
   operations.push({...create,expected_match_id});
  }
  const winner=winnerFor(seq)||'auto';
  if(!['auto','left','right','draw'].includes(winner)||
     seq<3&&winner==='draw')fail('試合 #'+seq+' の勝敗指定が不正です');
  operations.push({seq,action:'finish',winner,expected_match_id});
 }
 return {event_id:snapshot.eventId,request_id:requestId,
  confirm:'TEST-ONLY BATCH WRITE',operations};
}


// A local marker is event-scoped, but the new bracket must be a *separate*
// generation. The server performs independent read-only official 404 checks.
export const workerBatchRecreatePendingKey=eventId=>
 'peakstamp:test:worker-batch:recreate-pending:'+eventId;
export function hasRecreatedBracket(state,snapshot){
 if(!state||!snapshot||state.event_id!==snapshot.eventId)return false;
 const previous=state.fixture_ids||{};
 const matches=snapshot.matches||[];
 if(matches.length!==4||!['1','2'].every(seq=>UUID.test(previous[seq]||'')))
  return false;
 const current={};
 for(const m of matches){
  if(!Number.isInteger(m.seq)||m.seq<1||m.seq>4||current[m.seq]||
     !UUID.test(m.matchId||''))return false;
  current[m.seq]=m.matchId.toLowerCase();
 }
 const previousIds=Object.values(previous).filter(id=>UUID.test(id)).map(id=>id.toLowerCase());
 return [1,2,3,4].every(seq=>current[seq])&&
  previousIds.every(id=>!Object.values(current).includes(id))&&
  current[1]!==previous['1'].toLowerCase()&&
  current[2]!==previous['2'].toLowerCase();
}
