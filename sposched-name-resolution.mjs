/**
 * Name-resolution gate for TEST goal registration.
 * The caller must provide the authenticated SS resolver adapter.
 * No guessed identity may be sent to the goal API.
 */
const clean = value => typeof value === 'string' ? value.trim() : '';
export async function resolveGoalIdentities({scorer,assist='',team='',resolveMember}) {
 if(typeof resolveMember !== 'function')throw Error('SS名寄せAPIが未接続です');
 const lookup = async (spoken,role) => {
  if(!spoken)return role==='assist'?{status:'none',role}: {status:'unresolved',role,candidates:[]};
  const response=await resolveMember({query:spoken,team,role});
  const candidates=Array.isArray(response?.candidates)?response.candidates.filter(
   c=>clean(c?.name)&&clean(c?.player_id)): [];
  const unique=[...new Map(candidates.map(c=>[c.player_id,c])).values()];
  const confirmed=clean(response?.player_id) &&
    unique.find(c=>c.player_id===response.player_id);
  // Explicit API confirmation, not fuzzy top-result ranking.
  // A resolver may have a preferred or previously confirmed match, but
  // two eligible identities sharing a nickname must NEVER be auto-selected.
  if(response?.confirmed===true&&confirmed&&unique.length===1)
   return {status:'resolved',role,spoken,name:confirmed.name,player_id:confirmed.player_id};
  return {status:'unresolved',role,spoken,candidates:unique};
 };
 const scorerResult=await lookup(clean(scorer),'scorer');
 const assistResult=await lookup(clean(assist),'assist');
 return {scorer:scorerResult,assist:assistResult,
  canSubmit:scorerResult.status==='resolved'&&
   ['resolved','none'].includes(assistResult.status)};
}
export function chooseIdentity(result,playerId) {
 if(result?.status!=='unresolved')throw Error('確認対象が不正です');
 const selected=result.candidates?.find(c=>c.player_id===playerId);
 if(!selected)throw Error('SS名簿にない選手は選択できません');
 return {status:'resolved',role:result.role,spoken:result.spoken,
  name:selected.name,player_id:selected.player_id};
}
