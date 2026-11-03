// Pure, read-only planner for independent official fixtures. Never authorizes a write.
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const clean=v=>typeof v==='string'?v.trim():'';
const fail=m=>{throw Error(m);};
export function previewIndependentFixtures({snapshot,rows,decisions}){
 const matches=snapshot?.matches;
 if(!UUID.test(snapshot?.eventId||'')||!Array.isArray(matches)||matches.length<1||matches.length>24)
  fail('正式な独立試合イベントが必要です');
 if(!Array.isArray(rows)||!Array.isArray(decisions)||rows.length!==decisions.length)
  fail('ゴールの確認結果が不完全です');
 const ordered=[...matches].sort((a,b)=>a.seq-b.seq),seen=new Set();
 for(let i=0;i<ordered.length;i++){
  const m=ordered[i],id=clean(m.matchId).toLowerCase();
  if(m.seq!==i+1||!UUID.test(id)||seen.has(id)||m.status!=='scheduled')
   fail('公式試合の番号・ID・未開始状態を確認できません');
  seen.add(id);
 }
 const goals=[];
 for(let i=0;i<rows.length;i++){
  const r=rows[i],d=decisions[i];if(!r?.include)continue;
  const fixture=ordered.find(m=>m.seq===Number(r.seq));
  if(!fixture)fail('ゴール'+(i+1)+'：公式試合番号が未確認です');
  if(d?.state!=='ready'||r.goal?.manual||r.updateGoalId||r.guest||
     r.fixtureIdentityChanged||d.helperPlan||d.deferredAssist)
   fail('ゴール'+(i+1)+'：手動登録・助っ人・未確定候補は個別確認が必要です');
  const team=clean(r.team||snapshot.playerTeam?.get(clean(r.scorer)));
  const scorer=clean(r.scorer),assist=r.assistMode==='named'?clean(r.assist):'';
  if(!team||!scorer||!['named','none'].includes(r.assistMode)||
     team.length>120||scorer.length>120||assist.length>120||
     r.assistMode==='named'&&!assist||assist&&assist===scorer)
   fail('ゴール'+(i+1)+'：得点者・チーム・アシストが不完全です');
  const playerTeam=snapshot.playerTeam;
  const normalized=v=>v.normalize('NFKC').toLocaleLowerCase('en').replace(/[\\s\\u3000]/g,'');
  if(playerTeam?.get(scorer)&&normalized(playerTeam.get(scorer))!==normalized(team)||
     assist&&playerTeam?.get(assist)&&normalized(playerTeam.get(assist))!==normalized(team))
   fail('ゴール'+(i+1)+'：選手の所属チームと得点チームが異なります');
  goals.push({seq:fixture.seq,action:'create',team,scorer,assist,
   expected_match_id:fixture.matchId});
 }
 if(goals.length>20)fail('登録予定のゴールが20件を超えています');
 const operations=[];
 for(const fixture of ordered){
  operations.push(...goals.filter(g=>g.seq===fixture.seq));
  operations.push({seq:fixture.seq,action:'finish',winner:'auto',
   expected_match_id:fixture.matchId});
 }
 return {event_id:snapshot.eventId,layout_mode:'independent-fixtures-v1',
  fixture_count:ordered.length,operations};
}
