import test from 'node:test';import assert from 'node:assert/strict';
import {submittedAliasRows} from './sposched-batch-alias-source.mjs';
const row=(id,source='video.mov')=>({include:true,guest:false,goal:{id,source:{name:source}}});
test('only submitted video goal IDs are selected',()=>{
 const a=row('1'),b=row('2'),c=row('1','other.mov');
 assert.deepEqual(submittedAliasRows([a,b,c],['video.mov::1']),[a]);
});
test('old jobs without submission evidence never learn',()=>{
 assert.deepEqual(submittedAliasRows([row('1')],null),[]);
 assert.deepEqual(submittedAliasRows([row('1')],[]),[]);
});
test('manual, excluded, guest and sourceless goals are excluded',()=>{
 const a=row('1');
 assert.deepEqual(submittedAliasRows([{...a,include:false},{...a,guest:true},
  {...a,goal:{...a.goal,manual:true}},row('1','')],['video.mov::1']),[]);
});
