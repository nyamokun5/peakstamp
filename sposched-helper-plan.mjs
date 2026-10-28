// STAGING TEST ONLY. Pure plan, never sends an API request.
// An actual helper assignment is a separate signed and durable Worker step
// immediately before its corresponding goal registration.
// If #3/#4 is waiting, the Worker MUST verify the official semifinal-derived
// matchup before it enrols anybody. The target is never assumed at write time.
import {normalizePerson,normalizeTeam,matchingExistingGoals} from './sposched-review-core.mjs';
const text=v=>typeof v==='string'?v.trim():'';
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
