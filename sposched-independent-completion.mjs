// Verify a completed independent-fixture job against a fresh official snapshot.
// No mutation, network or browser dependencies.
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function verifyCompletedIndependentSnapshot(job,fresh,previous){
 if(job?.layout_mode!=='independent-fixtures-v1'||job.status!=='completed'||
    !UUID.test(job.event_id||'')||fresh?.eventId!==job.event_id||
    previous?.eventId!==job.event_id)throw Error('独立試合ジョブのイベントIDまたは状態が不一致です');
 const count=job.fixture_count;
 if(!Number.isInteger(count)||count<1||count>24||
    fresh.matches?.length!==count||previous.matches?.length!==count)
  throw Error('公式試合件数が登録前後で一致しません');
 const ids=job.fixture_ids||{};
 const seen=new Set();
 for(let seq=1;seq<=count;seq++){
  const before=previous.matches.filter(m=>m.seq===seq);
  const after=fresh.matches.filter(m=>m.seq===seq);
  const id=String(ids[seq]||before[0]?.matchId||'').toLowerCase();
  if(before.length!==1||after.length!==1||!UUID.test(id)||
     String(before[0].matchId||'').toLowerCase()!==id||
     String(after[0].matchId||'').toLowerCase()!==id||
     after[0].status!=='finished'||seen.has(id))
   throw Error('試合 #'+seq+' の正式IDまたは終了状態が不一致です');
  seen.add(id);
 }
 return true;
}
