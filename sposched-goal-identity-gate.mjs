import {resolveGoalIdentities,chooseIdentity} from './sposched-name-resolution.mjs';

/**
 * Shared identity gate for locally uploaded video and YouTube workflows.
 * A fresh SS resolution is required before each registration attempt.
 * This module is side-effect-free except for the supplied resolver callback.
 */
export async function prepareGoalIdentityForRegistration({
 source,scorer,assist='',team='',resolveMember,selected={}
}) {
 if(!['local-video','youtube'].includes(source))
  throw Error('未対応の動画入力元です');
 const result=await resolveGoalIdentities({scorer,assist,team,resolveMember});
 const apply=(role)=>{
  const current=result[role];
  const id=selected[role];
  if(!id)return current;
  // Selection must be among the CURRENT SS candidates; stale IDs are rejected.
  if(current.status==='resolved') {
   if(current.player_id!==id)throw Error('選手候補が更新されました。もう一度確認してください');
   return current;
  }
  return chooseIdentity(current,id);
 };
 const final={scorer:apply('scorer'),assist:apply('assist')};
 const ready=final.scorer.status==='resolved'&&
  ['resolved','none'].includes(final.assist.status);
 return {
  source,ready,identities:final,
  payload:ready?{
   scorer_id:final.scorer.player_id,
   assist_id:final.assist.status==='resolved'?final.assist.player_id:null
  }:null
 };
}
