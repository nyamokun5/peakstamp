import test from 'node:test';
import assert from 'node:assert/strict';
import {onConfirmedGoalPlayerSelection as learn,resolveSpokenNameChoices} from '../sposched-goal-alias-learning.mjs';
const snapshot={matches:[{seq:1,leftTeam:'チーム1',rightTeam:'チーム2'}],players:['西村','山口'],playerTeam:new Map([['西村','チーム1'],['山口','チーム2']])};
const row={seq:1,team:'チーム1',goal:{scorer:'よーさん',assist:''}};
const resolveAlias=async()=>({candidates:[]});
test('human scorer choice invokes SS alias writer automatically',async()=>{
 let writes=[];let r=await learn({row,snapshot,field:'scorer',officialName:'西村',resolveAlias,writeAlias:async x=>{writes.push(x);return {ok:true}}});
 assert.equal(r.saved,true);assert.deepEqual(writes,[{alias:'よーさん',person:'西村'}]);
});
test('wrong-team member cannot create an alias',async()=>{
 let called=false;let r=await learn({row,snapshot,field:'scorer',officialName:'山口',resolveAlias,writeAlias:async()=>{called=true;return {ok:true}}});
 assert.equal(r.saved,false);assert.equal(called,false);
});
test('missing spoken name and unsupported field never write',async()=>{
 let called=false;const writeAlias=async()=>{called=true;return {ok:true}};
 assert.equal((await learn({row,snapshot,field:'assist',officialName:'西村',resolveAlias,writeAlias})).saved,false);
 assert.equal((await learn({row,snapshot,field:'team',officialName:'西村',writeAlias})).saved,false);
 assert.equal(called,false);
});

test('global SS aliases prevent cross-team collisions',async()=>{
 let called=false;
 const r=await learn({row,snapshot,field:'scorer',officialName:'西村',
  resolveAlias:async()=>({candidates:[{name:'山口'}]}),
  writeAlias:async()=>{called=true;return {ok:true}}});
 assert.equal(r.saved,false);assert.equal(called,false);
});
test('SS alias lookup must be connected before any write',async()=>{
 let called=false;
 const r=await learn({row,snapshot,field:'scorer',officialName:'西村',
  writeAlias:async()=>{called=true;return {ok:true}}});
 assert.equal(r.saved,false);assert.equal(called,false);
});

test('same nickname for two players remains ambiguous with team labels',()=>{
 const roster={matches:[{seq:1,leftTeam:'チーム1',rightTeam:'チーム2'}],
  players:['たいせいA','たいせいB'],playerTeam:new Map([['たいせいA','チーム1'],['たいせいB','チーム2']])};
 const aliases=[{alias:'たいせい',name:'たいせいA'},{alias:'たいせい',name:'たいせいB'}];
 const both=resolveSpokenNameChoices({spoken:'たいせい',snapshot:roster,seq:1,aliases});
 assert.equal(both.status,'ambiguous');assert.equal(both.candidates.length,2);
 assert.deepEqual(both.candidates.map(c=>c.team),['チーム1','チーム2']);
 const narrowed=resolveSpokenNameChoices({spoken:'たいせい',snapshot:roster,seq:1,team:'チーム1',aliases});
 assert.equal(narrowed.status,'unique');assert.equal(narrowed.candidates[0].name,'たいせいA');
});
