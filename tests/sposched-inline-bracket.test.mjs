import test from 'node:test';
import assert from 'node:assert/strict';
import {inferFirstRoundBracket} from '../sposched-inline-bracket.mjs';
const ss=()=>({matches:[{seq:1,leftTeam:'Team1',rightTeam:'Team2'},{seq:2,leftTeam:'Team3',rightTeam:'Team4'},{seq:3,status:'waiting'},{seq:4,status:'waiting'}],playerTeam:new Map([['A','Team1'],['B','Team2'],['C','Team3'],['D','Team4']])});
const goal=(seq,scorer,id)=>({seq,scorer,assistMode:'none',goal:{id,source:{name:'match'+seq+'.mov'}}});
test('infers third place and final even when later SS fixtures are waiting',()=>{
 const r=inferFirstRoundBracket(ss(),[goal(1,'A','1'),goal(2,'D','2')]);
 assert.equal(r.ready,true);
 assert.deepEqual(r.thirdPlace,['Team2','Team3']);
 assert.deepEqual(r.final,['Team1','Team4']);
});
test('draw needs human winner decision',()=>{
 const r=inferFirstRoundBracket(ss(),[goal(1,'A','1'),goal(1,'B','2'),goal(2,'C','3')]);
 assert.equal(r.ready,false);
 assert.equal(r.final,null);
 assert.equal(r.firstRound[0].requiresDecision,true);
});
test('duplicate source goal is rejected',()=>{
 assert.throws(()=>inferFirstRoundBracket(ss(),[goal(1,'A','x'),goal(1,'A','x')]),/重複/);
});
test('unknown roster player cannot determine score',()=>{
 assert.throws(()=>inferFirstRoundBracket(ss(),[goal(1,'X','1')]),/名簿/);
});
test('unrelated player cannot score in first round match',()=>{
 assert.throws(()=>inferFirstRoundBracket(ss(),[goal(1,'C','1')]),/所属/);
});
