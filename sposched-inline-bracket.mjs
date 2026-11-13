/** Pure, read-only first-round outcome calculation for a four-team bracket.
 * The official SS roster supplies team membership. A draw requires a human
 * decision and must never be silently treated as a winner.
 */
const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase()
 .replace(/\s/g,'').replace(/^チーム/,'team').replace(/^(?:team)?(\d+)$/,'team$1');
export function inferFirstRoundBracket(snapshot, rows) {
 if (!snapshot || !Array.isArray(snapshot.matches) || snapshot.matches.length !== 4)
  throw Error('SSの正式な4試合を取得してください');
 if (!Array.isArray(rows)) throw Error('ゴール情報を取得できません');
 const fixtures = new Map(snapshot.matches.map(m=>[Number(m.seq),m]));
 if (fixtures.size!==4 || ![1,2,3,4].every(n=>fixtures.has(n)))
  throw Error('SSの試合番号が不正です');
 const totals = new Map([[1,{left:0,right:0}],[2,{left:0,right:0}]]);
 const seen = new Set();
 for (const [i,row] of rows.entries()) {
  if (row.include===false || ![1,2].includes(Number(row.seq))) continue;
  const fixture=fixtures.get(Number(row.seq));
  if (!row.scorer || !snapshot.playerTeam?.has(row.scorer))
   throw Error('ゴール'+(i+1)+'：得点者がSS名簿にありません');
  if (!['none','named'].includes(row.assistMode) ||
      (row.assistMode==='named' && !snapshot.playerTeam?.has(row.assist)))
   throw Error('ゴール'+(i+1)+'：アシストが未確定です');
  const id=row.goal?.id;
  const key=id ? String(row.goal?.source?.name||'')+'::'+id : '';
  if (key) {
   if (seen.has(key)) throw Error('同じ動画ゴールが重複しています');
   seen.add(key);
  }
  const team=normalize(snapshot.playerTeam.get(row.scorer));
  const left=normalize(fixture.leftTeam),right=normalize(fixture.rightTeam);
  if (!left || !right || left===right)
   throw Error('第'+fixture.seq+'試合：対戦カードが未確定です');
  if (team===left) totals.get(Number(row.seq)).left++;
  else if (team===right) totals.get(Number(row.seq)).right++;
  else throw Error('ゴール'+(i+1)+'：得点者の所属が対戦カードと一致しません');
 }
 const rounds=[1,2].map(seq=>{
  const fixture=fixtures.get(seq),score=totals.get(seq);
  if (!fixture.leftTeam || !fixture.rightTeam ||
      normalize(fixture.leftTeam)===normalize(fixture.rightTeam))
   throw Error('第'+seq+'試合：対戦カードが未確定です');
  const winner=score.left===score.right?null:
   score.left>score.right?fixture.leftTeam:fixture.rightTeam;
  const loser=winner===null?null:
   winner===fixture.leftTeam?fixture.rightTeam:fixture.leftTeam;
  return {seq,...score,winner,loser,requiresDecision:winner===null};
 });
 const ready=rounds.every(r=>!r.requiresDecision);
 return {firstRound:rounds,ready,
  thirdPlace:ready?[rounds[0].loser,rounds[1].loser]:null,
  final:ready?[rounds[0].winner,rounds[1].winner]:null};
}
