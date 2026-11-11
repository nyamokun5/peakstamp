import {prepareSsAliasProposal} from './sposched-alias-proposal.mjs';

/**
 * Opt-in bridge between confirmed PeakStamp selection and an authenticated
 * SS alias writer. Never guesses an API route or writes implicitly.
 */
export async function submitConfirmedSsAlias({
 spoken,officialName,source,candidates,confirmed=false,
 approved=false,writeAlias
}={}) {
 const checked=prepareSsAliasProposal({spoken,officialName,source,candidates,confirmed});
 if(!checked.ready)return {saved:false,reason:checked.reason};
 if(!approved)return {saved:false,reason:'SSへの別名追加は未承認です',proposal:checked.proposal};
 if(typeof writeAlias!=='function')return {saved:false,reason:'SS別名登録APIが未接続です',proposal:checked.proposal};
 const {alias,person}=checked.proposal;
 // No credentials or guessed member IDs in the browser payload.
 const result=await writeAlias({alias,person});
 if(result?.ok!==true)return {saved:false,reason:result?.error||'SS側の登録完了を確認できません',proposal:checked.proposal};
 return {saved:true,alias,person};
}
