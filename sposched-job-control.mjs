// Controls are bound to the loaded TEST event and its saved job, never to UI labels.
export function jobControlPayload(action,state,{environment,eventId,requestId}={}){
 if(environment!=='staging'||state?.control_contract!=='event-pause-v1'||
    state.environment!=='STAGING ONLY'||!eventId||!requestId||
    state.event_id!==eventId||state.request_id!==requestId)
  throw Error('対象のTESTイベントとジョブを再取得してください');
 // An inspection is always observational. The phase-1 TEST Worker also
 // returns observation_only on legacy status; neither may enable controls.
 if(state.inspection_only===true||state.observation_only===true)
  throw Error('このTEST Workerは現在、確認専用です。停止・再開はできません');
 if(action==='pause'){
  if(!['running','needs_decision'].includes(state.status)||state.pause_requested)
   throw Error('このジョブは停止操作を受け付けていません');
  return {event_id:eventId,request_id:requestId,confirm:'TEST-ONLY BATCH PAUSE'};
 }
 if(action!=='resume'||state.status!=='paused'||state.phase!=='preparing'||
    !state.pause_id||!Number.isInteger(state.cursor)||state.cursor<0)
  throw Error('安全な停止位置を確認できません。結果不明の操作は再送しません');
 return {event_id:eventId,request_id:requestId,confirm:'TEST-ONLY BATCH RESUME',
  pause_id:state.pause_id,cursor:state.cursor};
}
