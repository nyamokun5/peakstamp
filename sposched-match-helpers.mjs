/** SpoSched TEST: read-only per-match helper membership evidence.
 * A person can play for another side in one match without changing their
 * event-wide home team. Only an official GET /v1/matches/:id response can
 * establish the temporary assignment. This module never assigns helpers.
 */
import {normalizePerson,normalizeTeam} from './sposched-review-core.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const txt=x=>typeof x==='string'?x.trim():'';
const refuse=msg=>{throw Error(msg)};
export function recordVerifiedMatchHelpers(snapshot,seq,response){
 const fixture=snapshot?.matches?.find(m=>m.seq===Number(seq));
 const match=response?.match||response;
 if(!fixture||!UUID.test(fixture.matchId||'')||
    !match||match.match_id!==fixture.matchId||
    match.event_id!==snapshot.eventId||
    match.status!=='scheduled'||
    [match.number,match.seq].filter(n=>n!=null).some(n=>n!==fixture.seq)||
    normalizeTeam(match.left?.name)!==normalizeTeam(fixture.leftTeam)||
    normalizeTeam(match.right?.name)!==normalizeTeam(fixture.rightTeam))
  refuse('SSの正式な試合・イベント・対戦チームが一致しません');
 const verified=[];
 for(const side of ['left','right']){
  const helpers=match[side]?.helpers;
  if(helpers!=null&&!Array.isArray(helpers))refuse('SSの助っ人名簿が不正です');
  for(const helper of helpers||[]){
   if(!UUID.test(helper?.player_id||'')||!txt(helper?.name))
    refuse('SSの助っ人名または選手IDが不正です');
   const team=fixture[side==='left'?'leftTeam':'rightTeam'];
   const normalized=normalizePerson(helper.name);
   // Reject ambiguous same-name helper records; the Worker requires an
   // individually resolvable UUID before sending any official mutation.
   if(verified.some(v=>normalizePerson(v.name)===normalized))
    refuse('助っ人の選手名が重複しています');
   verified.push({name:helper.name,team,playerId:helper.player_id});
  }
 }
 // A refresh is scoped to this single official fixture UUID only. A reset
 // or recreated bracket cannot inherit a previous match's helper evidence.
 if(!(snapshot.verifiedMatchHelpers instanceof Map))
  snapshot.verifiedMatchHelpers=new Map();
 snapshot.verifiedMatchHelpers.set(fixture.matchId,verified);
 return verified;
}
export function isVerifiedMatchHelper(snapshot,seq,person,team){
 const fixture=snapshot?.matches?.find(m=>m.seq===Number(seq));
 if(!fixture?.matchId||!person||!team||
    ![fixture.leftTeam,fixture.rightTeam].some(t=>normalizeTeam(t)===normalizeTeam(team)))
  return false;
 const entries=snapshot.verifiedMatchHelpers?.get(fixture.matchId)||[];
 return entries.filter(h=>normalizePerson(h.name)===normalizePerson(person)&&
  normalizeTeam(h.team)===normalizeTeam(team)&&UUID.test(h.playerId||'')).length===1;
}
export function opposingTeamHelperCandidates(snapshot,row){
 const fixture=snapshot?.matches?.find(m=>m.seq===Number(row?.seq));
 const team=txt(row?.team||snapshot?.playerTeam?.get(row?.scorer));
 if(!fixture||!team||
    ![fixture.leftTeam,fixture.rightTeam].some(t=>normalizeTeam(t)===normalizeTeam(team)))
  return [];
 return [['得点者',row?.scorer],['アシスト',row?.assistMode==='named'?row.assist:'']]
  .filter(([,name])=>name&&snapshot?.playerTeam?.has(name)&&
   normalizeTeam(snapshot.playerTeam.get(name))!==normalizeTeam(team))
  .map(([role,name])=>({role,name,from:snapshot.playerTeam.get(name),
   to:team,verified:isVerifiedMatchHelper(snapshot,row.seq,name,team)}));
}
