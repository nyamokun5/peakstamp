// Finish only the existing paused TEST step; never create or replay goals.
export function drawDecisionPlan(job, snapshot) {
 if (!job || job.event_id !== snapshot?.eventId || job.status !== 'needs_decision' ||
     job.phase !== 'preparing' || ![3,4].includes(job.decision?.seq) ||
     !job.decision.choices?.includes('draw') || !job.request_id)
  throw Error('引き分けの確認待ちではありません。登録状況を再確認してください');
 for (const seq of [1,2,3,4]) {
  const matches = snapshot.matches.filter(m => Number(m.seq) === seq);
  if (matches.length !== 1 || !job.fixture_ids?.[seq] || matches[0].matchId !== job.fixture_ids[seq])
   throw Error('登録先の試合IDが一致しません。再送せず履歴を確認してください');
 }
 const d = job.decision, m = snapshot.matches.find(m => Number(m.seq) === d.seq);
 if (d.match_id !== m.matchId || m.status !== 'scheduled' ||
     !Number.isInteger(m.leftScore) || m.leftScore < 0 || m.leftScore !== m.rightScore ||
     d.left_score !== m.leftScore || d.right_score !== m.rightScore)
  throw Error('SSの得点・試合状態が変わりました。登録状況を再確認してください');
 return {event_id:job.event_id,request_id:job.request_id,seq:d.seq,
  winner:'draw',confirm:'TEST-ONLY BATCH DECISION'};
}
export async function sendDrawDecisionOnce({job,snapshot,inspect,refreshOfficial,send,storage,verifyCurrent}) {
 const plan = drawDecisionPlan(job,snapshot);
 const key = 'peakstamp:test:decision-pending:'+plan.request_id+':'+plan.seq;
 if(storage.getItem(key))throw Error('前回の送信結果が不明です。再送せず登録状況を確認してください');
 const current = await inspect(plan.event_id);
 const fresh = await refreshOfficial(plan.event_id);
 const checked = drawDecisionPlan(current,fresh);
 if(JSON.stringify(checked)!==JSON.stringify(plan) || current.cursor!==job.cursor ||
    current.decision.left_score!==job.decision.left_score || current.decision.right_score!==job.decision.right_score)
  throw Error('確認待ちの内容が変わりました。登録状況を再確認してください');
 verifyCurrent();
 storage.setItem(key,JSON.stringify(plan));
 const result = await send(plan); // Exactly one write; an ambiguous outcome stays locked.
 if(result?.request_id!==plan.request_id || result?.event_id!==plan.event_id)
  throw Error('応答を照合できません。再送せず登録状況を確認してください');
 storage.removeItem(key);
 return result;
}
