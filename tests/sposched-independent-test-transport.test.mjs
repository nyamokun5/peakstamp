import test from 'node:test';
import assert from 'node:assert/strict';
import {startIndependentTestBatch,INDEPENDENT_TEST_WORKER} from '../sposched-independent-test-transport.mjs';
const E='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const R='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const M='11111111-2222-4111-8111-111111111111';
const plan={event_id:E,request_id:R,layout_mode:'independent-fixtures-v1',fixture_count:1,
 confirm:'PRODUCTION EVENT BATCH WRITE',operations:[{seq:1,action:'finish',winner:'auto',expected_match_id:M}]};
const official={environment:'TEST',event_id:E,matches:[{seq:1,match_id:M,status:'scheduled'}]};
const capability={environment:'TEST',independent_fixture_contract:'independent-fixtures-v1',independent_test_batch_writes:true};
test('TEST transport checks live capability before POST, never contacts production',async()=>{
 const calls=[];
 const fetchImpl=async(url,init)=>{
  calls.push({url,method:init.method});
  assert.ok(url.startsWith(INDEPENDENT_TEST_WORKER+'/'));
  if(init.method==='GET')return {ok:true,json:async()=>capability};
  assert.equal(JSON.parse(init.body).request_id,R);
  return {ok:true,json:async()=>({environment:'TEST',event_id:E,request_id:R,layout_mode:'independent-fixtures-v1',fixture_count:1})};
 };
 await assert.rejects(startIndependentTestBatch({plan,official,bridgeToken:'test',fetchImpl}),/明示的/);
 assert.equal(calls.length,0);
 await startIndependentTestBatch({plan,official,bridgeToken:'test',allowTestWrites:true,fetchImpl});
 assert.deepEqual(calls.map(x=>x.method),['GET','POST']);
});
test('TEST transport refuses absent or disabled capability without POST',async()=>{
 for(const bad of [{...capability,independent_test_batch_writes:false},{...capability,environment:'PRODUCTION'},{}]){
  const calls=[];
  await assert.rejects(startIndependentTestBatch({plan,official,bridgeToken:'test',allowTestWrites:true,
   fetchImpl:async(url)=>{calls.push(url);return {ok:true,json:async()=>bad}}}),/対応していません/);
  assert.deepEqual(calls,[INDEPENDENT_TEST_WORKER+'/batch/capabilities']);
 }
});
test('TEST transport rejects production official evidence before network access',async()=>{
 let calls=0;
 await assert.rejects(startIndependentTestBatch({plan,official:{...official,environment:'PRODUCTION'},bridgeToken:'test',allowTestWrites:true,
  fetchImpl:async()=>{calls++}}),/正式な登録先/);
 assert.equal(calls,0);
});
test('TEST transport rejects mismatched POST result without retry',async()=>{
 let posts=0;
 await assert.rejects(startIndependentTestBatch({plan,official,bridgeToken:'test',allowTestWrites:true,
  fetchImpl:async(url)=>url.endsWith('/batch/capabilities')
   ?{ok:true,json:async()=>capability}
   :(posts++,{ok:true,json:async()=>({environment:'PRODUCTION'})})
 }),/再送しないでください/);
 assert.equal(posts,1);
});
