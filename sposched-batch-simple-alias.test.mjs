import test from 'node:test';
import assert from 'node:assert/strict';
import {aliasesAfterVerifiedBatch as plan} from './sposched-batch-simple-alias.mjs';
const id=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const snapshot={rosterSource:'official-current-event-teams',memberIds:new Map([['田中太郎',id(1)],['佐藤花子',id(2)]]),playerTeam:new Map([['田中太郎','T1'],['佐藤花子','T1']])};
const row=(alias,person,goalId)=>({include:true,quickReviewedAll:true,team:'T1',scorer:person,assistMode:'none',goal:{id:goalId,scorer:alias}});
test('never learns before the entire batch is verified',()=>assert.deepEqual(plan({rows:[row('タロウ','田中太郎','1')],snapshot}),[]));
test('two different calls for two goals by one player both learn',()=>{
 const r=plan({verified:true,rows:[row('タロウ','田中太郎','1'),row('タナカ','田中太郎','2')],snapshot});
 assert.deepEqual(r.map(x=>[x.alias,x.person]),[['タロウ','田中太郎'],['タナカ','田中太郎']]);
});
test('repeat same alias for same member is learned once',()=>{
 const r=plan({verified:true,rows:[row('タロウ','田中太郎','1'),row('タロウ','田中太郎','2')],snapshot});
 assert.equal(r.length,1);
});
test('ambiguous alias for different people is never learned',()=>{
 const r=plan({verified:true,rows:[row('タロウ','田中太郎','1'),row('タロウ','佐藤花子','2')],snapshot});
 assert.deepEqual(r,[]);
});
test('unreviewed goals cannot teach names',()=>{
 const r=plan({verified:true,rows:[{...row('タロウ','田中太郎','1'),quickReviewedAll:false}],snapshot});
 assert.deepEqual(r,[]);
});

test('hiragana and katakana of an ambiguous alias are treated as one name',()=>{
 const r=plan({verified:true,rows:[row('タロウ','田中太郎','1'),row('たろう','佐藤花子','2')],snapshot});
 assert.deepEqual(r,[]);
});
