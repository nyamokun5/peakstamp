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
