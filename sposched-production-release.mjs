// Thin PRODUCTION adapter for the already-tested four-match TEST planner.
// Zero browser/HTTP writes here. Production execution requires a separate
// official live-target Worker approval, independent reads and reviewed send.
import {prepareWorkerTournament} from './sposched-worker-batch.mjs?v=worker-helper-wait-side1';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const fail=message=>{throw Error(message);};
export const productionBatchStorageKey=eventId=>'peakstamp:production:worker-batch:'+eventId;

export function validateProductionReleaseEvidence(snapshot,inspect,release){
 if(!snapshot||!UUID.test(snapshot.eventId||'')||inspect?.environment!=='PRODUCTION'||
    inspect.mode!=='read-only'||inspect.team_pinned!==true||
    inspect.write_allowed!==false||inspect.release_approved!==false||
    release?.environment!=='PRODUCTION'||release.release_ready!==true||
    release.scope!=='current-target'||release.target_event_id?.toLowerCase()!==snapshot.eventId.toLowerCase()||
    inspect.event_id?.toLowerCase()!==snapshot.eventId.toLowerCase()||
    release.event_id?.toLowerCase()!==snapshot.eventId.toLowerCase())
  fail('本番団体・イベント・書き込み承認の独立照合に失敗しました');
 const ids=new Set(),slots=[];
 if(!Array.isArray(inspect.matches)||inspect.matches.length!==4||snapshot.matches?.length!==4)
  fail('本番の正式な4試合を取得できません');
 for(const seq of [1,2,3,4]){
  const official=inspect.matches.filter(m=>m.seq===seq);
  const local=snapshot.matches.filter(m=>m.seq===seq);
  if(official.length!==1||local.length!==1)
   fail('本番試合 #'+seq+' の正式な番号が不一致です');
  const remote=typeof official[0].match_id==='string'?official[0].match_id.toLowerCase():'';
  const localId=typeof local[0].matchId==='string'?local[0].matchId.toLowerCase():'';
  const unresolved=seq>=3&&official[0].status==='waiting'&&!remote&&!localId;
  if(!(unresolved||(UUID.test(remote)&&UUID.test(localId)))||
    remote!==localId||(remote&&ids.has(remote))||
    official[0].status!==local[0].status||
    !['scheduled','waiting'].includes(official[0].status))
   fail('本番試合 #'+seq+' の正式ID・状態が変わりました');
  if(remote)ids.add(remote);
  slots.push(localId);
 }
 return {event_id:snapshot.eventId,team_id:inspect.team_id,
  fixture_ids:slots,date:inspect.event_date};
}
export function prepareProductionBatch({snapshot,rows,decisions,requestId}){
 const plan=prepareWorkerTournament({snapshot,rows,decisions,requestId});
 return {...plan,confirm:'PRODUCTION EVENT BATCH WRITE'};
}
