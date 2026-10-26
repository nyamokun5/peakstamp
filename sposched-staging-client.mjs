/** Pure adapter from human-reviewed PeakStamp JSON operations to the
 * deliberately limited and tenant-pinned SpoSched TEST Worker write protocol.
 * No network, credentials, retry, or side effects live in this module.
 */
import {normalizeTeam} from './sposched-review-core.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const normalizedName=s=>String(s??'').normalize('NFKC').toLocaleLowerCase('en')
 .replace(/[\s\u3000]/g,'');
const sameName=(a,b)=>Boolean(normalizedName(a))&&normalizedName(a)===normalizedName(b);
const fail=message=>{throw Error(message)};
export function writeableReviewOperations(draft) {
 if(!draft || !Array.isArray(draft.operations))return [];
 return draft.operations.map((op,index)=>({
  index,action:op.action,
  label:op.action==='record_goal'?'新規ゴール '+(op.args?.scorer||'得点者なし')+' / 試合 #'+op.args?.seq:
   op.action==='patch_goal'?'登録済みゴールの修正 / 試合 #'+op.args?.seq:
    '対象外：試合結果の更新（テスト書き込み未対応）',
  enabled:['record_goal','patch_goal'].includes(op.action)
 }));
}
function playerOnSide(match,side,name){
 const source=match?.[side];
 if(!source||!Array.isArray(source.players))fail('SSから選手名簿を取得できません');
 const people=[...source.players,...(Array.isArray(source.helpers)?source.helpers:[])];
 const candidates=people.filter(p=>UUID.test(p.player_id||'')&&sameName(p.name,name));
 if(candidates.length!==1)fail('選手「'+name+'」のIDを一意に特定できません。SSの登録名と参加チームを確認してください');
 return candidates[0].player_id;
}
function sideForTeam(match,team){
 const sides=['left','right'].filter(side=>
  normalizeTeam(match?.[side]?.name)===normalizeTeam(team)&&Boolean(team));
 if(sides.length!==1)fail('得点チームをSSの対戦カードから一意に特定できません');
 return sides[0];
}
function registeredGoal(match,id){
 if(!UUID.test(id||''))fail('goal_idが不正です。SSから再取得してください');
 const goals=Array.isArray(match.goals)?match.goals:[];
 const goal=goals.find(g=>g.goal_id===id);
 if(!goal)fail('登録済みゴールが現在のSSデータに見つかりません。再読み込みしてください');
 return goal;
}
export function toStagingAction(snapshot,draftOperation,officialMatch){
 if(!snapshot?.eventId || !draftOperation?.args || !officialMatch)
  fail('SSの試合情報と確認済み操作が必要です');
 const op=draftOperation,args=op.args;
 if(!UUID.test(officialMatch.match_id||'')||!UUID.test(officialMatch.event_id||'')||
    officialMatch.event_id!==snapshot.eventId||
    !UUID.test(args.match_id||officialMatch.match_id)||
    args.match_id&&args.match_id!==officialMatch.match_id)
  fail('SSのイベントまたは試合IDが一致しません。イベントを再取得してください');
 if(officialMatch.status==='waiting')fail('試合の対戦相手が確定していません');
 if(op.action==='record_goal'){
  if(args.guest)fail('外部ゲストの得点は今回の安全な書き込みテストの対象外です');
  if(!args.scorer||!args.team)fail('得点者と得点チームを確認してください');
  const side=sideForTeam(officialMatch,args.team);
  const scorer_id=playerOnSide(officialMatch,side,args.scorer);
  const assist_id=args.assist?playerOnSide(officialMatch,side,args.assist):null;
  if(assist_id===scorer_id)fail('得点者とアシスト者が同じです');
  return {action:'create',match_id:officialMatch.match_id,side,scorer_id,assist_id};
 }
 if(op.action==='patch_goal'){
  if(!UUID.test(args.match_id||'')||!UUID.test(args.goal_id||''))
   fail('修正対象のmatch_idまたはgoal_idが不正です');
  const goal=registeredGoal(officialMatch,args.goal_id);
  if(goal.own_goal===true)fail('オウンゴールの修正は今回のテストの対象外です');
  if(!['left','right'].includes(goal.side))fail('SSの得点側が確認できません');
  const expected=op.expected;
  if(!expected||!sameName(expected.team,officialMatch[goal.side]?.name)||
     !sameName(expected.scorer,goal.scorer?.name)||
     normalizedName(expected.assist||'')!==normalizedName(goal.assist?.name||'')||
     expected.own_goal!==false)
   fail('登録済みゴールの内容が前回の照合から変わっています。最新のSSデータを読み込んでください');
  const patch=args.patch||{};
  if(Object.keys(patch).some(key=>!['scorer','assist'].includes(key)))
   fail('このPATCH操作には対応していません');
  const newScorer='scorer'in patch?patch.scorer?.name:goal.scorer?.name;
  const newAssist='assist'in patch?patch.assist?.name||'':goal.assist?.name||'';
  if(!newScorer)fail('得点者を確認できません');
  const scorer_id=playerOnSide(officialMatch,goal.side,newScorer);
  const assist_id=newAssist?playerOnSide(officialMatch,goal.side,newAssist):null;
  if(scorer_id===assist_id)fail('得点者とアシスト者が同じです');
  if(scorer_id===goal.scorer?.player_id && assist_id===(goal.assist?.player_id||null))
   fail('修正内容が現在のSSゴールと同一です');
  return {action:'patch',match_id:officialMatch.match_id,goal_id:goal.goal_id,scorer_id,assist_id};
 }
 fail('この画面から試合結果の確定や削除操作は行いません');
}
