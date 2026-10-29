import test from 'node:test';
import assert from 'node:assert/strict';
import {jobControlPayload} from '../sposched-job-control.mjs';
const state={control_contract:'event-pause-v1',environment:'STAGING ONLY',event_id:'event',request_id:'job',status:'running',phase:'preparing',cursor:1};
const context={environment:'staging',eventId:'event',requestId:'job'};
test('pause is bound to TEST event and stored job; old workers and production cannot expose controls',()=>{
 assert.equal(jobControlPayload('pause',state,context).confirm,'TEST-ONLY BATCH PAUSE');
 for(const change of [{environment:'production'},{eventId:'other'},{requestId:'other'}, {requestId:null}])
  assert.throws(()=>jobControlPayload('pause',state,{...context,...change}));
 assert.throws(()=>jobControlPayload('pause',{...state,control_contract:null},context));
 assert.throws(()=>jobControlPayload('pause',{...state,pause_requested:true},context));
 for(const blocked of [{inspection_only:true},{observation_only:true}]){
  assert.throws(()=>jobControlPayload('pause',{...state,...blocked},context));
  assert.throws(()=>jobControlPayload('resume',{...state,status:'paused',pause_id:'pause',...blocked},context));
 }

});
test('resume requires safe paused preparing state and passes exact pause identity and cursor',()=>{
 const paused={...state,status:'paused',pause_id:'pause'};
 assert.deepEqual(jobControlPayload('resume',paused,context),{event_id:'event',request_id:'job',confirm:'TEST-ONLY BATCH RESUME',pause_id:'pause',cursor:1});
 for(const change of [{status:'blocked'},{status:'completed'},{phase:'executing'},{pause_id:null},{cursor:-1}])
  assert.throws(()=>jobControlPayload('resume',{...paused,...change},context));
});
