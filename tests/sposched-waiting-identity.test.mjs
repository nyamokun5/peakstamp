import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisFixtureAgrees,selectedFixtureTeams,fixtureRosterNames,fixturePeople,verifiedAnalysisPerson} from '../sposched-analysis-identity.mjs';

const id=n=>String(n).padStart(8,'0')+'-0000-4000-8000-000000000001';
const snapshot=()=>({
 eventId:'event-1',rosterSource:'official-current-event-teams',
 matches:[{seq:3,matchId:'',status:'waiting',leftTeam:'',rightTeam:''}],
 players:['Alice','Bob','Carol'],playerTeam:new Map([['Alice','Team 1'],['Bob','Team 2'],['Carol','Team 3']]),
 memberIds:new Map([['Alice',id(1)],['Bob',id(2)],['Carol',id(3)]]),
 playerIds:new Map([['Alice',id(4)],['Bob',id(5)],['Carol',id(6)]])
});
test('waiting fixture cannot resolve an AI-only pairing',()=>{
 const s=snapshot(),goal={teamA:'Team 1',teamB:'Team 2'};
 assert.deepEqual(selectedFixtureTeams(goal,s,3),[]);
 assert.deepEqual(fixturePeople(s,3,goal),[]);
});
test('confirmed waiting pairing uses only its official roster even without match_id',()=>{
 const s=snapshot(),goal={teamA:'Team 1',teamB:'Team 2',matchupConfirmed:true};
 assert.deepEqual(selectedFixtureTeams(goal,s,3),['Team 1','Team 2']);
 assert.deepEqual(fixturePeople(s,3,goal),['Alice','Bob']);
 assert.deepEqual(fixtureRosterNames(s,3,goal),['Alice','Bob']);
});
test('partial or ambiguous pairing fails closed',()=>{
 const s=snapshot();
 assert.deepEqual(selectedFixtureTeams({teamA:'Team 1',matchupConfirmed:true},s,3),[]);
 assert.deepEqual(selectedFixtureTeams({teamA:'Team 1',teamB:'Team 1',matchupConfirmed:true},s,3),[]);
});
test('published SS matchup conflicting with video invalidates roster',()=>{
 const s=snapshot();s.matches[0].leftTeam='Team 1';s.matches[0].rightTeam='Team 3';
 const goal={teamA:'Team 1',teamB:'Team 2',matchupConfirmed:true};
 assert.deepEqual(fixturePeople(s,3,goal),[]);
});
test('export identity is checked against latest official fixture and ID',()=>{
 const s=snapshot(),goal={teamA:'Team 1',teamB:'Team 2',matchupConfirmed:true,
  scorer:'Alice',ssIdentity:{environment:'staging',eventId:'event-1',matchId:'',seq:3,
   scorer:{name:'Alice',memberId:id(1),playerId:id(4),team:'Team 1'}}};
 assert.equal(verifiedAnalysisPerson(goal,s,3,'scorer'),null);
 s.matches[0].matchId=id(7);
 assert.equal(verifiedAnalysisPerson(goal,s,3,'scorer'),null);
});

test('official roster is selectable even when the TEST API omits player identity IDs',()=>{
 const s=snapshot();s.memberIds=new Map();s.playerIds=new Map();
 const goal={teamA:'2',teamB:'3',matchupConfirmed:true};
 assert.deepEqual(fixtureRosterNames(s,3,goal),['Bob','Carol']);
 assert.deepEqual(fixturePeople(s,3,goal),[]);
});
test('editing both team names does not silently confirm an AI matchup',()=>{
 const s=snapshot();
 assert.deepEqual(selectedFixtureTeams({teamA:'Team 1',teamB:'Team 2',userEditedGoalFields:['teamA','teamB']},s,3),[]);
});

test('read-only dropdown uses confirmed video teams even when stale SS fixture has different sides',()=>{
 const s=snapshot();
 s.matches[0].leftTeam='Team 1';s.matches[0].rightTeam='Team 3';
 const goal={teamA:'2',teamB:'3',matchupConfirmed:true};
 assert.deepEqual(selectedFixtureTeams(goal,s,3),[]);
 assert.deepEqual(fixtureRosterNames(s,3,goal),['Bob','Carol']);
 assert.deepEqual(fixturePeople(s,3,goal),[]);
});

test('four-match waiting slot accepts confirmed roster identity without match UUID',()=>{
 const ss=snapshot();ss.matches=[
 {seq:1,status:'scheduled',matchId:id(10),leftTeam:'Team 1',rightTeam:'Team 2'},
 {seq:2,status:'scheduled',matchId:id(11),leftTeam:'Team 3',rightTeam:'Team 4'},
 ss.matches[0],
 {seq:4,status:'waiting',matchId:'',leftTeam:'',rightTeam:''}];
 const goal={teamA:'Team 1',teamB:'Team 2',matchupConfirmed:true,scorer:'Alice',
  ssIdentity:{environment:'staging',eventId:'event-1',matchId:'',seq:3,
   scorer:{name:'Alice',memberId:id(1),playerId:id(4),team:'Team 1'}}};
 assert.equal(verifiedAnalysisPerson(goal,ss,3,'scorer')?.name,'Alice');
 goal.ssIdentity.scorer.memberId=id(99);
 assert.equal(verifiedAnalysisPerson(goal,ss,3,'scorer'),null);
});

test('waiting placement has no official matchup to contradict a confirmed video pairing',()=>{
 const match={seq:3,status:'waiting',leftTeam:'',rightTeam:'',matchId:id(9)};
 assert.equal(analysisFixtureAgrees({teamA:'2',teamB:'4',matchupConfirmed:true},match),true);
 assert.equal(analysisFixtureAgrees({teamA:'2',teamB:'4'},match),false);
 assert.equal(analysisFixtureAgrees({teamA:'2',teamB:'4',matchupConfirmed:true},
  {...match,status:'scheduled',leftTeam:'チーム1',rightTeam:'チーム3'}),false);
});
