import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeAutoFixture,assertFourMatchBracket} from '../sposched-auto-tournament.mjs';
const match=(seq,leftScore=0,rightScore=0,status='scheduled')=>({
 seq,matchId:'match-'+seq,status,leftTeam:'チーム'+seq,rightTeam:'相手'+seq,
 leftScore,rightScore
});
const snap=()=>({eventId:'test-event',matches:[1,2,3,4].map(n=>match(n))});
test('4 knockout numbered slots are mandatory; order fixed',()=>{
 assert.deepEqual(assertFourMatchBracket(snap()),[1,2,3,4]);
 assert.throws(()=>assertFourMatchBracket({eventId:'test-event',matches:[match(1)]}),/4試合/);
});
test('fixture combines official registered score with ready video goals; never guesses same-score winner',()=>{
 const s=snap();s.matches[0]=match(1,1,0);
 const row={seq:1,team:'相手1'};
 const d=[{index:0,state:'ready'}];
 const pending=analyzeAutoFixture(s,[row],d,1);
 assert.equal(pending.state,'winner-needed');assert.equal(pending.left,1);assert.equal(pending.right,1);
 const approved=analyzeAutoFixture(s,[row],d,1,'right');
 assert.deepEqual({status:approved.state,winner:approved.winner,left:approved.left,right:approved.right,ready:approved.ready.length},
  {status:'ready',winner:'right',left:1,right:1,ready:1});
});
test('unknown goal, duplicate, unsupported or wrong team blocks a match before any writes',()=>{
 const s=snap();
 for(const state of ['attention','duplicate','waiting','manual','patch']){
  const r=analyzeAutoFixture(s,[{seq:1,team:'チーム1'}],[{index:0,state,reason:'要修正'}],1);
  assert.equal(r.state,'blocked',state);
 }
 assert.equal(analyzeAutoFixture(s,[{seq:1,team:'別チーム'}],[{index:0,state:'ready'}],1).state,'blocked');
 assert.equal(analyzeAutoFixture(s,[{seq:1,team:'チーム1'}],[{index:0,state:'skipped'}],1,'left').state,'ready');
});
test('semifinal completion reveals new final only after an actual upstream refresh',()=>{
 const s=snap();s.matches[2].status='waiting';
 assert.equal(analyzeAutoFixture(s,[],[],3).state,'waiting');
 s.matches[2].status='scheduled';s.matches[2].leftScore=1;
 assert.equal(analyzeAutoFixture(s,[],[],3).state,'ready');
 s.matches[2].status='finished';
 assert.equal(analyzeAutoFixture(s,[],[],3).state,'finished');
});
