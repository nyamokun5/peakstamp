/** Read-only, pure plan for an explicitly approved four-fixture TEST tournament.
 * Any uncertain/duplicated/unsupported goal stops the current fixture BEFORE a write.
 * The browser must refresh upstream after every result: waiting finals are not guessed.
 */
import {normalizeTeam} from './sposched-review-core.mjs';

export function analyzeAutoFixture(snapshot,rows,decisions,seq,winner=''){
 const m=snapshot?.matches?.find(x=>x.seq===Number(seq));
 if(!m)throw Error('試合 #'+seq+' がSSにありません');
 if(m.status==='finished'){
  const outstanding=(decisions||[]).filter(d=>Number(rows[d.index]?.seq)===Number(seq)&&
   d.state!=='skipped');
  if(outstanding.length)return {state:'blocked',seq,
   reason:'試合 #'+seq+' は終了済みですが、未解決の動画ゴールが'+outstanding.length+
    '件あります。重複かどうかを確認してください'};
  return {state:'finished',seq};
 }
 if(m.status==='waiting'||!m.matchId||!m.leftTeam||!m.rightTeam)
  return {state:'waiting',seq,reason:'対戦チームが確定していません'};
 if(m.status!=='scheduled')throw Error('試合 #'+seq+' の状態を確認してください');
 if(!Number.isInteger(m.leftScore)||m.leftScore<0||
    !Number.isInteger(m.rightScore)||m.rightScore<0)
  throw Error('試合 #'+seq+' のSSスコアを取得できません');
 const selected=(decisions||[]).filter(d=>Number(rows[d.index]?.seq)===Number(seq));
 const blockers=selected.filter(d=>!['ready','skipped'].includes(d.state));
 if(blockers.length)return {state:'blocked',seq,blockers,
  reason:'#'+seq+'：'+blockers.map(d=>'ゴール'+(d.index+1)+' '+d.reason).join('／')};
 let left=m.leftScore,right=m.rightScore;
 const ready=[];
 for(const decision of selected.filter(d=>d.state==='ready')){
  const row=rows[decision.index];ready.push(row);
  const side=[normalizeTeam(m.leftTeam),normalizeTeam(m.rightTeam)];
  const team=normalizeTeam(row.team||snapshot.playerTeam?.get(row.scorer)||'');
  if(!team||side[0]===side[1]||!side.includes(team))
   return {state:'blocked',seq,reason:'得点者の得点チームが正式な対戦チームと一致しません'};
  if(team===side[0])left++;else right++;
 }
 const isTie=left===right;
 const drawAllowed=Number(seq)===3||Number(seq)===4;
 const choices=drawAllowed?['left','right','draw']:['left','right'];
 if(isTie&&!choices.includes(winner))return {
  state:'winner-needed',seq,left,right,ready,drawAllowed,
  reason:drawAllowed
   ?'試合 #'+seq+' は '+left+' - '+right+' の同点です。引き分け、またはPK等の勝者を選んでください'
   :'試合 #'+seq+' は '+left+' - '+right+' の同点です。準決勝の勝ち上がりチームを選んでください'};
 const side=isTie?winner:left>right?'left':'right';
 if(winner&&winner!==side)
  return {state:'blocked',seq,reason:'勝者が登録予定のスコアと一致しません'};
 return {state:'ready',seq,matchId:m.matchId,eventId:snapshot.eventId,
  left,right,winner:side,ready};
}
export function assertFourMatchBracket(snapshot){
 const matches=snapshot?.matches||[];
 const numbers=matches.map(m=>Number(m.seq));
 if(matches.length!==4||new Set(numbers).size!==4||
   ![1,2,3,4].every(n=>numbers.includes(n)))
  throw Error('一括トーナメント登録は4試合（準決勝#1・#2、3位決定戦#3、決勝#4）だけに対応しています。');
 if(!snapshot.eventId)throw Error('SSのイベントIDがありません');
 return [1,2,3,4];
}

/** Prevent unmatched video goals from silently disappearing from a four-game
 * batch when their fixture number was not recognized. Only an explicit
 * user skip may exclude them; duplicated/uncertain records still need review.
 */
export function unassignedGoalDecisions(snapshot,rows,decisions){
 const valid=new Set((snapshot?.matches||[]).map(m=>m.seq));
 return (decisions||[]).filter(d=>{
  if(d.state==='skipped')return false;
  const seq=rows?.[d.index]?.seq;
  return !Number.isInteger(seq)||!valid.has(seq);
 });
}
