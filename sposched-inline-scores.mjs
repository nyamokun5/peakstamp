/** Read-only SS score reconciliation for the current PeakStamp screen.
 * No network access or SpoSched writes. Fail closed on ambiguous evidence.
 */
const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase()
 .replace(/\s/g,'').replace(/^チーム/,'team').replace(/^(?:team)?(\d+)$/,'team$1');

export function reconcileInlineScores(snapshot, rows) {
 if (!snapshot || !Array.isArray(snapshot.matches) || snapshot.matches.length !== 4)
  throw Error('SSの正式な4試合を取得してください');
 if (!Array.isArray(rows)) throw Error('ゴール情報を取得できません');
 const fixtures = new Map();
 for (const fixture of snapshot.matches) {
  if (![1,2,3,4].includes(fixture.seq) || fixtures.has(fixture.seq))
   throw Error('SSの試合番号が不正です');
  fixtures.set(fixture.seq, fixture);
 }
 if (fixtures.size !== 4) throw Error('SSの4試合が揃っていません');
 const scores = new Map([...fixtures.keys()].map(seq=>[seq,{left:0,right:0}]));
 const seen = new Set();
 for (const [i,row] of rows.entries()) {
  if (row.include === false) continue;
  const fixture = fixtures.get(Number(row.seq));
  if (!fixture) throw Error('ゴール'+(i+1)+'：試合が未確定です');
  if (!row.scorer || !snapshot.playerTeam?.has(row.scorer))
   throw Error('ゴール'+(i+1)+'：得点者がSS名簿にありません');
  if (!['named','none'].includes(row.assistMode) ||
      (row.assistMode === 'named' && !snapshot.playerTeam?.has(row.assist)))
   throw Error('ゴール'+(i+1)+'：アシストが未確定です');
  const id = row.goal?.id;
  if (id) {
   if (seen.has(id)) throw Error('同じ動画ゴールが重複しています');
   seen.add(id);
  }
  const team = normalize(snapshot.playerTeam.get(row.scorer));
  const left = normalize(fixture.leftTeam), right = normalize(fixture.rightTeam);
  if (!left || !right || left === right)
   throw Error('第'+fixture.seq+'試合：対戦チームが未確定です');
  const side = team === left ? 'left' : team === right ? 'right' : null;
  if (!side) throw Error('ゴール'+(i+1)+'：得点者の所属チームが対戦カードと一致しません');
  scores.get(fixture.seq)[side]++;
 }
 return [...fixtures.values()].sort((a,b)=>a.seq-b.seq).map(fixture=>({
  seq:fixture.seq, fixture, ...scores.get(fixture.seq)
 }));
}
