import test from 'node:test';
import assert from 'node:assert/strict';
import {startIndependentTestBatch,INDEPENDENT_TEST_WORKER} from '../sposched-independent-test-transport.mjs';
const E='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const R='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const M='11111111-2222-4111-8111-111111111111';
const plan={event_id:E,request_id:R,layout_mode:'independent-fixtures-v1',fixture_count:1,
 confirm:'PRODUCTION EVENT BATCH WRITE',operations:[{seq:1,action:'finish',winner:'auto',expected_match_id:M}]};
const official={environment:'TEST',event_id:E,matches:[{seq:1,match_id:M,status:'scheduled'}]};
test('TEST transport requires explicit authorization and never contacts production',async()=>{
 let calls=0;
 const fetchImpl=async(url,init)=>{calls++;assert.equal(url,INDEPENDENT_TEST_WORKER+'/production/batch/start');
  assert.equal(JSON.parse(init.body).request_id,R);
  return {ok:true,json:async()=>({environment:'TEST',event_id:E,request_id:R,layout_mode:'independent-fixtures-v1',fixture_count:1})};
 };
 await assert.rejects(startIndependentTestBatch({plan,official,bridgeToken:'test',fetchImpl}),/明示的/);
 assert.equal(calls,0);
 await assert.rejects(startIndependentTestBatch({plan,official,bridgeToken:'test',allowTestWrites:true,fetchImpl}),/登録契約が未確認/);
 assert.equal(calls,0);
 await startIndependentTestBatch({plan,official,bridgeToken:'test',allowTestWrites:true,workerContract:'independent-test-batch-v1',fetchImpl});
 assert.equal(calls,1);
});
test('TEST transport fails closed on production evidence and mismatched response',async()=>{
 let calls=0;
 const fetchImpl=async()=>{calls++;return {ok:true,json:async()=>({environment:'PRODUCTION'})}};
 await assert.rejects(startIndependentTestBatch({plan,official:{...official,environment:'PRODUCTION'},bridgeToken:'test',allowTestWrites:true,workerContract:'independent-test-batch-v1',fetchImpl}),/正式な登録先/);
 assert.equal(calls,0);
 await assert.rejects(startIndependentTestBatch({plan,official,bridgeToken:'test',allowTestWrites:true,workerContract:'independent-test-batch-v1',fetchImpl}),/再送しないでください/);
});
