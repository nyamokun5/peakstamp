import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSpoSnapshot,prepareGoalRows} from '../sposched-review-core.mjs';
import {describeOfficialFixtures,drawOptionForFixture,fixtureSummaryLabel} from '../sposched-fixture-layout.mjs';
import {finishAction} from '../sposched-finish.mjs';
const E='11111111-1111-4111-8111-111111111111';
const matchId=n=>'22222222-2222-4222-8222-'+String(n).padStart(12,'0');
const fixture=(seq,left,right,title='',status='scheduled')=>({
 seq,match_id:matchId(seq),left_team:left,right_team:right,
 title:title||'#'+seq+' '+left+' vs '+right,status,left_score:0,right_score:0,goals:[]
});
const snap=matches=>normalizeSpoSnapshot({event_id:E,matches,roster:{
 Team1:['Taro'],Team2:['Jiro'],Team3:['Saburo'],Team4:['Shiro'],Team5:['Goro'],Team6:['Roku']
}});
const generic=s=>{const l=describeOfficialFixtures(s);assert.equal(l.automaticFourMatch,false);return l;};

test('one SS team vs external opponent: single official match, no invented fixtures',()=>{
 const s=snap([fixture(1,'Team1','External XI','SS vs External XI')]);
 const l=generic(s);assert.equal(l.count,1);
 assert.equal(l.teams,2);assert.match(fixtureSummaryLabel(l),/1試合/);
 assert.equal(drawOptionForFixture(l,s.matches[0]),true);
 const a=finishAction(s,s,1,'draw',{drawAllowed:true});
 assert.equal(a.match_id,matchId(1));assert.equal(a.winner,'draw');
});

test('two teams can repeat multiple matches; match ID and seq remain separate',()=>{
 const s=snap([1,2,3,4,5].map(i=>fixture(i,'Team1','Team2','#'+i+' 紅白戦')));
 const l=generic(s);assert.equal(l.count,5);assert.equal(l.teams,2);
 assert.equal(new Set(l.matches.map(x=>x.matchId)).size,5);
 assert.deepEqual(l.matches.map(x=>x.seq),[1,2,3,4,5]);
 const rows=prepareGoalRows({goals:[{id:'g1',matchSeq:1,teamA:'Team1',teamB:'Team2',
  scorer:'Taro',assistStatus:'none'},{id:'g5',matchSeq:5,teamA:'Team1',teamB:'Team2',
  scorer:'Taro',assistStatus:'none'}]},s);
 assert.deepEqual(rows.map(x=>x.seq),[1,5]);
 assert.equal(rows[1].matchGuess.fixtureMatchId,matchId(5));
});

test('three team round-robin permits draw in match #1 and #2 (not semifinals)',()=>{
 const s=snap([fixture(1,'Team1','Team2'),fixture(2,'Team2','Team3'),fixture(3,'Team3','Team1')]);
 const l=generic(s);assert.equal(l.count,3);
 assert.equal(l.teams,3);
 for(const m of s.matches)assert.equal(drawOptionForFixture(l,m),true);
 assert.throws(()=>finishAction(s,s,1,'draw'),/準決勝|勝ち上がり/);
 assert.equal(finishAction(s,s,1,'draw',{drawAllowed:true}).winner,'draw');
 assert.equal(finishAction(s,s,2,'draw',{drawAllowed:true}).winner,'draw');
});

test('standard four-fixture knockout keeps the existing durable batch and semi draw block',()=>{
 const s=snap([
  fixture(1,'Team1','Team2','#1 準決勝'),
  fixture(2,'Team3','Team4','#2 準決勝'),
  fixture(3,'','','#3 ３位決定戦','waiting'),
  fixture(4,'','','#4 決勝','waiting')
 ]);
 const l=describeOfficialFixtures(s);
 assert.equal(l.automaticFourMatch,true);
 assert.equal(l.waiting,2);
 assert.equal(drawOptionForFixture(l,s.matches[0]),false);
 assert.throws(()=>finishAction(s,s,1,'draw',{drawAllowed:false}),/勝ち上がり/);
});

test('four fixtures without SS knockout evidence do NOT enter four-fixture worker',()=>{
 const s=snap([fixture(1,'Team1','Team2'),fixture(2,'Team3','Team4'),
  fixture(3,'Team1','Team3'),fixture(4,'Team2','Team4')]);
 const l=generic(s);assert.equal(l.count,4);
 assert.equal(drawOptionForFixture(l,s.matches[0]),true);
});

test('six teams on concurrent pitches use distinct official seq despite shared round headings',()=>{
 const s=snap([
  fixture(1,'Team1','Team2','#1 Pitch1'),
  fixture(2,'Team3','Team4','#1 Pitch2'),
  fixture(3,'Team5','Team6','#2 Pitch1'),
  fixture(4,'Team1','Team3','#2 Pitch2'),
  fixture(5,'Team2','Team5','#3 Pitch1'),
  fixture(6,'Team4','Team6','#3 Pitch2'),
  fixture(7,'','','#4 3位決定戦','waiting'),
  fixture(8,'','','#4 決勝','waiting')
 ]);
 const l=generic(s);
 assert.equal(l.count,8);
 assert.equal(l.teams,6);
 assert.equal(l.waiting,2);
 assert.deepEqual(l.matches.map(m=>m.seq),[1,2,3,4,5,6,7,8]);
 assert.equal(drawOptionForFixture(l,s.matches[0]),true);
 assert.equal(drawOptionForFixture(l,s.matches[6]),false);
 const rows=prepareGoalRows({goals:[{id:'two',matchSeq:2,teamA:'Team3',teamB:'Team4',scorer:'Saburo',assistStatus:'none'}]},s);
 assert.equal(rows[0].seq,2);
 assert.equal(rows[0].matchGuess.fixtureMatchId,matchId(2));
});

test('unresolved official fixture never permits a draw or registration without official teams',()=>{
 const s=snap([fixture(1,'Team1','Team2'),fixture(2,'','','#2 未定','waiting')]);
 const l=generic(s);assert.equal(l.waiting,1);
 assert.equal(drawOptionForFixture(l,s.matches[1]),false);
 assert.throws(()=>finishAction(s,s,2,'draw',{drawAllowed:false}),/確定待ち/);
});

test('zero registered SS matches stays empty, no fabricated game count',()=>{
 const l=generic(snap([]));assert.equal(l.count,0);assert.match(fixtureSummaryLabel(l),/ありません/);
});
