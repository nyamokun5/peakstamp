/** Production-only request builder. Pure and fail-closed.
 * UI must obtain the official fixture snapshot and the persisted Worker job.
 * Never infer fixture IDs, player IDs, or permissions here.
 */
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const fail=message=>{throw Error(message)};
const canonical=id=>typeof id==='string'&&UUID.test(id)?id.toLowerCase():null;
export function buildProductionSecondRoundAppend({snapshot,workerJob,operations}={}){
 const eventId=canonical(snapshot?.eventId),requestId=canonical(workerJob?.request_id);
 if(!eventId||!requestId||canonical(workerJob?.event_id)!==eventId||
    workerJob?.environment!=='PRODUCTION'||
    workerJob?.layout_mode!=='four-knockout-staged-v1'||
    workerJob?.status!=='awaiting_second_round'||
    workerJob?.inspection_only!==true||workerJob?.execution_active!==false||
    workerJob?.inspection_contract!=='event-inspect-v1'||
    workerJob?.phase!=='preparing'||
    workerJob?.cursor!==workerJob?.total||
    workerJob?.completed!==workerJob?.total)
  fail('本番の準決勝完了ジョブを再取得してください');
 const matches=snapshot?.matches;
 if(!Array.isArray(matches)||matches.length!==4)
  fail('公式4試合の情報が必要です');
 const official=new Map();
 for(const seq of [1,2,3,4]){
  const rows=matches.filter(m=>Number(m?.seq)===seq);
  if(rows.length!==1||!canonical(rows[0].matchId))fail('公式試合IDが確定していません');
  official.set(seq,canonical(rows[0].matchId));
 }
 if(new Set(official.values()).size!==4)fail('試合IDが重複しています');
 for(const seq of [1,2]){
  if(matches.find(m=>Number(m.seq)===seq)?.status!=='finished'||
     canonical(workerJob.fixture_ids?.[seq])!==official.get(seq))
   fail('準決勝の完了状態または試合IDが一致しません');
 }
 for(const seq of [3,4]){
  const recorded=workerJob.fixture_ids?.[seq];
  if(recorded&&canonical(recorded)!==official.get(seq))
   fail('後半の試合IDがジョブと一致しません');
 }
 if(!Array.isArray(operations)||operations.length<2||operations.length>64)
  fail('後半2試合の操作が必要です');
 const finishes=new Set();let last=3;
 for(const op of operations){
  const seq=op?.seq;
  if(![3,4].includes(seq)||seq<last||finishes.has(seq)||
     canonical(op.expected_match_id)!==official.get(seq))
   fail('後半の操作順序または公式試合IDが不正です');
  last=seq;
  if(op.action==='finish'){
   if(!['auto','left','right','draw'].includes(op.winner))fail('勝敗が不正です');
   finishes.add(seq);
  }else if(op.action!=='create'&&op.action!=='helper')fail('未対応の操作です');
 }
 if(finishes.size!==2)fail('後半2試合の終了操作が必要です');
 return {event_id:eventId,request_id:requestId,
  confirm:'PRODUCTION EVENT BATCH APPEND',operations};
}
