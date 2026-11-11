import test from 'node:test';
import assert from 'node:assert/strict';
import {requiresSpokenNameChoice} from '../sposched-simple-results.mjs';

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
