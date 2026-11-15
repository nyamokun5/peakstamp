import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAnalysisGoal,verifiedAnalysisPerson} from '../sposched-analysis-identity.mjs';

const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
const c='33333333-3333-4333-8333-333333333333';
const d='44444444-4444-4444-8444-444444444444';
const snapshot={
 eventId:'55555555-5555-4555-8555-555555555555',
 rosterSource:'official-current-event-teams',
 matches:[{seq:1,matchId:'66666666-6666-4666-8666-666666666666',leftTeam:'team1',rightTeam:'team2',status:'active'}],
 players:['Tanaka','Suzuki'],memberIds:new Map([['Tanaka',a],['Suzuki',b]]),
 playerIds:new Map([['Tanaka',c],['Suzuki',d]]),
 playerTeam:new Map([['Tanaka','team1'],['Suzuki','team2']])
};
const context={snapshot,aliases:[{alias:'たなかさん',member_id:a,name:'Tanaka'},{alias:'すずきさん',member_id:b,name:'Suzuki'}]};
const goal=()=>({id:'g1',scorer:'たなかさん',rawScorer:'たなかさん',assist:'',rawAssist:'',
 assistStatus:'none',matchSeq:'1',teamA:'1',teamB:'2',status:'draft',videoDecision:'kept'});
test('known alias becomes verified official scorer for selected fixture',()=>{
 const result=resolveAnalysisGoal(goal(),context);
 assert.equal(result.scorer,'Tanaka');
 assert.equal(result.ssIdentity.scorer.memberId,a);
 assert.equal(result.status,'confirmed');
 assert.equal(verifiedAnalysisPerson(result,snapshot,1,'scorer')?.name,'Tanaka');
});
test('no fixture means no verified SS identity even with a known alias',()=>{
 const result=resolveAnalysisGoal({...goal(),matchSeq:'2'},context);
 assert.equal(result.ssIdentity.scorer,null);
 assert.equal(verifiedAnalysisPerson(result,snapshot,2,'scorer'),null);
});
test('incorrect video matchup prevents SS identity confirmation',()=>{
 const result=resolveAnalysisGoal({...goal(),teamA:'1',teamB:'3'},context);
 assert.equal(result.ssIdentity.scorer,null);
 assert.equal(result.status,'draft');
});
test('manually corrected scorer is retained and verified only if eligible',()=>{
 const result=resolveAnalysisGoal({...goal(),scorer:'Suzuki',userEditedGoalFields:['scorer']},context);
 assert.equal(result.scorer,'Suzuki');
 assert.equal(result.ssIdentity.scorer.name,'Suzuki');
});
test('changing event invalidates previously verified identity',()=>{
 const result=resolveAnalysisGoal(goal(),context);
 const other={...snapshot,eventId:'77777777-7777-4777-8777-777777777777'};
 assert.equal(verifiedAnalysisPerson(result,other,1,'scorer'),null);
});
