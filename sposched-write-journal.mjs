/** Crash-safe TEST-only SpoSched write attempt journal.
 *
 * Record each request BEFORE the HTTP POST. An ambiguous response leaves the
 * journal entry in localStorage across a reload and blocks another write until
 * the user refreshes the official SS match and explicitly resolves it.
 * No API keys, bridge tokens, signed preview tokens or full video data are saved.
 */
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const PREFIX='peakstamp_ss_uncertain_writes_v1:staging:';
const fail=message=>{throw Error(message)};
export function journalKey(eventId){
 if(!UUID.test(String(eventId||'')))fail('テストSSのイベントIDが不正です');
 return PREFIX+eventId;
}
const goalIds=match=>(Array.isArray(match?.goals)?match.goals:[])
 .map(g=>g?.goal_id).filter(id=>UUID.test(id));
const isEntry=e=>e&&typeof e==='object'&&typeof e.goalKey==='string'&&
 e.goalKey.length>2&&e.goalKey.length<400&&
 UUID.test(e.match_id)&&UUID.test(e.event_id)&&
 ['create','patch'].includes(e.action)&&
 UUID.test(e.scorer_id)&&
 (e.assist_id===null||UUID.test(e.assist_id))&&
 (e.action==='create'?['left','right'].includes(e.side):UUID.test(e.goal_id))&&
 Array.isArray(e.beforeGoalIds)&&e.beforeGoalIds.length<=200&&
 e.beforeGoalIds.every(g=>UUID.test(g))&&Number.isFinite(e.startedAt);
export function pendingAttempts(storage,eventId){
 const key=journalKey(eventId);
 let raw;
 try{raw=storage.getItem(key)}
 catch{fail('端末内の送信記録を読み取れません。SSへの書き込みを停止しました')}
 if(raw===null||raw==='')return [];
 let data;
 try{data=JSON.parse(raw)}
 catch{fail('端末内の送信記録が破損しています。安全のためSSへの書き込みを停止しました')}
 if(!Array.isArray(data)||data.length>1||data.some(e=>!isEntry(e)))
  fail('送信記録の形式を確認できません。安全のため書き込みを停止しました');
 return data;
}
const setPending=(storage,eventId,rows)=>{
 try{storage.setItem(journalKey(eventId),JSON.stringify(rows))}
 catch{fail('送信状態を端末に保存できません。安全のため書き込みを停止しました')}
};
export function beginAttempt(storage,eventId,goalKey,action,match,at=Date.now()){
 if(pendingAttempts(storage,eventId).length)
  fail('前回の送信結果が未確認です。SSの最新情報と照合してから続けてください');
 if(!goalKey||typeof goalKey!=='string'||goalKey.length>390)fail('対象ゴールIDが不明です');
 if(!action||!['create','patch'].includes(action.action)||
    !UUID.test(action.match_id)||!UUID.test(action.scorer_id)||
    !(action.assist_id===null||UUID.test(action.assist_id)))
  fail('送信操作が不正です');
 if(action.action==='create'&&!['left','right'].includes(action.side))
  fail('得点チームが不正です');
 if(action.action==='patch'&&!UUID.test(action.goal_id))
  fail('修正するゴールが不明です');
 if(match?.match_id!==action.match_id||match.event_id!==eventId||
    !Array.isArray(match.goals)||!Number.isFinite(at))
  fail('送信前のSS試合情報を確認できません');
 const row={
  goalKey,event_id:eventId,match_id:action.match_id,action:action.action,
  ...(action.action==='create'?{side:action.side}:{goal_id:action.goal_id}),
  scorer_id:action.scorer_id,assist_id:action.assist_id,
  beforeGoalIds:goalIds(match),startedAt:at
 };
 setPending(storage,eventId,[row]);
 return row;
}
export function clearAttempt(storage,eventId,goalKey){
 const pending=pendingAttempts(storage,eventId);
 if(pending.length!==1||pending[0].goalKey!==goalKey)
  fail('解除対象の送信記録が一致しません');
 setPending(storage,eventId,[]);
}
const playerId=player=>player?.player_id||null;
/** Report evidence, not certainty: identical scorer/assist may score twice.
 * Only goals newly observed since the write can be pointed to as candidates.
 */
export function inspectAttempt(attempt,match){
 if(!isEntry(attempt)||!match||match.match_id!==attempt.match_id||
    match.event_id!==attempt.event_id||!Array.isArray(match.goals))
  fail('照合する試合情報が一致しません');
 const old=new Set(attempt.beforeGoalIds);
 if(attempt.action==='patch'){
  const target=match.goals.find(g=>g.goal_id===attempt.goal_id);
  if(!target)return {state:'target_missing',count:0};
  const applied=playerId(target.scorer)===attempt.scorer_id&&
   playerId(target.assist)===attempt.assist_id;
  return {state:applied?'possible_applied':'not_applied',count:applied?1:0};
 }
 const fresh=match.goals.filter(g=>UUID.test(g.goal_id)&&!old.has(g.goal_id));
 const candidate=fresh.filter(g=>g.side===attempt.side&&
  playerId(g.scorer)===attempt.scorer_id&&
  playerId(g.assist)===attempt.assist_id);
 if(candidate.length)return {state:'possible_created',count:candidate.length,
  goalIds:candidate.map(g=>g.goal_id)};
 if(fresh.length)return {state:'other_changes',count:fresh.length};
 return {state:'not_observed',count:0};
}

/** Whether a write can be re-reviewed as unregistered after a lost response.
 * Evidence of a newly created matching goal or an applied PATCH is NEVER
 * a basis for another POST. Unrelated concurrent changes also block a retry.
 * A human must independently verify absence even when this allows retry.
 */
export function recoveryDecisionPolicy(evidence){
 const state=evidence?.state||'';
 const retryAllowed=state==='not_observed'||state==='not_applied';
 const reason=retryAllowed
  ?'最新のSS明細に反映を確認できません。SS側で未登録と確認した場合のみ、新しいプレビューから再審査できます。'
  :state==='possible_created'||state==='possible_applied'
  ?'SSに反映された可能性が高いため、二重登録防止のため「未登録として再審査」は許可しません。'
  :'SS側に他の変更・対象の消失があります。この画面から再送準備を解除できません。管理者がSSの記録を確認してください。';
 return {allowMarkSent:true,allowReturnToReview:retryAllowed,reason};
}


/** A stale official match UUID may have disappeared after TEST fixture
 * regeneration. This is NOT evidence that a historical POST failed. A
 * separate authoritative read must give HTTP 404; any other error leaves the
 * journal locked. The per-match DO status is advisory; 'pending' vetoes even
 * an explicit local archive. The event must still contain new official slots.
 */
export function retiredMatchRecoveryPolicy(attempt,eventId,currentMatchIds,httpStatus,gateStatus){
 const ids=Array.isArray(currentMatchIds)?currentMatchIds:[];
 const valid=Boolean(attempt&&attempt.event_id===eventId&&
  UUID.test(attempt.match_id||'')&&
  ids.length>0&&ids.every(id=>UUID.test(id))&&
  !ids.includes(attempt.match_id));
 const state=typeof gateStatus==='string'?gateStatus:'unknown';
 const allowed=valid&&httpStatus===404&&
  ['idle','verified','rejected'].includes(state);
 return {state:'historical_match_unavailable',allowArchive:allowed,
  old_match_id:attempt?.match_id||null,
  gate_status:state,
  reason:!valid?'イベントまたは試合の正式なIDを照合できません。送信記録は保持します。'
   :httpStatus!==404?'古い試合が削除されたと確認できません。送信記録は保持します。'
   :state==='pending'?'旧試合のWorkerには未解決の書き込みがあります。安全のため復旧を停止します。'
   :!allowed?'Workerの確認状態を取得できません。送信記録は保持します。'
   :'旧試合IDは現在のTESTイベントに存在せず、公式APIも404を返しました。旧送信の成否は不明です。最新イベントのゴールを確認した場合のみ端末の古い記録を保管し、新しい試合として再審査できます。'};
}
export function retiredArchiveKey(eventId){
 return 'peakstamp_ss_retired_attempt_audit_v1:staging:'+journalKey(eventId).split(':').pop();
}
/** Never mark an attempted goal as sent or unsent. Archive the raw evidence
 * BEFORE unlocking; keep a separate immutable-by-this-app audit history.
 * If local storage fails, the attempt remains pending and all writes blocked.
 */
export function archiveRetiredAttempt(storage,eventId,goalKey,policy,at=Date.now()){
 const pending=pendingAttempts(storage,eventId);
 if(!policy?.allowArchive||pending.length!==1||pending[0].goalKey!==goalKey||
  pending[0].match_id!==policy.old_match_id||!Number.isFinite(at))
  fail('失効した試合の確認条件が一致しません。送信記録は保持します');
 const key=retiredArchiveKey(eventId);
 let archive;
 try{
  archive=JSON.parse(storage.getItem(key)||'[]');
  if(!Array.isArray(archive)||archive.length>50)throw Error('corrupt audit');
  const record={...pending[0],archived_at:at,
   resolution:'old_official_match_404_manual_archive_no_write',
   worker_gate_status:policy.gate_status};
  if(!archive.some(item=>item.goalKey===record.goalKey&&item.match_id===record.match_id))
   storage.setItem(key,JSON.stringify([...archive,record]));
 }catch{fail('旧送信記録を保管できません。ロックを解除していません')}
 clearAttempt(storage,eventId,goalKey);
}
