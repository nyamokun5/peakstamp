import test from 'node:test';
import assert from 'node:assert/strict';
import {finishAction,assertFinished,unfinishedGoalCount} from '../sposched-finish.mjs';
import {normalizeSpoSnapshot,prepareGoalRows,preserveReviewRows} from '../sposched-review-core.mjs';
import {quickGoalDecisions} from '../sposched-quick-review.mjs';
const event_id='11111111-1111-4111-8111-111111111111';
const match_id='22222222-2222-4222-8222-222222222223';
const snap=(left_team='チーム2',right_team='チーム4',status='scheduled')=>normalizeSpoSnapshot({event_id,
 matches:[{seq:3,match_id,left_team,right_team,status,left_score:1,right_score:0}],
 roster:{'チーム2':['西村','徳永'],'チーム4':['橋本']}});
test('use current official score, not the number of detected video goals',()=>{
 const s=snap();const a=finishAction(s,s,3,'');assert.equal(a.left_score,1);assert.equal(a.winner,'left');
 const changed=snap();changed.matches[0].leftScore=4;
 assert.equal(finishAction(s,changed,3,'').left_score,4);
 assert.throws(()=>finishAction(s,s,3,'right'),/勝者/);
});
test('tie requires a deliberate result; finished, waiting, stale ID and foreign event fail',()=>{
 const s=snap();s.matches[0].rightScore=1;
 assert.throws(()=>finishAction(s,s,3,''),/同点/);
 assert.equal(finishAction(s,s,3,'right').winner,'right');
 assert.equal(finishAction(s,s,3,'draw').winner,'draw');
 for(const status of ['waiting','finished']){const t=snap('チーム2','チーム4',status);assert.throws(()=>finishAction(t,t,3,''));}
 const replaced=snap();replaced.matches[0].matchId=event_id;assert.throws(()=>finishAction(s,replaced,3,'left'),/match_id/);
 const foreign=snap();foreign.eventId=match_id;assert.throws(()=>finishAction(s,foreign,3,'left'),/イベント/);
});
test('third-place scorer/assist edits survive refresh and waiting goal becomes ready',()=>{
 const before=snap('','','waiting'),after=snap();
 const goals=[{id:'third-goal',matchSeq:3,scorer:'西村',assist:'徳永',assistStatus:'named',source:{name:'IMG_0289.MOV'},goalTimeSeconds:238}];
 const prior=prepareGoalRows({goals},before);
 Object.assign(prior[0],{scorer:'西村',assist:'徳永',assistMode:'named',quickReviewedAll:true,include:true});
 assert.equal(quickGoalDecisions(before,prior)[0].state,'waiting');
 const rows=preserveReviewRows(prepareGoalRows({goals},after),prior,{sameEvent:true,snapshot:after});
 assert.equal(rows[0].assist,'徳永');assert.equal(rows[0].seq,3);
 assert.equal(quickGoalDecisions(after,rows)[0].state,'ready');
 assert.equal(unfinishedGoalCount(after,rows,3,quickGoalDecisions(after,rows)),1);
 rows[0].include=false;
 assert.equal(unfinishedGoalCount(after,rows,3,quickGoalDecisions(after,rows)),0);
});
test('a partial, ambiguous, wrong-environment or wrong-score finish response cannot be called success',()=>{
 const s=snap(),a=finishAction(s,s,3,'');
 const r={environment:'STAGING ONLY',operation:'finish',write_sent:true,readback:{verified:true,status:'finished',left_score:1,right_score:0,winner:'left'}};
 assert.equal(assertFinished(a,r).status,'finished');
 for(const bad of [{...r,environment:'production'},{...r,readback:{...r.readback,verified:false}},
 {...r,readback:{...r.readback,left_score:2}},{...r,operation:'create'}])assert.throws(()=>assertFinished(a,bad));
});
