/** Prepare a user-confirmed SS nickname update without writing it.
 * Stable registered-member user_id is mandatory; event player_id or
 * a name alone must never become the alias's persistent identity.
 */
const clean=value=>typeof value==='string'?value.trim():'';
const normalized=value=>clean(value).normalize('NFKC').toLocaleLowerCase('ja-JP');
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function prepareSsAliasProposal({
 spoken,officialName,memberId,confirmed=false,source='',candidates=[]
}={}){
 const alias=clean(spoken),person=clean(officialName),userId=clean(memberId);
 if(!confirmed||!alias||!person)return {ready:false,reason:'本人確認が必要です'};
 if(!['local-video','youtube'].includes(source))return {ready:false,reason:'入力元が不正です'};
 if(normalized(alias)===normalized(person))return {ready:false,reason:'正式名と同じです'};
 if(!Array.isArray(candidates))return {ready:false,reason:'名簿候補が不正です'};
 if(!UUID.test(userId))return {ready:false,reason:'SSの登録メンバーIDが確認できません'};
 const selected=candidates.filter(c=>normalized(c?.name)===normalized(person)&&
  clean(c?.user_id).toLowerCase()===userId.toLowerCase());
 if(selected.length!==1)return {ready:false,reason:'SSの正式名簿とメンバーIDが一致しません'};
 // SS OpenAPI 1.7.0 explicitly permits one alias on multiple identities.
 // Another member using the same nickname must NOT block a human-confirmed
 // alias for this stable member_id. SS will return ambiguous candidates later.
 if(Array.isArray(selected[0].aliases)&&selected[0].aliases.some(a=>normalized(a)===normalized(alias)))
  return {ready:false,reason:'登録済みの別名です'};
 return {ready:true,proposal:{alias,person,user_id:userId,source}};
}
