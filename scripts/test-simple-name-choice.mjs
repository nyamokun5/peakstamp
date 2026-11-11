import test from 'node:test';
import assert from 'node:assert/strict';
import {requiresSpokenNameChoice,scorerRosterForReview} from '../sposched-simple-results.mjs';

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
