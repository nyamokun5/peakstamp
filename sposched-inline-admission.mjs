/** Pure TEST-only admission policy for a single four-match batch.
 * No browser storage or network side effects. The caller MUST read the
 * authoritative Worker job status before submitting a new request.
 */
const blocked=new Set(['running','paused','needs_decision','blocked','completed']);
export function decideInlineBatchAdmission({eventId,workerJob,localJob}={}){
 if(!eventId)return {allowed:false,reason:'SSイベントが未確定です'};
 for(const [label,job] of [['Worker',workerJob],['端末',localJob]]){
  if(!job)continue;
  if(job.event_id&&job.event_id!==eventId)continue;
  if(job.request_id&&blocked.has(job.status))
   return {allowed:false,reason:label+'に登録ジョブが存在します。再送せず状態を確認してください',
    requestId:job.request_id,status:job.status};
  if(job.request_id&&!job.status)
   return {allowed:false,reason:label+'の登録結果が不明です。再送せず状態を確認してください',
    requestId:job.request_id};
 }
 return {allowed:true};
}
