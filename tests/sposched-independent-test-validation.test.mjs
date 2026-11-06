import test from 'node:test';
import assert from 'node:assert/strict';
import {validateIndependentTestBatch} from '../sposched-independent-test-validation.mjs';
const E='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const R='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const M='11111111-2222-4111-8111-111111111111';
const url='https://shoot-sunday-independent-validation-test.example.workers.dev/';
const plan={event_id:E,request_id:R,layout_mode:'independent-fixtures-v1',fixture_count:1,
 confirm:'PRODUCTION EVENT BATCH WRITE',operations:[{seq:1,action:'finish',winner:'auto',expected_match_id:M}]};
const official={environment:'TEST',event_id:E,matches:[{seq:1,match_id:M,status:'scheduled'}]};
const capabilities={environment:'TEST',independent_fixture_contract:'independent-fixtures-v1',
 independent_test_validation:true,independent_test_batch_writes:false};
test('validation adapter performs GET capability and POST validate only',async()=>{
 const calls=[];
 const result=await validateIndependentTestBatch({plan,official,bridgeToken:'test',validationWorkerUrl:url,
  fetchImpl:async(target,options)=>{
   calls.push({target,options});
   return {ok:true,json:async()=>options.method==='GET'?capabilities:{
    environment:'TEST',validation_only:true,valid:true,event_id:E,request_id:R,
    layout_mode:'independent-fixtures-v1',fixture_count:1,operation_count:1
   }};
  }});
 assert.equal(result.valid,true);
 assert.deepEqual(calls.map(c=>c.options.method),['GET','POST']);
 assert.ok(calls[1].target.endsWith('/batch/validate'));
 assert.equal(calls[1].options.headers['X-SS-Bridge-Token'],'test');
});
test('validation adapter rejects production and arbitrary endpoints before network access',async()=>{
 for(const target of ['https://shoot-sunday-sync.yomax1979.workers.dev/',
  'https://shoot-sunday-sync-staging.yomax1979.workers.dev/',
  'https://evil.example/','http://shoot-sunday-independent-validation-test.example.workers.dev/']){
  let calls=0;
  await assert.rejects(validateIndependentTestBatch({plan,official,bridgeToken:'test',validationWorkerUrl:target,
   fetchImpl:async()=>{calls++}}),/検証専用Worker以外/);
  assert.equal(calls,0);
 }
});
test('validation adapter rejects unsupported capability without POST',async()=>{
 let calls=0;
 await assert.rejects(validateIndependentTestBatch({plan,official,bridgeToken:'test',validationWorkerUrl:url,
  fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({...capabilities,independent_test_batch_writes:true})}}}),
 /機能を確認できません/);
 assert.equal(calls,1);
});
