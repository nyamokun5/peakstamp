/** TEST-only one-shot batch dispatch. No implicit retries, even on timeout.
 * The caller supplies an already validated four-fixture Worker plan and
 * authenticated transports. Persist intent BEFORE the first network write.
 */
import {decideInlineBatchAdmission} from './sposched-inline-admission.mjs';
import {workerBatchStorageKey} from './sposched-worker-batch.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export async function startInlineBatchOnce({plan,inspect,send,storage,verifyCurrent}={}){
 if(!UUID.test(plan?.event_id||'')||!UUID.test(plan?.request_id||'')||
    plan.confirm!=='TEST-ONLY BATCH WRITE'||!Array.isArray(plan.operations)||
    typeof inspect!=='function'||typeof send!=='function'||!storage)
  throw Error('TEST一括登録の準備が完了していません');
 const key=workerBatchStorageKey(plan.event_id);
 let existing;
 try{existing=JSON.parse(storage.getItem(key)||'null');}
 catch{throw Error('端末の登録履歴を確認できません。再送しないでください');}
 // Inspect MUST distinguish an authoritative empty event (null) from errors.
 const workerJob=await inspect(plan.event_id);
 const admission=decideInlineBatchAdmission({eventId:plan.event_id,workerJob,localJob:existing});
 if(!admission.allowed)throw Error(admission.reason);
 // Event/roster may change while the authoritative inspect is pending.
 // Recheck immediately before recording intent or sending a mutation.
 if(verifyCurrent)await verifyCurrent();
 // Persist the same request ID before any network call. If the response is
 // lost, the next click MUST stop and inspect instead of issuing a new ID.
 const marker={event_id:plan.event_id,request_id:plan.request_id,status:'sending'};
 try{storage.setItem(key,JSON.stringify(marker));}
 catch{throw Error('端末に登録履歴を保存できません。登録を開始しません');}
 let response;
 try{response=await send(plan);}
 catch{throw Error('登録結果を確認できません。再送せずWorkerの状態を確認してください');}
 if(!response||response.request_id!==plan.request_id||
    response.event_id!==plan.event_id)
  throw Error('登録応答が一致しません。再送せずWorkerの状態を確認してください');
 try{storage.setItem(key,JSON.stringify(response));}catch{}
 return response;
}
