/** TEST-only orchestrator. One user gesture starts a durable staged job.
 * No mutation is retried after an ambiguous response. Phase two is appended
 * only after an authoritative Worker completion and refreshed SS snapshot.
 */
export async function runOneClickKnockout({
 start,inspect,refreshOfficial,buildSecond,append,verifyCurrent,verifyFinished,
 onStatus=()=>{},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
 maxChecks=45
}={}){
 for(const [name,fn] of Object.entries({start,inspect,refreshOfficial,buildSecond,append,verifyCurrent,verifyFinished})){
  if(typeof fn!=='function')throw Error(name+' が未設定です');
 }
 await verifyCurrent();
 onStatus('準決勝を登録中');
 const started=await start();
 if(!started?.event_id||!started?.request_id)
  throw Error('登録ジョブIDを確認できません。再送しないでください');
 let job=null;
 for(let i=0;i<maxChecks;i++){
  await wait(2000);
  await verifyCurrent();
  job=await inspect(started.event_id);
  if(!job||job.event_id!==started.event_id||job.request_id!==started.request_id)
   throw Error('Workerのジョブが一致しません。再送しないでください');
  if(job.status==='awaiting_second_round')break;
  if(['blocked','needs_decision','paused','failed'].includes(job.status))
   throw Error('準決勝の登録が停止しました（'+job.status+'）。SSを確認してください');
  if(job.status==='completed')
   throw Error('予期しない完了状態です。SSを確認してください');
  onStatus('準決勝を登録中（'+(job.completed||0)+' / '+(job.total||'?')+'）');
 }
 if(job?.status!=='awaiting_second_round')
  throw Error('準決勝の完了確認がタイムアウトしました。再送しないでください');
 onStatus('正式な対戦カードを確認中');
 const snapshot=await refreshOfficial(started.event_id);
 await verifyCurrent();
 const second=await buildSecond(snapshot,job);
 if(second?.event_id!==started.event_id||second?.request_id!==started.request_id||
    second?.confirm!=='TEST-ONLY BATCH APPEND')
  throw Error('後半の登録計画が一致しません');
 onStatus('後半2試合を登録中');
 // Exactly one append attempt. A lost response must be inspected, not retried.
 const appended=await append(second);
 if(appended?.event_id!==started.event_id||appended?.request_id!==started.request_id)
  throw Error('後半の登録応答が一致しません。再送しないでください');
 onStatus('4試合の完了を確認中');
 for(let i=0;i<maxChecks;i++){
  await wait(2000);
  await verifyCurrent();
  const finalJob=await inspect(started.event_id);
  if(!finalJob||finalJob.event_id!==started.event_id||
     finalJob.request_id!==started.request_id)
   throw Error('完了確認のジョブIDが一致しません');
  if(finalJob.status==='completed'){
   const finalSnapshot=await refreshOfficial(started.event_id);
   await verifyFinished(finalJob,finalSnapshot,snapshot);
   onStatus('TESTの4試合登録が完了しました');
   return finalJob;
  }
  if(['blocked','needs_decision','paused','failed'].includes(finalJob.status))
   throw Error('後半の登録が停止しました（'+finalJob.status+'）。SSを確認してください');
  onStatus('後半2試合を登録中（'+(finalJob.completed||0)+' / '+(finalJob.total||'?')+'）');
 }
 throw Error('4試合の完了確認がタイムアウトしました。再送しないでください');
}
