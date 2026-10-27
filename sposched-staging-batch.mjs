/** SpoSched TEST-only batch orchestration. No HTTP or credentials are embedded.
 * User reviews all selected goals, then the bridge writes ONE at a time with
 * a freshly issued signed preview and readback confirmation after each write.
 * Errors stop the batch; successful operations are never retried here.
 */
import {normalizePerson,normalizeTeam} from './sposched-review-core.mjs';
export const TEST_TEAM_ID='dbb50f85-9d9a-408c-9482-497abbca399c';
const abort=message=>{throw Error(message)};
const comparable=plan=>JSON.stringify({action:plan?.action,side:plan?.side,
 match_id:plan?.match_id,goal_id:plan?.goal_id,
 scorer:plan?.after?.scorer||null,assist:plan?.after?.assist||null,
 before:plan?.before||null});
const keyOf=op=>{
 const a=op.args||{};
 if(op.action==='record_goal')return ['new',a.event_id,a.seq,normalizeTeam(a.team),
  normalizePerson(a.scorer),normalizePerson(a.assist||'')].join('|');
 if(op.action==='patch_goal')return ['patch',a.match_id,a.goal_id].join('|');
 return '';
};
export function selectBatchOperations(draft,indices){
 if(!draft||!Array.isArray(draft.operations)||!Array.isArray(indices))
  abort('確認済みの登録内容を選択してください');
 const unique=new Set(indices);
 if(!indices.length||unique.size!==indices.length||indices.length>20)
  abort('一括登録は1～20件の重複しないゴールを選んでください');
 const keys=new Set(),sourceIds=new Set();
 return indices.map(index=>{
  const op=draft.operations[index];
  if(!Number.isInteger(index)||!op||!['record_goal','patch_goal'].includes(op.action))
   abort('試合結果など未対応の操作は一括登録できません');
  const key=keyOf(op);
  if(!key||keys.has(key))abort('同じ試合・得点者・アシスト（または同じ修正対象）が一括登録に含まれています。個別に確認してください');
  keys.add(key);
  const source=op.fromPeakStamp||{};
  const sourceKey=source.goalId&&String(source.source||'')+'::'+String(source.goalId);
  if(sourceKey&&sourceIds.has(sourceKey))abort('同じPeakStampゴールが2件選択されています');
  if(sourceKey)sourceIds.add(sourceKey);
  return {index,operation:op};
 });
}
const assertPreview=(response)=>{
 if(response?.environment!=='STAGING ONLY'||response.team_id!==TEST_TEAM_ID||
    !response.preview_token||!response.plan)
  abort('テスト団体の確認情報が不正です。書き込みを中止します');
 return response;
};
export async function previewReviewedBatch({selected,resolveAction,previewAction,onProgress=()=>{}}){
 const entries=[];
 for(let i=0;i<selected.length;i++){
  const item=selected[i];
  onProgress({phase:'preview',current:i+1,total:selected.length,item});
  const action=await resolveAction(item.operation);
  const data=assertPreview(await previewAction(action));
  entries.push({index:item.index,operation:item.operation,
   action,plan:data.plan});
 }
 return entries;
}
export class BatchStopped extends Error {
 constructor(message,completed,failedIndex){
  super(message);this.name='BatchStopped';this.completed=completed;this.failedIndex=failedIndex;
 }
}
export async function executeReviewedBatch({entries,resolveAction,previewAction,executeAction,
 beforeExecute=async()=>{},afterExecute=async()=>{},onProgress=()=>{}}){
 if(!Array.isArray(entries)||entries.length===0||entries.length>20)
  abort('プレビュー済みの一括登録データがありません');
 const completed=[];
 for(let i=0;i<entries.length;i++){
  const item=entries[i];
  onProgress({phase:'sending',current:i+1,total:entries.length,item,completed:[...completed]});
  try{
   // Each write gets a fresh official match, and a NEW signed 2-minute preview.
   // Same-match goals legitimately change the match fingerprint after every write.
   const action=await resolveAction(item.operation);
   if(JSON.stringify(action)!==JSON.stringify(item.action))
    abort('試合・選手の割当が事前確認から変わりました。イベントを再取得してください');
   const confirmed=assertPreview(await previewAction(action));
   if(comparable(confirmed.plan)!==comparable(item.plan)){
    // Existing goals must remain unchanged; for creates, before=null and expected
    // scorer/assist/side must match the reviewed preview.
    abort('SSの登録前後の内容が一括確認時から変わりました。再確認してください');
   }
   // Persist a crash-safe attempt before POST; never retry an uncertain result.
   await beforeExecute(item,action);
   const result=await executeAction({...action,
    preview_token:confirmed.preview_token,confirm:'TEST-ONLY WRITE'});
   if(result?.write_sent!==true||result?.readback?.verified!==true)
    abort('送信された可能性がありますが照合できません。再送信せずSSのゴール明細を確認してください');
   const confirmedItem={index:item.index,operation:item.operation,
    readback:result.readback};
   completed.push(confirmedItem);
   await afterExecute(item,result);
   onProgress({phase:'verified',current:i+1,total:entries.length,item,
    completed:[...completed]});
  }catch(error){
   // Never retry or continue after any uncertain POST result.
   onProgress({phase:'failed',current:i+1,total:entries.length,item,
    completed:[...completed],message:error.message});
   throw new BatchStopped(error.message,completed,item.index);
  }
 }
 return completed;
}

/** One-tap tournament path: one signed preview per goal (not two).
 * The operator has already reviewed the on-screen candidate and approved the
 * entire tournament. Each goal still resolves fresh official IDs, receives its
 * own signed preview, logs an attempt before the write, and requires readback.
 * No mutation runs concurrently, and uncertain writes are NEVER retried.
 */
export async function executeReviewedBatchOnce({selected,resolveAction,previewAction,
 executeAction,beforeExecute=async()=>{},afterExecute=async()=>{},onProgress=()=>{}}){
 if(!Array.isArray(selected)||selected.length<1||selected.length>20)
  abort('登録するゴールがありません');
 const completed=[];
 for(let i=0;i<selected.length;i++){
  const item=selected[i];
  try{
   if(item.operation?.action!=='record_goal')
    abort('自動登録は新規ゴールのみ対応します');
   onProgress({phase:'checking',current:i+1,total:selected.length,item,completed:[...completed]});
   const action=await resolveAction(item.operation); // validates actual team & player IDs
   if(action.action!=='create'||!action.match_id||!['left','right'].includes(action.side)||
      !action.scorer_id)
    abort('正式な得点者・試合情報が確認できません');
   const signed=assertPreview(await previewAction(action));
   if(signed.plan.action!=='create'||signed.plan.match_id!==action.match_id||
      signed.plan.side!==action.side)
    abort('安全確認と選択中の試合・得点側が一致しません');
   // The original operator-reviewed goal must remain the same.
   // Resolve again only if the result is in doubt, never automatically retry.
   await beforeExecute(item,action);
   onProgress({phase:'sending',current:i+1,total:selected.length,item,completed:[...completed]});
   const result=await executeAction({...action,
    preview_token:signed.preview_token,confirm:'TEST-ONLY WRITE'});
   if(result?.write_sent!==true||result?.readback?.verified!==true)
    abort('送信結果を照合できません。再送せずSS明細を確認してください');
   const confirmedItem={index:item.index,operation:item.operation,readback:result.readback};
   completed.push(confirmedItem);
   await afterExecute(item,result);
   onProgress({phase:'verified',current:i+1,total:selected.length,item,completed:[...completed]});
  }catch(error){
   onProgress({phase:'failed',current:i+1,total:selected.length,item,
    completed:[...completed],message:error.message});
   throw new BatchStopped(error.message,completed,item.index);
  }
 }
 return completed;
}
