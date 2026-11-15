import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGoalIdentityForRegistration} from '../sposched-goal-identity-gate.mjs';
const player={name:'SS正式名',player_id:'p1'};
for(const source of ['local-video','youtube']){
 test(source+' resolves through SS before registration',async()=>{
  let calls=0;
  const r=await prepareGoalIdentityForRegistration({source,scorer:'呼び名',resolveMember:async()=>{
   calls++;return {confirmed:true,player_id:'p1',candidates:[player]};
  }});
  assert.equal(calls,1);assert.equal(r.ready,true);
  assert.deepEqual(r.payload,{scorer_id:'p1',assist_id:null});
 });
 test(source+' prevents unknown identity write',async()=>{
  const r=await prepareGoalIdentityForRegistration({source,scorer:'不明',resolveMember:async()=>({candidates:[]})});
  assert.equal(r.ready,false);assert.equal(r.payload,null);
 });
 test(source+' validates manual selection against fresh SS candidates',async()=>{
  const resolveMember=async()=>({candidates:[player]});
  const r=await prepareGoalIdentityForRegistration({source,scorer:'呼び名',resolveMember,selected:{scorer:'p1'}});
  assert.equal(r.ready,true);
  await assert.rejects(()=>prepareGoalIdentityForRegistration({
   source,scorer:'呼び名',resolveMember,selected:{scorer:'wrong'}}),/名簿/);
 });
}
