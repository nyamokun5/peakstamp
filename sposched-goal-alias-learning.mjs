import {submitConfirmedSsAlias} from './sposched-alias-submission.mjs';
import {fixturePlayerOptions} from './sposched-review-core.mjs';

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
 const other=resolution.candidates.some(c=>c?.name&&c.name!==officialName);
 if(other)return {saved:false,reason:'別のメンバーに登録済みの呼び名です'};
 if(resolution.candidates.some(c=>c?.name===officialName))return {saved:false,reason:'SSに登録済みの呼び名です'};
 return submitConfirmedSsAlias({
  spoken,officialName,source,candidates:members,confirmed:true,writeAlias
 });
}
