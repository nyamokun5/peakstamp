/**
 * A confirmed PeakStamp identity may be proposed as an SS alias.
 * This module does NOT write to SS: callers must use an authenticated,
 * explicitly authorized alias-write adapter.
 */
const clean = value => typeof value === 'string' ? value.trim() : '';
const normalized = value => clean(value).normalize('NFKC').toLocaleLowerCase('ja-JP');
export function prepareSsAliasProposal({spoken,officialName,confirmed=false,source='',candidates=[]}={}) {
 const alias=clean(spoken),person=clean(officialName);
 if(!confirmed||!alias||!person)return {ready:false,reason:'本人確認が必要です'};
 if(!['local-video','youtube'].includes(source))return {ready:false,reason:'入力元が不正です'};
 if(normalized(alias)===normalized(person))return {ready:false,reason:'正式名と同じです'};
 if(!Array.isArray(candidates))return {ready:false,reason:'名簿候補が不正です'};
 const selected=candidates.filter(c=>normalized(c?.name)===normalized(person));
 if(selected.length!==1)return {ready:false,reason:'SSの正式名簿で確認できません'};
 // An alias already attached to another member is never silently overwritten.
 const collision=candidates.some(c=>normalized(c?.name)!==normalized(person)&&
  (normalized(c?.name)===normalized(alias)||
   (Array.isArray(c?.aliases)&&c.aliases.some(a=>normalized(a)===normalized(alias)))));
 if(collision)return {ready:false,reason:'別のメンバーが使用している呼び名です'};
 if(Array.isArray(selected[0].aliases)&&selected[0].aliases.some(a=>normalized(a)===normalized(alias)))
  return {ready:false,reason:'登録済みの別名です'};
 return {ready:true,proposal:{alias,person,source}};
}
