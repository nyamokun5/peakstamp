/** Build the existing TEST Worker contract from official SS roster rows.
 * Pure and fail-closed. Does not infer a winner for tied fixtures.
 */
import {quickGoalDecisions} from './sposched-quick-review.mjs';
import {prepareWorkerTournament} from './sposched-worker-batch.mjs';
import {validateInlineBatchReadiness} from './sposched-inline-batch-gate.mjs';
export function buildInlineWorkerPlan({snapshot,rows,requestId}={}){
 const tournament=validateInlineBatchReadiness(snapshot,rows);
 const decisions=quickGoalDecisions(snapshot,rows);
 const invalid=decisions.find(d=>!['ready','waiting','skipped'].includes(d.state));
 if(invalid)throw Error('ゴール'+(invalid.index+1)+'：'+invalid.reason);
 // Worker independently verifies score and fixture state before every write.
 // The server-side batch always derives knockout opponents from round 1.
 const plan=prepareWorkerTournament({snapshot,rows,decisions,requestId});
 if(plan.operations.filter(op=>op.action==='finish').length!==4)
  throw Error('4試合の終了処理を生成できません');
 return {plan,tournament};
}

/** TEST-only phase-one plan: validate only semifinals, leaving later
 * waiting-fixture goals untouched. Never dispatch from this pure function.
 */
export function buildInlineFirstRoundPlan({snapshot,rows,requestId}={}){
 if(!snapshot?.eventId||!Array.isArray(rows))throw Error('SSイベントを再取得してください');
 const firstRows=rows.filter(r=>[1,2].includes(Number(r?.seq)));
 const decisions=quickGoalDecisions(snapshot,firstRows);
 const invalid=decisions.find(d=>!['ready','skipped'].includes(d.state));
 if(invalid)throw Error('準決勝ゴール'+(invalid.index+1)+'：'+invalid.reason);
 // Canonical planner still requires four fixtures. Supply only verified
 // semifinal goals and discard the later finish operations.
 const plan=prepareWorkerTournament({snapshot,rows:firstRows,decisions,requestId});
 const operations=plan.operations.filter(op=>op.seq<=2);
 if(operations.filter(op=>op.action==='finish').length!==2)
  throw Error('準決勝2試合の終了操作がありません');
 return {plan:{...plan,layout_mode:'four-knockout-staged-v1',operations}};
}

/** Build the continuation only after the persisted Worker confirms phase one.
 * No earlier operations are ever included in the append request.
 */
export function buildInlineSecondRoundPlan({snapshot,rows,workerJob}={}){
 if(workerJob?.layout_mode!=='four-knockout-staged-v1'||
    workerJob.status!=='awaiting_second_round'||
    workerJob.event_id!==snapshot?.eventId||
    workerJob.cursor!==workerJob.total)
  throw Error('準決勝の完了記録をWorkerから確認してください');
 const laterRows=(rows||[]).filter(r=>[3,4].includes(Number(r?.seq)));
 const decisions=quickGoalDecisions(snapshot,laterRows);
 const invalid=decisions.find(d=>!['ready','waiting','skipped'].includes(d.state));
 if(invalid)throw Error('後半ゴール'+(invalid.index+1)+'：'+invalid.reason);
 // This uses the canonical plan validator, but only later operations are
 // submitted; official fixture and player checks remain in the Worker.
 // The canonical four-match planner rejects finished fixtures. The
 // already-completed semifinals are not sent again: use a planning-only
 // projection while retaining the official later fixture IDs and roster.
 const first=snapshot.matches.filter(m=>[1,2].includes(Number(m.seq)));
 if(first.length!==2||first.some(m=>m.status!=='finished'))
  throw Error('SSで準決勝2試合の終了を確認できません');
 const projected={...snapshot,matches:snapshot.matches.map(m=>
  [1,2].includes(Number(m.seq))?{...m,status:'scheduled'}:m)};
 const plan=prepareWorkerTournament({
  snapshot:projected,rows:laterRows,decisions,requestId:workerJob.request_id
 });
 const operations=plan.operations.filter(op=>op.seq>=3);
 if(operations.filter(op=>op.action==='finish').length!==2)
  throw Error('後半2試合の終了操作がありません');
 return {event_id:snapshot.eventId,request_id:workerJob.request_id,
  confirm:'TEST-ONLY BATCH APPEND',operations};
}
