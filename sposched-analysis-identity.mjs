// Read-only identity resolution. No score/alias writes, network or credentials.
import {matchOfficialAlias,matchEventPerson} from './sposched-alias-auto-match.mjs';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
// Commentary team labels must agree with the selected numbered fixture.
export function analysisFixtureAgrees(goal,match){
 if(!match)return false;
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
 const teamName=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\\s/g,'')
  .replace(/^チーム/,'team').replace(/^(?:team)?(\\d{1,2})$/,'team$1');
 const rosterTeams=[...new Set(snapshot?.playerTeam?.values?.()||[])];
 const selected=[goal?.teamA,goal?.teamB];
 if(selected.some(Boolean)){
  if(!selected.every(Boolean))return [];
  const resolved=selected.map(v=>rosterTeams.filter(t=>teamName(t)===teamName(v)));
  return resolved.every(a=>a.length===1)&&resolved[0][0]!==resolved[1][0]
   ?resolved.map(a=>a[0]):[];
 }
 return [match.leftTeam,match.rightTeam].filter(Boolean);
}
export function fixturePeople(snapshot,seq,goal=null){
 const match=snapshot?.matches?.find(m=>Number(m.seq)===Number(seq));
 // A fixture can be awaiting its result (notably placement matches) while its
 // teams and players are already assigned. Result status is not identity status.
 // Keep requiring a real match ID and a uniquely resolved team pair;
 // registration checks remain separate from this read-only lookup.
 if(!match?.matchId)return [];
 const teams=selectedFixtureTeams(goal,snapshot,seq);
 if(teams.length!==2)return [];
 return (snapshot.players||[]).filter(name=>uuid.test(snapshot.memberIds?.get(name)||'')&&
  uuid.test(snapshot.playerIds?.get(name)||'')&&
  teams.includes(snapshot.playerTeam?.get(name)));
}
export function resolveAnalysisGoal(item,context){
 const result={...item,rawScorer:item.rawScorer??item.scorer??'',rawAssist:item.rawAssist??item.assist??''};
 const previous=item.ssIdentity;
 const snapshot=context?.snapshot,entries=context?.aliases||[];
 const seq=Number(item.matchSeq),match=snapshot?.matches?.find(m=>Number(m.seq)===seq);
 const people=fixturePeople(snapshot,seq,item);
 const edits=new Set(item.userEditedGoalFields||[]);
 const identity={environment:'staging',eventId:snapshot?.eventId||'',matchId:match?.matchId||'',seq,scorer:null,assist:null};
 for(const field of ['scorer','assist']){
  const raw=field==='scorer'?result.rawScorer:result.rawAssist;
  const manual=edits.has(field);
  // Recompute every automatic display label from the current event context.
  // Display-only matches have no ssIdentity, so checking previous identity is insufficient.
  if(!manual&&!people.includes(result[field]))result[field]=raw;
  if(field==='assist'&&item.assistStatus!=='named')continue;
  if(!snapshot||snapshot.rosterSource!=='official-current-event-teams')continue;
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
 if(identity?.environment!=='staging'||identity.eventId!==snapshot?.eventId||
    identity.matchId!==match?.matchId||identity.seq!==Number(seq)||!p||
    p.name!==goal[field]||!fixturePeople(snapshot,seq,goal).includes(p.name)||
    snapshot.memberIds.get(p.name)!==p.memberId||snapshot.playerIds.get(p.name)!==p.playerId||
    snapshot.playerTeam.get(p.name)!==p.team)return null;
 return p;
}
