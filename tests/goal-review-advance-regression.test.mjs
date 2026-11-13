import test from 'node:test';
import assert from 'node:assert/strict';
import {nextGoalAfterDecision,nextUnreviewedGoalVideo} from '../goal-review-queue.mjs';
const row=(key,videoDecision=null,status='draft')=>({key,item:{videoDecision,status}});
test('Keep advances to next unreviewed goal even when earlier ones were kept',()=>{
 const rows=[row('a','kept','confirmed'),row('b','kept','confirmed'),row('c'),row('d')];
 assert.equal(nextGoalAfterDecision(rows,'b',{wasUnjudged:true})?.key,'c');
});
test('re-Keep of already reviewed goal advances to next sequential video',()=>{
 const rows=[row('a','kept','confirmed'),row('b','kept','confirmed'),row('c','kept','confirmed')];
 assert.equal(nextGoalAfterDecision(rows,'a',{wasUnjudged:false})?.key,'b');
 assert.equal(nextGoalAfterDecision(rows,'b',{wasUnjudged:false})?.key,'c');
 assert.equal(nextGoalAfterDecision(rows,'c',{wasUnjudged:false}),null);
});
test('newly completed final goal ends review, no loop back',()=>{
 const rows=[row('a','kept','confirmed'),row('b','kept','confirmed')];
 assert.equal(nextGoalAfterDecision(rows,'b',{wasUnjudged:true}),null);
});
test('current video is never returned as its own next pending goal',()=>{
 assert.equal(nextUnreviewedGoalVideo([row('a')],'a'),null);
 assert.equal(nextUnreviewedGoalVideo([row('a'),row('b')],'a')?.key,'b');
});
test('pending goals are preferred over already judged sequential videos',()=>{
 const rows=[row('a','kept'),row('b','kept'),row('c'),row('d','kept')];
 assert.equal(nextGoalAfterDecision(rows,'a',{wasUnjudged:false})?.key,'c');
});
