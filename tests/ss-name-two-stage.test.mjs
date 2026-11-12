import test from 'node:test';
import assert from 'node:assert/strict';
import {matchEventPerson} from '../sposched-alias-auto-match.mjs';
import {resolveAnalysisGoal} from '../sposched-analysis-identity.mjs';
const idA='11111111-1111-4111-8111-111111111111';
const idB='22222222-2222-4222-8222-222222222222';
const snapshot={
 eventId:'33333333-3333-4333-8333-333333333333',
 rosterSource:'official-current-event-teams',
 players:['橋本','田中'],memberIds:new Map([['橋本',idA],['田中',idB]]),
 playerIds:new Map([['橋本',idA],['田中',idB]]),
 playerTeam:new Map([['橋本','Team1'],['田中','Team2']]),
 matches:[{seq:1,matchId:'44444444-4444-4444-8444-444444444444',leftTeam:'Team1',rightTeam:'Team2',status:'playing'}]
};
test('unique alias displays name without a fixture',()=>{
 const aliases=[{alias:'はっしー',member_id:idA}];
 assert.equal(matchEventPerson('はっしー',aliases,snapshot),'橋本');
 const item={rawScorer:'はっしー',scorer:'はっしー',assistStatus:'none',matchSeq:99,status:'draft',videoDecision:'kept'};
 const out=resolveAnalysisGoal(item,{snapshot,aliases});
 assert.equal(out.scorer,'橋本');
 assert.equal(out.ssIdentity.scorer,null);
 assert.equal(out.status,'draft');
});
test('shared alias never auto resolves',()=>{
 const aliases=[{alias:'はっしー',member_id:idA},{alias:'はっしー',member_id:idB}];
 assert.equal(matchEventPerson('はっしー',aliases,snapshot),null);
});
test('conflicting exact official name does not override alias owner',()=>{
 const aliases=[{alias:'橋本',member_id:idB}];
 assert.equal(matchEventPerson('橋本',aliases,snapshot),null);
});
test('verified fixture allows identity only for eligible team',()=>{
 const aliases=[{alias:'はっしー',member_id:idA}];
 const item={rawScorer:'はっしー',scorer:'はっしー',assistStatus:'none',matchSeq:1,status:'draft',videoDecision:'kept'};
 const out=resolveAnalysisGoal(item,{snapshot,aliases});
 assert.equal(out.scorer,'橋本');
 assert.equal(out.ssIdentity.scorer?.memberId,idA);
 assert.equal(out.status,'confirmed');
});
test('manual edits are never overwritten',()=>{
 const aliases=[{alias:'はっしー',member_id:idA}];
 const item={rawScorer:'はっしー',scorer:'田中',userEditedGoalFields:['scorer'],assistStatus:'none',matchSeq:1,status:'draft',videoDecision:'kept'};
 const out=resolveAnalysisGoal(item,{snapshot,aliases});
 assert.equal(out.scorer,'田中');
 assert.equal(out.ssIdentity.scorer?.memberId,idB);
});
