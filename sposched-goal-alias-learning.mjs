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
 */
export async function onConfirmedGoalPlayerSelection({
 row,snapshot,field,officialName,source='local-video',writeAlias,resolveAlias
}={}) {
 if(!['scorer','assist'].includes(field))return {saved:false,reason:'対象外の入力です'};
 const spoken=row?.goal?.[field];
 if(typeof spoken!=='string'||!spoken.trim())return {saved:false,reason:'元動画に呼び名がありません'};
 const members=fixturePlayerOptions(snapshot,row.seq,row.team).map(name=>({name}));
 if(!members.some(m=>m.name===officialName))return {saved:false,reason:'得点チームの公式名簿にありません'};
 // A full SS alias lookup is mandatory before writing: fixture rosters do
 // not contain every existing alias, including aliases of other teams.
 if(typeof resolveAlias!=='function')return {saved:false,reason:'SS別名照合APIが未接続です'};
 const resolution=await resolveAlias({query:spoken});
 if(!Array.isArray(resolution?.candidates))return {saved:false,reason:'SS別名の照合に失敗しました'};
 const existing=resolution.candidates.filter(c=>c?.name);
 if(existing.some(c=>c.name===officialName))return {saved:false,reason:'SSに登録済みの呼び名です'};
 // An alias shared by multiple players is contextual, not a globally unique
 // identity. Keep the user's selection for this goal; do not overwrite the
 // SS global alias mapping or reject the goal.
 if(existing.length)return {saved:false,reason:'同じ呼び名の選手がいます。今回の選択のみ適用します',ambiguous:true};
 return submitConfirmedSsAlias({
  spoken,officialName,source,candidates:members,confirmed:true,writeAlias
 });
}
