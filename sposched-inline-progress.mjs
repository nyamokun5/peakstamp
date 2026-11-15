// Observe one durable TEST job. Writes are only enabled by an explicit registration action.
export function verifyInlineCompletion(job, snapshot){
 if(job?.status!=='completed'||job.event_id!==snapshot?.eventId||job.completed!==job.total||
    !Array.isArray(snapshot.matches)||snapshot.matches.length!==4)
  throw Error('登録完了を確認できません。再登録せず状況を確認してください');
 const goalIds=new Set();
 for(const seq of [1,2,3,4]){
  const matches=snapshot.matches.filter(m=>Number(m.seq)===seq),m=matches[0];
  if(matches.length!==1||!job.fixture_ids?.[seq]||m.matchId!==job.fixture_ids[seq]||m.status!=='finished'||
     !Number.isInteger(m.leftScore)||!Number.isInteger(m.rightScore)||m.leftScore<0||m.rightScore<0)
   throw Error('第'+seq+'試合の終了・試合ID・得点を確認できません');
  for(const goal of m.existingGoals||[]){
   if(!goal.id||goalIds.has(goal.id))throw Error('SSのゴール明細を照合できません');
   goalIds.add(goal.id);
  }
 }
 const receipts=new Set();
 for(const receipt of job.goal_receipts||[]){
  const id=receipt.official_goal_id||receipt.goal_id,matchId=receipt.official_match_id||receipt.match_id;
  const match=snapshot.matches.find(m=>m.matchId===matchId);
  if(!id||receipts.has(id)||!match?.existingGoals?.some(g=>g.id===id))
   throw Error('登録したゴールをSSで確認できません。再送しないでください');
  receipts.add(id);
 }
 return true;
}
export async function followInlineRegistration({initial,inspect,refreshOfficial,verifyCurrent,
 onStatus=()=>{},onDecision=()=>{},onComplete=()=>{},continueSecond=null,
 wait=ms=>new Promise(r=>setTimeout(r,ms)),maxChecks=90}){
 const eventId=initial?.event_id,requestId=initial?.request_id;
 if(!eventId||!requestId)throw Error('登録ジョブを確認できません');
 let job=initial,appended=false;
 for(let i=0;i<maxChecks;i++){
  await verifyCurrent();
  if(job?.event_id!==eventId||job?.request_id!==requestId)
   throw Error('登録ジョブが変わりました。再送しないでください');
  if(job.status==='completed'){
   onStatus('SSの登録結果を照合中…');
   const official=await refreshOfficial(eventId);await verifyCurrent();
   verifyInlineCompletion(job,official);await onComplete(job,official);return job;
  }
  if(job.status==='needs_decision'){
   const official=await refreshOfficial(eventId);await verifyCurrent();
   await onDecision(job,official);return job;
  }
  if(job.status==='awaiting_second_round'){
   if(!continueSecond){onStatus('準決勝は登録済みです。「登録内容を確認」から後半を再開してください');return job;}
   if(appended)throw Error('後半登録の応答を確認できません。再送しないでください');
   const official=await refreshOfficial(eventId);await verifyCurrent();
   onStatus('後半2試合を登録中…');appended=true;
   job=await continueSecond(job,official);continue;
  }
  if(job.status!=='running')throw Error('登録を停止しています。'+(job.blocked_reason||'登録履歴を確認してください'));
  onStatus('TESTに登録中… '+(job.completed??0)+'/'+(job.total??'?'));
  await wait(2000);await verifyCurrent();job=await inspect(eventId);
 }
 throw Error('完了確認に時間がかかっています。「登録結果を確認」で続きを確認してください。再登録は不要です');
}
export async function appendInlineOnce({plan,storage,send}){
 if(plan?.confirm!=='TEST-ONLY BATCH APPEND'||!plan.request_id||!plan.event_id)
  throw Error('後半の登録計画を確認できません');
 const key='peakstamp:test:append-pending:'+plan.request_id;
 if(storage.getItem(key))throw Error('後半登録の送信履歴があります。再送せず登録結果を確認してください');
 storage.setItem(key,JSON.stringify({event_id:plan.event_id,request_id:plan.request_id}));
 const result=await send(plan);
 if(result?.event_id!==plan.event_id||result?.request_id!==plan.request_id)
  throw Error('後半登録の応答が不明です。再送しないでください');
 // Keep the intent: the same generation must never append the same goals twice.
 return result;
}
