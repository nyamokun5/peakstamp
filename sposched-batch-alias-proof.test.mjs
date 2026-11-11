import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedBatchAliasIntents as prove} from './sposched-batch-alias-proof.mjs';
const intent={field:'scorer',alias:'たけ',person:'竹田',member_id:'11111111-1111-4111-8111-111111111111',team:'T1'};
const source={seq:1,scorer:'竹田',team:'T1',assist:'',officialGoalId:'goal-1',intents:[intent]};
const official={id:'goal-1',seq:1,scorer:'竹田',team:'T1',assist:''};
test('requires event-level proof',()=>assert.deepEqual(prove({reviewed:[source],official:[official]}),[]));
test('requires unique exact official goal ID',()=>{
 assert.deepEqual(prove({eventVerified:true,reviewed:[source],official:[official,official]}),[]);
 assert.deepEqual(prove({eventVerified:true,reviewed:[source],official:[{...official,id:'goal-2'}]}),[]);
});
test('rejects changed match or scorer',()=>{
 assert.deepEqual(prove({eventVerified:true,reviewed:[source],official:[{...official,seq:2}]}),[]);
 assert.deepEqual(prove({eventVerified:true,reviewed:[source],official:[{...official,scorer:'別人'}]}),[]);
});
test('one verified goal produces one alias intent',()=>{
 const result=prove({eventVerified:true,reviewed:[source],official:[official]});
 assert.equal(result.length,1);assert.equal(result[0].officialGoalId,'goal-1');
});
test('duplicate source mapping never teaches twice',()=>{
 const result=prove({eventVerified:true,reviewed:[source,source],official:[official]});
 assert.equal(result.length,1);
});
