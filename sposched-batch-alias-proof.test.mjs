import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedBatchAliasIntents as prove} from './sposched-batch-alias-proof.mjs';
const intent={field:'scorer',alias:'たけ',person:'竹田',member_id:'11111111-1111-4111-8111-111111111111',team:'T1'};
const source={sourceName:'IMG_1000.mov',sourceGoalId:'video-goal-1',seq:1,scorer:'竹田',team:'T1',assist:'',officialGoalId:'goal-1',intents:[intent]};
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
 assert.equal(result.length,0);
});

test('rejects missing source identity',()=>{
 assert.deepEqual(prove({eventVerified:true,reviewed:[{...source,sourceGoalId:''}],official:[official]}),[]);
});

test('same scorer can have two distinct goals when both official IDs are proven',()=>{
 const second={...source,sourceGoalId:'video-goal-2',officialGoalId:'goal-2'};
 const officialSecond={...official,id:'goal-2'};
 const result=prove({eventVerified:true,reviewed:[source,second],official:[official,officialSecond]});
 assert.deepEqual(result.map(x=>x.officialGoalId),['goal-1','goal-2']);
});
test('same source goal cannot teach aliases from two official goal IDs',()=>{
 const second={...source,officialGoalId:'goal-2'};
 const result=prove({eventVerified:true,reviewed:[source,second],official:[official,{...official,id:'goal-2'}]});
 assert.deepEqual(result.map(x=>x.officialGoalId),[]);
});

test('two different spoken aliases for one official player remain independently learnable',()=>{
 const first={...source,intents:[{...intent,alias:'タロウ'}]};
 const second={...source,sourceGoalId:'video-goal-2',officialGoalId:'goal-2',intents:[{...intent,alias:'タナカ'}]};
 const officialSecond={...official,id:'goal-2'};
 const result=prove({eventVerified:true,reviewed:[first,second],official:[official,officialSecond]});
 assert.deepEqual(result.map(x=>[x.alias,x.person,x.officialGoalId]),[
  ['タロウ','竹田','goal-1'],['タナカ','竹田','goal-2']]);
});
