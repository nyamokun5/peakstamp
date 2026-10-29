// Thin PRODUCTION adapter for the already-tested four-match TEST planner.
// Zero browser/HTTP writes here. Production execution requires a separate
// event-scoped Worker approval, official reads and explicit owner confirmation.
import {prepareWorkerTournament} from './sposched-worker-batch.mjs?v=worker-helper-wait-side1';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const fail=message=>{throw Error(message);};
export const productionBatchStorageKey=eventId=>'peakstamp:production:worker-batch:'+eventId;

export function validateProductionReleaseEvidence(snapshot,inspect,release){
 if(!snapshot||!UUID.test(snapshot.eventId||'')||inspect?.environment!=='PRODUCTION'||
    inspect.mode!=='read-only'||inspect.team_pinned!==true||
    inspect.write_allowed!==false||inspect.release_approved!==false||
    release?.environment!=='PRODUCTION'||release.release_ready!==true||
    inspect.event_id?.toLowerCase()!==snapshot.eventId.toLowerCase()||
    release.event_id?.toLowerCase()!==snapshot.eventId.toLowerCase())
  fail('本番団体・イベント・書き込み承認の独立照合に失敗しました');
 const ids=new Set();
 if(!Array.isArray(inspect.matches)||inspect.matches.length!==4||snapshot.matches?.length!==4)
  fail('本番の正式な4試合を取得できません');
 for(const seq of [1,2,3,4]){
  const official=inspect.matches.filter(m=>m.seq===seq);
  const local=snapshot.matches.filter(m=>m.seq===seq);
  if(official.length!==1||local.length!==1||!UUID.test(official[0].match_id||'')||
     !UUID.test(local[0].matchId||'')||
     official[0].match_id.toLowerCase()!==local[0].matchId.toLowerCase()||
     ids.has(local[0].matchId.toLowerCase())||
     official[0].status!==local[0].status||
     !['scheduled','waiting'].includes(official[0].status))
    fail('本番試合 #'+seq+' の正式なIDまたは状態が変わりました');
  ids.add(local[0].matchId.toLowerCase());
 }
 return {event_id:snapshot.eventId,team_id:inspect.team_id,
  fixture_ids:[...ids],date:inspect.event_date};
}
export function prepareProductionBatch({snapshot,rows,decisions,requestId}){
 const plan=prepareWorkerTournament({snapshot,rows,decisions,requestId});
 return {...plan,confirm:'PRODUCTION EVENT BATCH WRITE'};
}
