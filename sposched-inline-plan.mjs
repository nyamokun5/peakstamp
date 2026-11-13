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
