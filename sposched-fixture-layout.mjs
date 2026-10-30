/** SS is the source of truth for fixture count, identity and order.
 * Read-only presentation policy. Never infer a match from a team count or a
 * displayed "#round" label: six-team events can have two pitches per round.
 *
 * Only the known four-fixture semifinal -> bronze/final bracket may use the
 * existing durable automatic knockout writer. All other events use the
 * already-available signed per-goal TEST writer and explicit per-match finish.
 */
const text=value=>String(value??'').normalize('NFKC').trim();
const hasThird=title=>/(?:3\s*位.*(?:決定|戦)|third[\s-]*place|bronze)/i.test(text(title));
const hasFinal=title=>/(?:決勝|\bfinal\b)/i.test(text(title))&&!/(?:準決勝|semi[\s-]*final)/i.test(text(title));
const hasSemi=title=>/(?:準決勝|semi[\s-]*final)/i.test(text(title));
const hasDecider=title=>hasFinal(title)||hasSemi(title)||/(?:順位決定|play[\s-]*off)/i.test(text(title));

export function describeOfficialFixtures(snapshot){
 const matches=Array.isArray(snapshot?.matches)?snapshot.matches:[];
 const ordered=[...matches].sort((a,b)=>a.seq-b.seq);
 const bySeq=new Map(ordered.map(m=>[m.seq,m]));
 const exactFour=ordered.length===4&&[1,2,3,4].every(seq=>bySeq.has(seq));
 const medalPair=exactFour&&hasThird(bySeq.get(3)?.title)&&hasFinal(bySeq.get(4)?.title);
 // A title is supplied by SS; alternatively *both* unresolved slots provide
 // explicit 4-game dependency evidence. Never assume any four games are KO.
 const bracket=Boolean(exactFour&&(medalPair||
  (bySeq.get(3)?.status==='waiting'&&bySeq.get(4)?.status==='waiting'&&
   (hasSemi(bySeq.get(1)?.title)||hasSemi(bySeq.get(2)?.title)))));
 const ready=ordered.filter(m=>m.status==='scheduled'&&m.matchId&&m.leftTeam&&m.rightTeam);
 const waiting=ordered.filter(m=>m.status==='waiting'||!m.matchId||!m.leftTeam||!m.rightTeam);
 const finished=ordered.filter(m=>m.status==='finished');
 const seen=new Set();
 for(const m of ordered)for(const team of [m.leftTeam,m.rightTeam]){
  const name=text(team);if(name)seen.add(name);
 }
 return {kind:bracket?'four-knockout':'official-fixtures',automaticFourMatch:bracket,
  count:ordered.length,teams:seen.size,ready:ready.length,
  waiting:waiting.length,finished:finished.length,
  matches:ordered};
}

/** Decide whether the UI can offer a draw; the signed TEST API independently
 * validates the actual match and may still reject an unsupported result.
 */
export function drawOptionForFixture(layout,fixture){
 if(!fixture||fixture.status!=='scheduled')return false;
 if(layout?.automaticFourMatch)return Number(fixture.seq)>=3;
 if(hasSemi(fixture.title)||hasFinal(fixture.title)||hasDecider(fixture.title))
  return false;
 return true;
}

export function fixtureSummaryLabel(layout){
 const n=layout?.count??0;
 if(!n)return 'SSに登録された試合がありません';
 return layout.automaticFourMatch
  ?'SS公式：4試合トーナメント（準決勝 → 3位決定戦・決勝）'
  :'SS公式：'+n+'試合（対戦表をそのまま使用）';
}
