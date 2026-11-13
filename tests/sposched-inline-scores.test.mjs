import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileInlineScores} from '../sposched-inline-scores.mjs';
const snapshot=()=>({matches:[1,2,3,4].map(seq=>({seq,leftTeam:'Team1',rightTeam:'Team2'})),playerTeam:new Map([['A','Team1'],['B','Team2']])});
const goal=(seq,scorer,id)=>({seq,scorer,assistMode:'none',goal:{id}});
test('counts only official roster-linked scorers across four fixtures',()=>{
 const result=reconcileInlineScores(snapshot(),[goal(1,'A','g1'),goal(1,'B','g2'),goal(4,'B','g3')]);
 assert.deepEqual(result.map(x=>[x.left,x.right]),[[1,1],[0,0],[0,0],[0,1]]);
});
test('rejects duplicate video goal IDs',()=>{
 assert.throws(()=>reconcileInlineScores(snapshot(),[goal(1,'A','same'),goal(2,'B','same')]),/重複/);
});
test('rejects scorers outside official roster',()=>{
 assert.throws(()=>reconcileInlineScores(snapshot(),[goal(1,'Unknown','g1')]),/名簿/);
});
test('rejects unknown opponent and missing fixtures',()=>{
 const s=snapshot();s.matches[0].rightTeam='';
 assert.throws(()=>reconcileInlineScores(s,[goal(1,'A','g1')]),/未確定/);
 s.matches.pop();
 assert.throws(()=>reconcileInlineScores(s,[]),/4試合/);
});
test('rejects ambiguous or missing assists',()=>{
 assert.throws(()=>reconcileInlineScores(snapshot(),[{...goal(1,'A','g1'),assistMode:'named',assist:'Unknown'}]),/アシスト/);
});
