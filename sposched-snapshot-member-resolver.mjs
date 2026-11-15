import {scoredPlayerCandidates,normalizeTeam} from './sposched-review-core.mjs';

/**
 * Read-only adapter for the existing official SS snapshot.
 * Player IDs are never synthesized from names or list positions.
 * Supports local-video and YouTube consumers of the shared identity gate.
 */
export function createSnapshotMemberResolver(snapshot) {
 if(!snapshot||!Array.isArray(snapshot.players)||!(snapshot.playerTeam instanceof Map))
  throw Error('SSの選手名簿が未取得です');
 const ids=snapshot.playerIds;
 const memberIds=snapshot.memberIds;
 const lookupId=name=>{
  if(ids instanceof Map)return ids.get(name);
  if(ids&&typeof ids==='object')return ids[name];
  return null;
 };
 const lookupMemberId=name=>{
  if(memberIds instanceof Map)return memberIds.get(name)||null;
  if(memberIds&&typeof memberIds==='object')return memberIds[name]||null;
  return null;
 };
 return async ({query,team=''})=>{
  const teamKey=normalizeTeam(team);
  const ranked=scoredPlayerCandidates(query,snapshot,team,7)
   .filter(item=>!teamKey||normalizeTeam(item.team)===teamKey);
  const candidates=ranked.map(item=>({
   name:item.name,player_id:lookupId(item.name),
   user_id:lookupMemberId(item.name),team:item.team,
   score:item.score
  })).filter(item=>typeof item.player_id==='string'&&item.player_id.trim());
  // Ranking alone is not authoritative confirmation.
  return {confirmed:false,candidates};
 };
}
