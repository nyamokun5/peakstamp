import test from 'node:test';
import assert from 'node:assert/strict';
import {onConfirmedGoalPlayerSelection as learn} from '../sposched-goal-alias-learning.mjs';
const snapshot={matches:[{seq:1,leftTeam:'チーム1',rightTeam:'チーム2'}],players:['西村','山口'],playerTeam:new Map([['西村','チーム1'],['山口','チーム2']])};
const row={seq:1,team:'チーム1',goal:{scorer:'よーさん',assist:''}};
test('human scorer choice invokes SS alias writer automatically',async()=>{
 let writes=[];let r=await learn({row,snapshot,field:'scorer',officialName:'西村',writeAlias:async x=>{writes.push(x);return {ok:true}}});
 assert.equal(r.saved,true);assert.deepEqual(writes,[{alias:'よーさん',person:'西村'}]);
});
test('wrong-team member cannot create an alias',async()=>{
 let called=false;let r=await learn({row,snapshot,field:'scorer',officialName:'山口',writeAlias:async()=>{called=true;return {ok:true}}});
 assert.equal(r.saved,false);assert.equal(called,false);
});
test('missing spoken name and unsupported field never write',async()=>{
 let called=false;const writeAlias=async()=>{called=true;return {ok:true}};
 assert.equal((await learn({row,snapshot,field:'assist',officialName:'西村',writeAlias})).saved,false);
 assert.equal((await learn({row,snapshot,field:'team',officialName:'西村',writeAlias})).saved,false);
 assert.equal(called,false);
});
