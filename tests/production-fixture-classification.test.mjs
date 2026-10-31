import test from 'node:test';
import assert from 'node:assert/strict';
import {describeOfficialFixtures,drawOptionForFixture} from '../sposched-fixture-layout.mjs';

const match=(seq,title='League game',status='scheduled')=>({
 seq,matchId:'match-'+seq,title,status,leftTeam:'Team A',rightTeam:'Team B'
});
test('official 2 and 3 game series retain separate match IDs',()=>{
 for(const count of [2,3]){
  const matches=Array.from({length:count},(_,i)=>match(i+1));
  const layout=describeOfficialFixtures({matches});
  assert.equal(layout.count,count);
  assert.equal(layout.automaticFourMatch,false);
  assert.deepEqual(layout.matches.map(x=>x.matchId),matches.map(x=>x.matchId));
  assert.ok(layout.matches.every(x=>drawOptionForFixture(layout,x)));
 }
});
test('four non-knockout matches are not mistaken for semifinals',()=>{
 const layout=describeOfficialFixtures({matches:[1,2,3,4].map(x=>match(x))});
 assert.equal(layout.count,4);
 assert.equal(layout.automaticFourMatch,false);
});
test('four actual semifinal/bronze/final matches retain knockout handling',()=>{
 const matches=[match(1,'準決勝'),match(2,'準決勝'),match(3,'3位決定戦','waiting'),match(4,'決勝','waiting')];
 const layout=describeOfficialFixtures({matches});
 assert.equal(layout.automaticFourMatch,true);
 assert.equal(drawOptionForFixture(layout,matches[0]),false);
});
