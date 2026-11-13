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
