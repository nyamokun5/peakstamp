// STAGING TEST ONLY. Pure plan, never sends an API request.
// An actual helper assignment is a separate signed and durable Worker step
// immediately before its corresponding goal registration.
// If #3/#4 is waiting, the Worker MUST verify the official semifinal-derived
// matchup before it enrols anybody. The target is never assumed at write time.
import {normalizePerson,normalizeTeam,matchingExistingGoals} from './sposched-review-core.mjs';
const text=v=>typeof v==='string'?v.trim():'';
/** An explicit AI-spoken team pair can prove a scorer is NOT on their
 * usual side in a waiting knockout match. Such a goal needs one scoring-team
 * selection. Never silently assign it to the scorer's home team.
 * A video transcript alone never authorizes a write; the Worker will still
 * require both semifinal results and the official target matchup.
 */
export function waitingHelperScoringSideIssue(snapshot,row){
 const seq=Number(row?.seq),fixture=snapshot?.matches?.find(m=>m.seq===seq);
 if(!fixture||fixture.status!=='waiting'||![3,4].includes(seq)||row.team)return null;
 const scorer=text(row.scorer),home=snapshot.playerTeam?.get(scorer);
 if(!scorer||!home||!snapshot.roster)return null;
 const roster=Object.keys(snapshot.roster);
 const findTeam=value=>roster.find(t=>normalizeTeam(t)===normalizeTeam(value))||'';
 let first=findTeam(row.goal?.teamA),second=findTeam(row.goal?.teamB);
 if(!first||!second){
  const spoken=text(row.goal?.matchLabel||row.matchGuess?.evidence).normalize('NFKC');
  const m=spoken.match(/(?:チーム|team)\s*(\d{1,2})\s*(?:対|vs\.?|と|[-–])\s*(?:チーム|team)\s*(\d{1,2})/i);
  if(m){first=findTeam('チーム'+m[1]);second=findTeam('チーム'+m[2]);}
 }
 if(!first||!second||normalizeTeam(first)===normalizeTeam(second))return null;
 if([first,second].some(t=>normalizeTeam(t)===normalizeTeam(home)))return null;
 return '実況では '+first+' vs '+second+
  ' ですが、得点者の通常所属は '+home+
  ' です。助っ人得点の可能性があるため、実際に得点したチームを選んでください。';
}
export function proposedMatchHelpers(snapshot,row){
 if(!snapshot||snapshot.matches?.length!==4||!row?.include||
    row.goal?.manual||row.updateGoalId||row.guest||row.fixtureIdentityChanged||
    !['named','none'].includes(row.assistMode))return null;
 const seq=Number(row.seq),fixture=snapshot.matches.find(m=>m.seq===seq);
 if(!fixture||!['waiting','scheduled'].includes(fixture.status)||!fixture.matchId)return null;
 if(fixture.status==='waiting'&&![3,4].includes(seq))return null;
 const confident=field=>row.quickReviewedAll===true||
  row.quickReviewedFields?.[field]===true||
  (row[field+'Guess']?.confidence==='high'&&
   !row[field+'Guess']?.conflict&&!row[field+'Guess']?.ambiguous);
 if(!confident('match')||!confident('scorer')||
    row.assistMode==='named'&&!confident('assist'))return null;
 const scorer=text(row.scorer),assist=row.assistMode==='named'?text(row.assist):'';
 if(!scorer||!snapshot.playerTeam?.has(scorer)||
    row.assistMode==='named'&&(!assist||!snapshot.playerTeam.has(assist))||
    assist&&normalizePerson(assist)===normalizePerson(scorer))return null;
 const home=snapshot.playerTeam.get(scorer);
 if(waitingHelperScoringSideIssue(snapshot,row))return null;
 // For an unknown knockout opponent, the scorer's home team can be
 // provisionally proposed; the server checks the actual future teams.
 // For a scorer on a DIFFERENT team the user must explicitly pick the
 // actual scoring team; never silently infer which future side to credit.
 const team=text(row.team)||home;
 if(!team||!Object.keys(snapshot.roster||{}).some(t=>
   normalizeTeam(t)===normalizeTeam(team)))return null;
 if(fixture.status==='scheduled'&&
    ![fixture.leftTeam,fixture.rightTeam].some(t=>
     normalizeTeam(t)===normalizeTeam(team)))return null;
 const helpers=[scorer,assist].filter(person=>person&&
  normalizeTeam(snapshot.playerTeam.get(person))!==normalizeTeam(team))
  .map(person=>({name:person,from:snapshot.playerTeam.get(person),team}));
 if(!helpers.length)return null;
 if(matchingExistingGoals({...row,team},snapshot).length)return null;
 return {seq,team,helpers};
}
