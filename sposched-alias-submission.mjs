import {prepareSsAliasProposal} from './sposched-alias-proposal.mjs';

/**
 * Submits an explicitly selected member's nickname to an injected, trusted
 * adapter. The browser never chooses an API URL and never receives spk_ keys.
 * Without a documented authenticated SS alias API the adapter is absent.
 */
export async function submitConfirmedSsAlias({
 spoken,officialName,memberId,source,candidates,confirmed=false,writeAlias
}={}){
 const checked=prepareSsAliasProposal({
  spoken,officialName,memberId,source,candidates,confirmed
 });
 if(!checked.ready)return {saved:false,reason:checked.reason};
 if(typeof writeAlias!=='function')
  return {saved:false,reason:'SS別名登録APIが未接続です',proposal:checked.proposal};
 const {alias,person,user_id}=checked.proposal;
 try{
  const result=await writeAlias({alias,person,user_id});
  // The Worker must have verified the exact alias + member_id through
  // the official SS GET /v1/aliases readback. A generic HTTP 200 is not proof.
  if(result?.ok!==true)
   return {saved:false,reason:result?.error||'SS側の登録完了を確認できません',proposal:checked.proposal};
  if(result?.saved!==true||
     result?.user_id!==user_id||
     typeof result?.alias!=='string'||
     result.alias.normalize('NFKC').toLocaleLowerCase('ja-JP')!==
      alias.normalize('NFKC').toLocaleLowerCase('ja-JP'))
   return {saved:false,reason:'SS側の登録完了を確認できません',proposal:checked.proposal};
  return {saved:true,alias,person,user_id,shared:result.shared===true};
 }catch{
  // Never imply the write failed definitively: the HTTP reply may be lost.
  // A future bridge must read back the alias before any retry.
  return {saved:false,reason:'SSへの登録結果を確認できません。再送せず、SSで確認してください',uncertain:true};
 }
}
