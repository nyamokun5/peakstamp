/** Explain a read-only SS scorer validation failure without guessing identity.
 * Never changes a scorer, confirms an identity or permits a write.
 */
export function scorerRosterError(row,snapshot,index){
 const prefix='ゴール'+(index+1)+'：';
 if(row?.scorer&&snapshot?.playerTeam?.has(row.scorer))return null;
 const identity=row?.goal?.ssIdentity;
 const raw=String(row?.goal?.rawScorer??row?.goal?.scorer??'').trim();
 const display=String(row?.scorer??'').trim();
 const official=String(identity?.scorer?.name??'').trim();
 if(official&&snapshot?.playerTeam?.has(official)){
  const fixture=snapshot?.matches?.find(m=>Number(m.seq)===Number(row.seq));
  if(!fixture?.matchId)return prefix+'得点者は名簿にいますが、SS試合IDが未確定です。SSの試合枠を確認してください';
  if(identity?.eventId!==snapshot?.eventId)return prefix+'得点者の照合先イベントが異なります。SSに再接続してください';
  if(identity?.matchId!==fixture.matchId||Number(identity?.seq)!==Number(row.seq))
   return prefix+'得点者の照合先試合が変更されました。SSに再接続してください';
  return prefix+'得点者の選手IDを再検証できません。SSに再接続してください';
 }
 if(display)return prefix+'得点者「'+display+'」が現在のSS名簿にありません';
 if(official)return prefix+'照合済み得点者「'+official+'」が現在のSS名簿にありません';
 if(raw)return prefix+'得点者「'+raw+'」を正式名簿に照合できません。ゴールの選手名を確認してください';
 return prefix+'得点者が未確定です。ゴールの選手名を確認してください';
}
