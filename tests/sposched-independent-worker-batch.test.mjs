import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareIndependentWorkerBatch} from '../sposched-independent-worker-batch.mjs';
const E='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const R='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const fixture=n=>({seq:n,matchId:'11111111-2222-4111-8111-11111111111'+n,status:'scheduled'});
test('independent Worker payload includes UUID, confirmation and official fixture operations',()=>{
 const payload=prepareIndependentWorkerBatch({snapshot:{eventId:E,matches:[fixture(1),fixture(2)]},
  rows:[],decisions:[],requestId:R});
 assert.equal(payload.request_id,R);
 assert.equal(payload.confirm,'PRODUCTION EVENT BATCH WRITE');
 assert.equal(payload.layout_mode,'independent-fixtures-v1');
 assert.equal(payload.fixture_count,2);
 assert.deepEqual(payload.operations.map(x=>x.action),['finish','finish']);
 assert.deepEqual(payload.operations.map(x=>x.expected_match_id),[fixture(1).matchId,fixture(2).matchId]);
});
test('independent Worker payload rejects missing request UUID and more than 64 operations',()=>{
 const base={snapshot:{eventId:E,matches:[fixture(1)]},rows:[],decisions:[]};
 assert.throws(()=>prepareIndependentWorkerBatch({...base,requestId:'invalid'}),/リクエストID/);
});
