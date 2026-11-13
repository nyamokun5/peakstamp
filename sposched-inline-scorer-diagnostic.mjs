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
  const member=String(snapshot?.memberIds?.get(official)||'');
  const player=String(snapshot?.playerIds?.get(official)||'');
  const identityMember=String(identity?.scorer?.memberId||'');
  const identityPlayer=String(identity?.scorer?.playerId||'');
  if(!member||!player)return prefix+'正式名簿に選手IDが不足しています。SS名簿の取得状態を確認してください';
  if(!identityMember||!identityPlayer)return prefix+'解析時に選手IDを保存できていません。SSに再接続して解析結果を更新してください';
  if(member!==identityMember||player!==identityPlayer)
   return prefix+'SSの選手IDが解析時から変わりました。SSに再接続してください';
  if(String(row?.goal?.scorer||'')!==official)
   return prefix+'解析結果の得点者名と照合済み選手名が一致しません';
  const officialTeam=String(snapshot?.playerTeam?.get(official)||'');
  if(String(identity?.scorer?.team||'')!==officialTeam)
   return prefix+'得点者の所属チームが解析時から変わりました';
  return prefix+'得点者の照合情報を再検証できません。ゴールを再確認してください';
 }
 if(display)return prefix+'得点者「'+display+'」が現在のSS名簿にありません';
 if(official)return prefix+'照合済み得点者「'+official+'」が現在のSS名簿にありません';
 if(raw)return prefix+'得点者「'+raw+'」を正式名簿に照合できません。ゴールの選手名を確認してください';
 return prefix+'得点者が未確定です。ゴールの選手名を確認してください';
}
