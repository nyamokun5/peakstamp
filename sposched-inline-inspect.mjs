/** Read-only TEST Worker inspection adapter.
 * Call with an authenticated transport; 404 is the only valid 'no job'
 * response. Never interpret timeout, 401, 409 or 5xx as an empty job.
 */
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export async function inspectInlineBatchJob({eventId,postInspect}={}){
 if(!UUID.test(eventId||'')||typeof postInspect!=='function')
  throw Error('SSイベントとWorkerの読み取り接続が必要です');
 let response;
 try{response=await postInspect({event_id:eventId});}
 catch{throw Error('Workerの状態を取得できません。再送せず状態を確認してください');}
 if(response?.status===404&&response?.body?.error?.code==='not_found')
  return null;
 if(response?.status!==200||response?.body?.inspection_only!==true||
    response.body.event_id!==eventId.toLowerCase()||!UUID.test(response.body.request_id||'')||
    !['running','paused','needs_decision','awaiting_second_round','blocked','completed','failed'].includes(response.body.status))
  throw Error('Workerの登録状態を検証できません。再送せず状態を確認してください');
 return response.body;
}
