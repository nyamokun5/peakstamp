// TEST-only review of fixture identities after a four-match bracket reset.
// This module only validates current official data. It cannot approve writes.
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const fail=message=>{throw Error(message)};
function fixtures(snapshot){
 if(!snapshot||!Array.isArray(snapshot.matches)||snapshot.matches.length!==4)
  fail('TESTの4試合を再取得してください');
 const matches=[...snapshot.matches].sort((a,b)=>a.seq-b.seq);
 const ids=new Set();
 for(let i=0;i<4;i++){
  const m=matches[i];
  const id=m?.matchId?.toLowerCase();
  if(m?.seq!==i+1||!UUID.test(id||'')||ids.has(id))
   fail('新しい正式な4試合の番号とIDを確認できません');
  ids.add(id);
  if(!['scheduled','waiting'].includes(m.status)||
     Number(m.leftScore)!==0||Number(m.rightScore)!==0||
     (m.existingGoals||[]).length!==0)
   fail('新しい4試合が未開始・無得点の状態ではありません。再登録せず確認してください');
 }
 return matches;
}
export function validateResetGoalRebinding(previous,current,rows){
 if(previous?.eventId!==current?.eventId||!UUID.test(current?.eventId||''))
  fail('TESTイベントIDが変更されました。再取得してください');
 const before=fixtures(previous),after=fixtures(current);
 for(let i=0;i<4;i++){
  if(before[i].matchId.toLowerCase()!==after[i].matchId.toLowerCase())
   fail('照合中に試合IDが変わりました。最初から再確認してください');
 }
 if(!Array.isArray(rows))fail('ゴール候補がありません');
 const indices=[];
 for(let i=0;i<rows.length;i++){
  const row=rows[i];
  if(row.fixtureIdentityChanged!==true)continue;
  const seq=Number(row.seq),fixture=after[seq-1];
  if(!Number.isInteger(seq)||!fixture||fixture.seq!==seq||
     row.matchGuess?.seq!==seq||
     row.matchGuess?.fixtureMatchId?.toLowerCase()!==fixture.matchId.toLowerCase()||
     row.matchGuess?.ambiguous||row.matchGuess?.conflict||
     (Number.isInteger(Number(row.goal?.matchSeq))&&Number(row.goal.matchSeq)>0&&
      Number(row.goal.matchSeq)!==seq)||
     row.goal?.manual||row.guest||row.updateGoalId)
   fail('一部のゴールは試合番号を個別に確認する必要があります。自動一括確認しません');
  indices.push(i);
 }
 if(!indices.length)fail('新しい試合IDへの再確認が必要なゴールはありません');
 return {eventId:current.eventId,matchIds:after.map(m=>m.matchId),
  indices,count:indices.length};
}
