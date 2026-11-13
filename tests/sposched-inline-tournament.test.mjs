import test from 'node:test';
import assert from 'node:assert/strict';
import {projectFourMatchTournament} from '../sposched-inline-tournament.mjs';
const ss=()=>({matches:[{seq:1,leftTeam:'Team1',rightTeam:'Team2'},{seq:2,leftTeam:'Team3',rightTeam:'Team4'},{seq:3,status:'waiting'},{seq:4,status:'waiting'}],playerTeam:new Map([['A','Team1'],['B','Team2'],['C','Team3'],['D','Team4']])});
const g=(seq,scorer,id)=>({seq,scorer,assistMode:'none',goal:{id,source:{name:'match'+seq+'.mov'}}});
test('projects final and third place scores from first round outcomes',()=>{
 const result=projectFourMatchTournament(ss(),[g(1,'A','1'),g(2,'D','2'),g(3,'B','3'),g(4,'A','4')]);
 assert.equal(result.complete,true);
 assert.deepEqual(result.thirdPlace,['Team2','Team3']);
 assert.deepEqual(result.final,['Team1','Team4']);
 assert.deepEqual(result.knockout.map(m=>[m.left,m.right,m.winner]),[[1,0,'Team2'],[1,0,'Team1']]);
});
test('first round draw blocks downstream registration projection',()=>{
 const result=projectFourMatchTournament(ss(),[g(1,'A','1'),g(1,'B','2')]);
 assert.equal(result.ready,false);assert.equal(result.knockout,null);
});
test('unexpected scorer in final is rejected',()=>{
 assert.throws(()=>projectFourMatchTournament(ss(),[g(1,'A','1'),g(2,'D','2'),g(4,'C','3')]),/対戦カード/);
});
test('tied final requires human decision',()=>{
 const result=projectFourMatchTournament(ss(),[g(1,'A','1'),g(2,'D','2'),g(4,'A','3'),g(4,'D','4'),g(3,'B','5')]);
 assert.equal(result.complete,false);assert.equal(result.knockout[1].requiresDecision,true);
});
