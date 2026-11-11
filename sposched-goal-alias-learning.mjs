import {submitConfirmedSsAlias} from './sposched-alias-submission.mjs';
import {fixturePlayerOptions} from './sposched-review-core.mjs';

/**
 * Called only on a human selection in the goal editor. AI prefill and render
 * never trigger alias writes. The writer is injected by a trusted SS bridge.
 */
export async function onConfirmedGoalPlayerSelection({
 row,snapshot,field,officialName,source='local-video',writeAlias
}={}) {
 if(!['scorer','assist'].includes(field))return {saved:false,reason:'対象外の入力です'};
 const spoken=row?.goal?.[field];
 if(typeof spoken!=='string'||!spoken.trim())return {saved:false,reason:'元動画に呼び名がありません'};
 const members=fixturePlayerOptions(snapshot,row.seq,row.team).map(name=>({name}));
 if(!members.some(m=>m.name===officialName))return {saved:false,reason:'得点チームの公式名簿にありません'};
 return submitConfirmedSsAlias({
  spoken,officialName,source,candidates:members,confirmed:true,writeAlias
 });
}
