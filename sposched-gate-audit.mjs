// Read-only, event-scoped audit of the CURRENT four fixture write gates.
// It does not inspect historical/deleted matches or all event Durable Objects.
export async function auditCurrentTestFixtureGates(matches,readGate){
 if(!Array.isArray(matches)||matches.length!==4)
  throw Error('TESTイベントの現在の4試合が必要です');
 if(typeof readGate!=='function')throw Error('読み取り専用の照合処理が必要です');
 const sorted=[...matches].sort((a,b)=>a.seq-b.seq);
 const ids=new Set();
 for(let i=0;i<4;i++){
  const m=sorted[i];
  if(m.seq!==i+1||typeof m.matchId!=='string'||
     !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(m.matchId)||
     ids.has(m.matchId.toLowerCase()))
   throw Error('試合番号と正式なTEST match_idが揃っていません');
  ids.add(m.matchId.toLowerCase());
 }
 const statuses=await Promise.all(sorted.map(async m=>{
  // The caller must use the existing authenticated /staging/status route,
  // which only reads per-match Durable Object journal records.
  const s=await readGate(m.matchId);
  if(s?.environment!=='STAGING ONLY'||typeof s?.status!=='string'||
     s.write_sent!==false)
   throw Error('TEST書き込みゲートの状態を確認できません');
  return {seq:m.seq,status:s.status,
   recovery_available:s.recovery_available===true};
 }));
 const unsafe=statuses.filter(s=>!['idle','verified'].includes(s.status));
 return {inspected:4,verified:statuses.filter(s=>s.status==='verified').length,
  idle:statuses.filter(s=>s.status==='idle').length,
  pending:statuses.filter(s=>s.status==='pending').length,
  uncertain:unsafe,rows:statuses,
  current_fixtures_clear:unsafe.length===0,
  historical_objects_inspected:false,all_events_clear:false};
}
