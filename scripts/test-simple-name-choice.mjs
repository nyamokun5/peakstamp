import test from 'node:test';
import assert from 'node:assert/strict';
import {requiresSpokenNameChoice,scorerRosterForReview,assistRosterForReview,isWaitingKnockoutReview} from '../sposched-simple-results.mjs';

const eligible=[['たいせいA','たいせいA　チーム1'],['たいせいB','たいせいB　チーム2']];
const sameNickname=[{name:'たいせいA',score:100},{name:'たいせいB',score:99}];

test('multiple eligible nickname matches always require a human choice even at high confidence',()=>{
 // The scorer and assist UI both use this gate. AI confidence never bypasses it.
 assert.equal(requiresSpokenNameChoice(sameNickname,eligible),true);
 assert.equal(requiresSpokenNameChoice(sameNickname,eligible,false,false),true);
});
test('already reviewed explicit selection does not reopen the nickname chooser',()=>{
 assert.equal(requiresSpokenNameChoice(sameNickname,eligible,true,false),false);
 assert.equal(requiresSpokenNameChoice(sameNickname,eligible,false,true),false);
});
test('out-of-fixture candidate is never offered as an ambiguity',()=>{
 assert.equal(requiresSpokenNameChoice(sameNickname,[eligible[0]]),false);
 assert.equal(requiresSpokenNameChoice([{name:'たいせいA'},{name:'たいせいA'}],eligible),false);
 assert.equal(requiresSpokenNameChoice([{name:'unknown'}],eligible),false);
});

const currentFixture={
 matches:[{seq:1,leftTeam:'チーム1',rightTeam:'チーム2'},
  {seq:2,leftTeam:'チーム3',rightTeam:'チーム4'}],
 players:['たいせいA','たいせいB','別試合の選手'],
 playerTeam:new Map([['たいせいA','チーム1'],['たいせいB','チーム2'],['別試合の選手','チーム3']])
};
test('same nickname across both fixture sides remains selectable despite wrong AI team',()=>{
 const row={seq:1,team:'チーム1',scorerGuess:{confidence:'high'},
  scorerHints:[{name:'たいせいA'},{name:'たいせいB'}]};
 assert.deepEqual(scorerRosterForReview(currentFixture,row),['たいせいA','たいせいB']);
 assert.equal(requiresSpokenNameChoice(row.scorerHints,scorerRosterForReview(currentFixture,row)),true);
});
test('nonambiguous review stays restricted to selected team and excludes other fixtures',()=>{
 const row={seq:1,team:'チーム1',scorerHints:[{name:'たいせいA'}]};
 assert.deepEqual(scorerRosterForReview(currentFixture,row),['たいせいA']);
});
test('explicitly reviewed scorer no longer reopens opposite-team nickname choices',()=>{
 const row={seq:1,team:'チーム2',
  scorerHints:[{name:'たいせいA'},{name:'たいせいB'}],
  quickReviewedFields:{scorer:true}};
 assert.deepEqual(scorerRosterForReview(currentFixture,row),['たいせいB']);
});

const waitingTournament={
 rosterSource:'official-current-event-teams',
 matches:[
  {seq:1,status:'scheduled',leftTeam:'チーム1',rightTeam:'チーム2'},
  {seq:2,status:'scheduled',leftTeam:'チーム3',rightTeam:'チーム4'},
  {seq:3,status:'waiting',leftTeam:'',rightTeam:''},
  {seq:4,status:'waiting',leftTeam:'',rightTeam:''}
 ],
 roster:{チーム1:['山田'],チーム2:['西村'],チーム3:['鈴木'],チーム4:['橋本']},
 players:['山田','西村','鈴木','橋本','昨週のゲスト'],
 playerTeam:new Map([
  ['山田','チーム1'],['西村','チーム2'],['鈴木','チーム3'],
  ['橋本','チーム4'],['昨週のゲスト','チーム5']
 ])
};
test('waiting 3rd-place match can select from all current SS roster teams',()=>{
 const row={seq:3,team:'',goal:{scorer:'鈴木',assist:'橋本',assistStatus:'named'}};
 assert.equal(isWaitingKnockoutReview(waitingTournament,row),true);
 assert.deepEqual(scorerRosterForReview(waitingTournament,row),['山田','西村','鈴木','橋本']);
 assert.deepEqual(assistRosterForReview(waitingTournament,row),['山田','西村','鈴木','橋本']);
});
test('waiting final works with a provisional team without guessing future opponents',()=>{
 const row={seq:4,team:'チーム3'};
 assert.deepEqual(scorerRosterForReview(waitingTournament,row),['山田','西村','鈴木','橋本']);
 assert.deepEqual(assistRosterForReview(waitingTournament,row),['山田','西村','鈴木','橋本']);
});
test('normal semifinals never show players outside their assigned fixture',()=>{
 const row={seq:1,team:'チーム1'};
 assert.equal(isWaitingKnockoutReview(waitingTournament,row),false);
 assert.deepEqual(scorerRosterForReview(waitingTournament,row),['山田']);
 assert.deepEqual(assistRosterForReview(waitingTournament,row),['山田']);
});
test('no verified current roster means no provisional knockout player options',()=>{
 const row={seq:3,team:''};
 const stale={...waitingTournament,rosterSource:'event-embedded-fallback'};
 assert.equal(isWaitingKnockoutReview(stale,row),false);
 assert.deepEqual(scorerRosterForReview(stale,row),[]);
 assert.deepEqual(assistRosterForReview(stale,row),[]);
});
