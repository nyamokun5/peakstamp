import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCurrentConnection} from '../sposched-connection-scope.mjs';
const original={environment:'production',revision:7,token:'same-token',eventId:'fixture-A'};
test('matching connection and event snapshot may apply official GET data',()=>{
 assert.equal(assertCurrentConnection(original,{...original}),true);
});
test('rejects production result when environment is switched to TEST',()=>{
 assert.throws(()=>assertCurrentConnection(original,{...original,environment:'staging'}),
  {code:'stale_connection'});
});
test('rejects stale response even after switching away and back to same environment',()=>{
 assert.throws(()=>assertCurrentConnection(original,{...original,revision:9}),
  {code:'stale_connection'});
});
test('rejects event or credential changes during a pending official read',()=>{
 for(const patch of [{eventId:'fixture-B'},{token:'new-token'},{token:''}]){
  assert.throws(()=>assertCurrentConnection(original,{...original,...patch}),
   {code:'stale_connection'});
 }
});
test('fails closed for missing or unexpected context',()=>{
 for(const x of [null,{}, {...original,environment:'other'},
  {...original,revision:NaN},{...original,revision:-1}]){
  assert.throws(()=>assertCurrentConnection(x,original),{code:'stale_connection'});
 }
});
