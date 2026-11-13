// Read-only identity resolution. No score/alias writes, network or credentials.
import {matchOfficialAlias,matchEventPerson} from './sposched-alias-auto-match.mjs';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
// Commentary team labels must agree with the selected numbered fixture.
export function analysisFixtureAgrees(goal,match){
 if(!match)return false;
 // Knockout placements have a numbered official slot before SS publishes
 // opponents. Unknown official sides are not a contradictory pairing.
 // Only the explicitly confirmed video pairing may be used at this stage;
 // the Worker still verifies the official opponents after semifinals finish.
 if(match.status==='waiting'&&[3,4].includes(Number(match.seq))&&
    !match.leftTeam&&!match.rightTeam)
  return (goal?.matchupConfirmed===true||goal?.userConfirmedMatchup===true)&&
   Boolean(goal?.teamA&&goal?.teamB);
 const team=v=>String(v||'').normalize('NFKC').toLowerCase().replace(/\s/g,'')
  .replace(/^チーム/,'team').replace(/(番|組|チーム)$/g,'').replace(/^(?:team|第)?(\d{1,2})$/,'team$1');
 let pair=goal.teamA&&goal.teamB?[team(goal.teamA),team(goal.teamB)]:null;
 if(!pair){
  const m=String(goal.matchLabel||'').normalize('NFKC').match(/(?:team|チーム|第)?\s*(\d{1,2})(?:番|チーム)?\s*(?:対|vs\.?|と|－|ー|[-–])\s*(?:team|チーム|第)?\s*(\d{1,2})/i);
  if(m)pair=[team(m[1]),team(m[2])];
 }
 return !pair||pair.sort().join('|')===[team(match.leftTeam),team(match.rightTeam)].sort().join('|');
}
// A confirmed video matchup may identify the participants before SpoSched
// fills the waiting placement fixture. Never infer a team from the scorer.
export function selectedFixtureTeams(goal,snapshot,seq){
 const match=snapshot?.matches?.find(m=>Number(m.seq)===Number(seq));
 if(!match)return [];
 const teamName=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\s/g,'')
  .replace(/^チーム/,'team').replace(/^(?:team)?(\d{1,2})$/,'team$1');
 const rosterTeams=[...new Set(snapshot?.playerTeam?.values?.()||[])];
 // Video transcription is a suggestion, not a user-confirmed matchup.
 // Only use video sides while SS is waiting when the organizer has explicitly
 // reviewed the pairing; otherwise keep identity unresolved.
 const confirmed=goal?.matchupConfirmed===true||goal?.userConfirmedMatchup===true;
 const selected=confirmed?[goal?.teamA,goal?.teamB]:[];
 if(confirmed){
  if(!selected.every(Boolean))return [];
  const resolved=selected.map(v=>rosterTeams.filter(t=>teamName(t)===teamName(v)));
  if(!resolved.every(a=>a.length===1)||resolved[0][0]===resolved[1][0])return [];
  const chosen=resolved.map(a=>a[0]);
  // Once SS publishes the actual sides, a previously confirmed video pairing
  // must not silently override a conflicting official fixture.
  if(match.leftTeam&&match.rightTeam){
   const official=[match.leftTeam,match.rightTeam].map(teamName).sort().join('|');
   if(chosen.map(teamName).sort().join('|')!==official)return [];
  }
  return chosen;
 }
 return [match.leftTeam,match.rightTeam].filter(Boolean);
}
// Display official event roster names even if the upstream TEST API has not
// supplied both identity UUIDs. Registration still requires fixturePeople().
export function fixtureRosterNames(snapshot,seq,goal=null){
 if(snapshot?.rosterSource!=='official-current-event-teams')return [];
 let teams=selectedFixtureTeams(goal,snapshot,seq);
 // A user-confirmed video matchup may differ from a TEST bracket's stale
 // numbered fixture. Show those players for read-only identification, but
 // NEVER treat this as permission to write goals to the conflicting SS match.
 if(teams.length!==2&&(goal?.matchupConfirmed===true||goal?.userConfirmedMatchup===true)){
  const canonical=v=>String(v||'').normalize('NFKC').toLowerCase().replace(/\s/g,'')
   .replace(/^チーム/,'team').replace(/^(?:team)?(\d{1,2})$/,'team$1');
  const rosterTeams=[...new Set(snapshot.playerTeam?.values?.()||[])];
  const selected=[goal.teamA,goal.teamB].map(v=>rosterTeams.filter(t=>canonical(t)===canonical(v)));
  if(selected.every(a=>a.length===1)&&selected[0][0]!==selected[1][0])
   teams=selected.map(a=>a[0]);
 }
 if(teams.length!==2)return [];
 return (snapshot.players||[]).filter(name=>teams.includes(snapshot.playerTeam?.get(name)));
}
export function fixturePeople(snapshot,seq,goal=null){
 const match=snapshot?.matches?.find(m=>Number(m.seq)===Number(seq));
 // A fixture can be awaiting its result (notably placement matches) while its
 // teams and players are already assigned. Result status is not identity status.
 // Waiting placement fixtures may not have a match_id yet. Read-only
 // identity lookup can use the numbered slot; writes still require a
 // freshly verified official match_id after the semifinals finish.
 if(!match)return [];
 const teams=selectedFixtureTeams(goal,snapshot,seq);
 if(teams.length!==2)return [];
 return (snapshot.players||[]).filter(name=>uuid.test(snapshot.memberIds?.get(name)||'')&&
  uuid.test(snapshot.playerIds?.get(name)||'')&&
  teams.includes(snapshot.playerTeam?.get(name)));
}
export function resolveAnalysisGoal(item,context){
 const result={...item,rawScorer:item.rawScorer??item.scorer??'',rawAssist:item.rawAssist??item.assist??''};
 const snapshot=context?.snapshot,entries=context?.aliases||[];
 const seq=Number(item.matchSeq),match=snapshot?.matches?.find(m=>Number(m.seq)===seq);
 const people=fixturePeople(snapshot,seq,item);
 // A spoken pairing that conflicts with an already published SS fixture is
 // not a verified scorer identity, even if its name happens to match.
 const pairingAgrees=(!match?.leftTeam||!match?.rightTeam)||analysisFixtureAgrees(item,match);
 const edits=new Set(item.userEditedGoalFields||[]);
 const identity={environment:'staging',eventId:snapshot?.eventId||'',matchId:match?.matchId||'',seq,scorer:null,assist:null};
 for(const field of ['scorer','assist']){
  const raw=field==='scorer'?result.rawScorer:result.rawAssist;
  const manual=edits.has(field);
  // Recompute every automatic display label from the current event context.
  // Display-only matches have no ssIdentity, so checking previous identity is insufficient.
  if(!manual&&!people.includes(result[field]))result[field]=raw;
  if(field==='assist'&&item.assistStatus!=='named')continue;
  if(!pairingAgrees||!snapshot||snapshot.rosterSource!=='official-current-event-teams')continue;
  const displayName=manual?null:matchEventPerson(raw,entries,snapshot);
  if(displayName&&!manual)result[field]=displayName;
  // The displayed official name can already be a verified member of this
  // fixture even when the spoken alias cannot be resolved again. Do not
  // require a second manual selection of an unchanged dropdown value.
  const name=manual?(people.includes(item[field])?item[field]:null):
   (matchOfficialAlias(raw,entries,snapshot,seq,selectedFixtureTeams(item,snapshot,seq))||
    (people.includes(result[field])?result[field]:null));
  if(!name||!people.includes(name))continue;
  if(field==='assist'&&(!identity.scorer||name===identity.scorer.name||
     snapshot.playerTeam.get(name)!==identity.scorer.team))continue;
  result[field]=name;
  identity[field]={name,memberId:snapshot.memberIds.get(name),playerId:snapshot.playerIds.get(name),
   team:snapshot.playerTeam.get(name),manual};
 }
 result.ssIdentity=identity;
 const complete=identity.scorer&&(item.assistStatus==='none'||item.assistStatus==='named'&&identity.assist);
 if(item.status!=='excluded'&&item.videoDecision==='kept'&&complete){
  result.status='confirmed';result.ssAutoConfirmed=true;
  result.confirmedAt=item.confirmedAt||new Date().toISOString();
 }else if(item.ssAutoConfirmed){
  result.status=item.status==='excluded'?'excluded':'draft';result.confirmedAt=null;result.ssAutoConfirmed=false;
 }
 return result;
}
// Revalidate exported identities against a freshly loaded official event.
export function verifiedAnalysisPerson(goal,snapshot,seq,field){
 const identity=goal?.ssIdentity,p=identity?.[field];
 const match=snapshot?.matches?.find(m=>Number(m.seq)===Number(seq));
 // Waiting knockout slots are identified by event + numbered fixture.
 // They may not have a match UUID until the first-round results are written.
 // This verifies a roster identity only; it never authorizes a score write.
 const waiting=match?.status==='waiting'&&[3,4].includes(Number(seq))&&
  snapshot?.matches?.length===4&&!match?.leftTeam&&!match?.rightTeam;
 if(!waiting&&!uuid.test(match?.matchId||''))return null;
 if(identity?.environment!=='staging'||identity.eventId!==snapshot?.eventId||
    (!waiting&&identity.matchId!==match?.matchId)||
    (waiting&&identity.matchId&&match?.matchId&&identity.matchId!==match.matchId)||
    identity.seq!==Number(seq)||!p||
    p.name!==goal[field]||!fixturePeople(snapshot,seq,goal).includes(p.name)||
    snapshot.memberIds.get(p.name)!==p.memberId||snapshot.playerIds.get(p.name)!==p.playerId||
    snapshot.playerTeam.get(p.name)!==p.team)return null;
 return p;
}
