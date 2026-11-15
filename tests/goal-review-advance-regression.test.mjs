import test from 'node:test';
import assert from 'node:assert/strict';
import {nextGoalAfterDecision,nextUnreviewedGoalVideo} from '../goal-review-queue.mjs';
const row=(key,videoDecision=null,status='draft')=>({key,item:{videoDecision,status}});
test('Keep proceeds in strict numbered order despite cached kept goals',()=>{
 const rows=[row('1','kept','confirmed'),row('2','kept','confirmed'),row('3','kept','confirmed'),row('4'),row('5')];
 for(let i=1;i<5;i++)assert.equal(nextGoalAfterDecision(rows,String(i))?.key,String(i+1));
 assert.equal(nextGoalAfterDecision(rows,'5'),null);
});
test('Keep advances past already judged next item, not the next pending item',()=>{
 const rows=[row('1','kept'),row('2','rejected'),row('3','kept'),row('4')];
 assert.equal(nextGoalAfterDecision(rows,'1')?.key,'2');
 assert.equal(nextGoalAfterDecision(rows,'2')?.key,'3');
 assert.equal(nextGoalAfterDecision(rows,'3')?.key,'4');
});
test('first time Keep on goal four advances to goal five even if goal five was kept',()=>{
 const rows=[row('1','kept'),row('2','kept'),row('3','kept'),row('4','kept'),row('5','kept')];
 assert.equal(nextGoalAfterDecision(rows,'4',{wasUnjudged:true})?.key,'5');
});
test('last goal completes without looping',()=>{
 const rows=[row('1','kept'),row('2','kept')];
 assert.equal(nextGoalAfterDecision(rows,'2',{wasUnjudged:true}),null);
});
test('excluded rows are not navigated into',()=>{
 const rows=[row('1','kept'),row('2',null,'excluded'),row('3')];
 assert.equal(nextGoalAfterDecision(rows,'1')?.key,'3');
});
test('current video is never its own next pending goal',()=>{
 assert.equal(nextUnreviewedGoalVideo([row('1')],'1'),null);
});
