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

// Match the three numbered SS ranking fixtures. Other six-team schedules
// can contain parallel games or qualifiers and must not use this batch.
export function isSixTeamPlacement(snapshot){
 const matches=snapshot?.matches;
 const ranks=['5-6','3-4','1-2'];
 return Array.isArray(matches)&&matches.length===3&&ranks.every((rank,i)=>
  matches.some(m=>m.seq===i+1&&text(m.title).replace(/^#\d+\s*/, '')
   .replace(/\s/g,'').replace(/[–－〜~]/g,'-')===rank+'位決定戦'));
}

export function usesIndependentFixtures(snapshot){
 return isSixTeamPlacement(snapshot)||
  ['1team','2teams_1pitch','3teams_1pitch'].includes(snapshot?.officialFormat);
}

export function placementPairingIssue(snapshot){
 if(!isSixTeamPlacement(snapshot))return '';
 const teams=new Set();
 for(const m of snapshot.matches){
  if(!m.leftTeam||!m.rightTeam||m.status==='waiting')
   return 'SSのスコア入力で「'+m.title+'」の対戦チームを設定し、再読み込みしてください。';
  for(const side of [m.leftTeam,m.rightTeam]){
   const team=text(side).toLowerCase().replace(/\s/g,'').replace(/^(?:team|チーム)(\d+)$/,'$1');
   if(teams.has(team))return 'SSの順位決定戦で同じチームが重複しています。3試合の対戦カードを確認してください。';
   teams.add(team);
  }
 }
 return '';
}

export function describeOfficialFixtures(snapshot){
 const matches=Array.isArray(snapshot?.matches)?snapshot.matches:[];
 const ordered=[...matches].sort((a,b)=>a.seq-b.seq);
 const bySeq=new Map(ordered.map(m=>[m.seq,m]));
 const exactFour=ordered.length===4&&[1,2,3,4].every(seq=>bySeq.has(seq));
 const medalPair=exactFour&&hasThird(bySeq.get(3)?.title)&&hasFinal(bySeq.get(4)?.title);
 const semiPair=exactFour&&hasSemi(bySeq.get(1)?.title)&&hasSemi(bySeq.get(2)?.title);
 const bothWaiting=exactFour&&bySeq.get(3)?.status==='waiting'&&bySeq.get(4)?.status==='waiting';
 // A genuine legacy four-game bracket may label both placement matches
 // "決勝". Preserve its identity after SS marks the games finished; otherwise
 // completed-job reconciliation would hide the parent completion panel.
 const bothFinals=exactFour&&hasFinal(bySeq.get(3)?.title)&&hasFinal(bySeq.get(4)?.title);
 // Never infer knockout merely from count or teams. Require explicit SS
 // semifinal title evidence, or the unique bronze/final pair.
 const bracket=Boolean(exactFour&&(medalPair||(semiPair&&(bothWaiting||bothFinals))));
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
