import test from 'node:test';
import assert from 'node:assert/strict';
import {spokenPair} from '../match-review.mjs';
test('opening call can include the match number before the two teams',()=>{
 for(const text of ['1試合目1対2','第１試合、１対２です。','1 vs 2'])
   assert.deepEqual(spokenPair(text),['1','2']);
 for(const text of ['1試合目','第1試合 1対','ゴールで1対2','1対2、3対4'])
   assert.equal(spokenPair(text),null);
});
