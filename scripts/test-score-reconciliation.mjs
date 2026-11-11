import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileFinalScore} from '../sposched-score-reconciliation.mjs';

test('manual score supports unattributed goals', () => {
 const r=reconcileFinalScore({official:{left:0,right:0},draft:{left:3,right:1},goals:[{id:'video-1',side:'left'}]});
 assert.deepEqual(r.unattributedGoals,{left:2,right:1});
 assert.equal(r.scoreChanged,true);
});
test('different goal IDs may have same scorer', () => {
 const r=reconcileFinalScore({official:{left:0,right:0},draft:{left:2,right:0},goals:[{id:'clip-a',side:'left',scorer:'A'},{id:'clip-b',side:'left',scorer:'A'}]});
 assert.equal(r.attributedGoals.left,2);
});
test('same goal ID is rejected', () => {
 assert.throws(()=>reconcileFinalScore({official:{left:0,right:0},draft:{left:2,right:0},goals:[{id:'a',side:'left'},{id:'a',side:'left'}]}),/二重/);
});
test('goal details cannot exceed final score', () => {
 assert.throws(()=>reconcileFinalScore({official:{left:0,right:0},draft:{left:0,right:0},goals:[{id:'a',side:'left'}]}),/超え/);
});
test('invalid score is not silently replaced with zero', () => {
 assert.throws(()=>reconcileFinalScore({official:{left:0,right:0},draft:{left:null,right:1}}),/整数/);
});

test('missing official score is not interpreted as zero', () => {
 assert.throws(()=>reconcileFinalScore({official:{left:null,right:0},draft:{left:1,right:0}}),/SSの現在/);
});
test('unchanged score remains unchanged', () => {
 const r=reconcileFinalScore({official:{left:2,right:1},draft:{left:2,right:1}});
 assert.equal(r.scoreChanged,false);
});
test('two distinct goal IDs remain valid with identical scorer and assist', () => {
 const r=reconcileFinalScore({official:{left:0,right:0},draft:{left:2,right:0},goals:[
  {id:'clip-100',side:'left',scorer:'A',assist:'B'},
  {id:'clip-200',side:'left',scorer:'A',assist:'B'}
 ]});
 assert.equal(r.attributedGoals.left,2);
});
