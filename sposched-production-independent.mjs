// PRODUCTION independent-fixture plan adapter.
// Pure data preparation only. No network access or browser writes.
import {prepareWorkerIndependent} from './sposched-worker-independent.mjs';
import {describeOfficialFixtures} from './sposched-fixture-layout.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const fail=message=>{throw Error(message);};
export function validateIndependentProductionEvidence(snapshot,inspect,release){
 const layout=describeOfficialFixtures(snapshot);
 if(!snapshot||!UUID.test(snapshot.eventId||'')||
    layout.automaticFourMatch||layout.count<1||layout.count>24||
    layout.ready!==layout.count||layout.waiting||layout.finished||
    inspect?.environment!=='PRODUCTION'||inspect.mode!=='read-only'||
    inspect.team_pinned!==true||inspect.write_allowed!==false||
    inspect.release_approved!==false||
    release?.environment!=='PRODUCTION'||release.release_ready!==true||
    release.scope!=='current-target'||
    release.target_event_id?.toLowerCase()!==snapshot.eventId.toLowerCase()||
    inspect.event_id?.toLowerCase()!==snapshot.eventId.toLowerCase()||
    release.event_id?.toLowerCase()!==snapshot.eventId.toLowerCase())
  fail('本番ターゲット・団体・独立試合形式を正式に確認できません');
 const official=inspect.matches;
 if(!Array.isArray(official)||official.length!==layout.count)
  fail('本番の正式試合数が一致しません');
 const ids=new Set();
 for(const m of layout.matches){
  const remote=official.filter(x=>x.seq===m.seq);
  const id=m.matchId?.toLowerCase();
  if(remote.length!==1||!UUID.test(id||'')||
     remote[0].match_id?.toLowerCase()!==id||
     remote[0].status!=='scheduled'||m.status!=='scheduled'||ids.has(id))
   fail('試合 #'+m.seq+' の正式ID・状態が変わりました');
  ids.add(id);
 }
 return {event_id:snapshot.eventId,team_id:inspect.team_id,
  fixture_ids:layout.matches.map(m=>m.matchId.toLowerCase()),date:inspect.event_date,
  fixture_count:layout.count,layout_mode:'independent-fixtures-v1'};
}
export function prepareIndependentProductionBatch(args){
 const plan=prepareWorkerIndependent(args);
 if(plan.layout_mode!=='independent-fixtures-v1'||!Number.isInteger(plan.fixture_count)||
    plan.fixture_count<1||plan.fixture_count>24)
  fail('独立試合の正式な登録計画を確認できません');
 return {...plan,confirm:'PRODUCTION EVENT BATCH WRITE'};
}
