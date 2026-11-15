import test from 'node:test';import assert from 'node:assert/strict';
import {batchAliasAttemptKey as key} from './sposched-batch-alias-ledger.mjs';
const memberId='00000001-1111-4111-8111-111111111111';
const base={eventId:'event-1',requestId:'job-1',memberId};
test('kana variants share one attempt record',()=>{
 assert.equal(key({...base,alias:'タロウ'}),key({...base,alias:'たろう'}));
 assert.equal(key({...base,alias:'ﾀﾛｳ'}),key({...base,alias:'タロウ'}));
});
test('distinct jobs and members do not share attempts',()=>{
 assert.notEqual(key({...base,alias:'タロウ'}),key({...base,alias:'タロウ',requestId:'job-2'}));
 assert.notEqual(key({...base,alias:'タロウ'}),key({...base,alias:'タロウ',memberId:'00000002-1111-4111-8111-111111111111'}));
});
test('invalid event or official member identity cannot generate key',()=>{
 assert.equal(key({...base,eventId:'' ,alias:'タロウ'}),'');
 assert.equal(key({...base,memberId:'not-uuid',alias:'タロウ'}),'');
});
