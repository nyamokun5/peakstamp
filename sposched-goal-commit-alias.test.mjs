import test from 'node:test';
import assert from 'node:assert/strict';
import {aliasIntentsForCommittedGoal,persistCommittedGoalAliases} from './sposched-goal-commit-alias.mjs';

const member='11111111-1111-4111-8111-111111111111';
const snapshot={rosterSource:'official-current-event-teams',
 memberIds:new Map([['大成',member]]),playerTeam:new Map([['大成','Team1']])};
const row={goal:{scorer:'たいせい',assist:'',manual:false},
 scorer:'大成',team:'Team1',quickReviewedFields:{scorer:true}};
test('selection or unverified goal does not create alias intents',()=>{
 assert.deepEqual(aliasIntentsForCommittedGoal({row,snapshot}),[]);
});
test('verified goal uses original Gemini nickname, not edited official name',()=>{
 assert.deepEqual(aliasIntentsForCommittedGoal({row,snapshot,goalVerified:true}),
  [{field:'scorer',alias:'たいせい',person:'大成',member_id:member,team:'Team1'}]);
});
test('AI prefill without human confirmation cannot teach an alias',()=>{
 assert.deepEqual(aliasIntentsForCommittedGoal({row:{...row,quickReviewedFields:{}},snapshot,goalVerified:true}),[]);
});
test('manual goal and absent stable member id cannot teach an alias',()=>{
 assert.deepEqual(aliasIntentsForCommittedGoal({row:{...row,goal:{...row.goal,manual:true}},snapshot,goalVerified:true}),[]);
 assert.deepEqual(aliasIntentsForCommittedGoal({row,snapshot:{...snapshot,memberIds:new Map()},goalVerified:true}),[]);
});
test('uncertain alias write never retries and never implies success',async()=>{
 let calls=0;
 const [result]=await persistCommittedGoalAliases({
  intents:aliasIntentsForCommittedGoal({row,snapshot,goalVerified:true}),
  save:async()=>{calls++;throw Error('network');}
 });
 assert.equal(calls,1);assert.equal(result.saved,false);assert.equal(result.uncertain,true);
});
test('save must return matching member ID and alias',async()=>{
 const intents=aliasIntentsForCommittedGoal({row,snapshot,goalVerified:true});
 const [wrong]=await persistCommittedGoalAliases({intents,
  save:async()=>({saved:true,user_id:'22222222-2222-4222-8222-222222222222',alias:'たいせい'})});
 assert.equal(wrong.saved,false);
 const [right]=await persistCommittedGoalAliases({intents,
  save:async()=>({saved:true,user_id:member,alias:'たいせい'})});
 assert.equal(right.saved,true);
});
