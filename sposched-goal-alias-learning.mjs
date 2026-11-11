import {submitConfirmedSsAlias} from './sposched-alias-submission.mjs';
import {fixturePlayerOptions} from './sposched-review-core.mjs';

export function resolveSpokenNameChoices({spoken,snapshot,seq,team,aliases=[]}={}){
 const eligible=fixturePlayerOptions(snapshot,seq,team);
 const matches=aliases.filter(x=>x?.alias===spoken&&eligible.includes(x.name));
 const names=[...new Set(matches.map(x=>x.name))];
 return {status:names.length===1?'unique':names.length>1?'ambiguous':'unresolved',
  candidates:names.map(name=>({name,team:snapshot.playerTeam?.get(name)||''}))};
}


/**
 * Called only on a human selection in the goal editor. AI prefill and render
 * never trigger alias writes. The writer is injected by a trusted SS bridge.
 * The stable user_id is mandatory: event-specific player_id is insufficient.
 */
export async function onConfirmedGoalPlayerSelection({
 row,snapshot,field,officialName,source='local-video',writeAlias,resolveAlias
}={}) {
 if(!['scorer','assist'].includes(field))
  return {saved:false,reason:'対象外の入力です'};
 const spoken=row?.goal?.[field];
 if(typeof spoken!=='string'||!spoken.trim())
  return {saved:false,reason:'元動画に呼び名がありません'};
 const members=fixturePlayerOptions(snapshot,row.seq,row.team).map(name=>({
  name,user_id:snapshot?.memberIds?.get(name)||null
 }));
 const person=members.find(member=>member.name===officialName);
 if(!person)return {saved:false,reason:'得点チームの公式名簿にありません'};
 const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
 if(!uuid.test(person.user_id||''))
  return {saved:false,reason:'SSの登録メンバーIDが確認できません'};
 // Fixture rosters do NOT contain other teams' historical aliases. The
 // server-side resolver must search all members before alias persistence.
 if(typeof resolveAlias!=='function')
  return {saved:false,reason:'SS別名照合APIが未接続です'};
 let resolution;
 try{resolution=await resolveAlias({query:spoken});}
 catch{return {saved:false,reason:'SS別名の照合に失敗しました'};}
 if(!Array.isArray(resolution?.candidates))
  return {saved:false,reason:'SS別名の照合に失敗しました'};
 const existing=resolution.candidates;
 // An unverified candidate cannot be assumed to belong to the current
 // selected member. Never create or overwrite a nickname in that case.
 if(existing.some(candidate=>!uuid.test(candidate?.user_id||'')))
  return {saved:false,reason:'SS既存別名のメンバーIDが確認できません'};
 if(existing.some(candidate=>candidate.user_id.toLowerCase()===person.user_id.toLowerCase()))
  return {saved:false,reason:'SSに登録済みの呼び名です'};
 // Shared nicknames (e.g. two たいせい) are valid contextually, but do not
 // mutate a second member until the upstream contract documents many-to-many
 // persistence. The human selection remains valid for the current goal.
 if(existing.length)
  return {saved:false,reason:'同じ呼び名の選手がいます。今回の選択のみ適用します',ambiguous:true};
 return submitConfirmedSsAlias({
  spoken,officialName,memberId:person.user_id,source,
  candidates:members,confirmed:true,writeAlias
 });
}
