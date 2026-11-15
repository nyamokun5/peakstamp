import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCurrentInlineEvent} from '../sposched-inline-event-guard.mjs';
test('accepts the same official snapshot instance',()=>{
 const snapshot={eventId:'event-a'};
 assert.equal(assertCurrentInlineEvent(snapshot,{snapshot}),true);
});
test('rejects a newly selected event while Worker inspection was pending',()=>{
 const snapshot={eventId:'event-a'};
 assert.throws(()=>assertCurrentInlineEvent(snapshot,{snapshot:{eventId:'event-b'}}),/変更/);
});
test('rejects refreshed roster even with same event ID',()=>{
 const snapshot={eventId:'event-a'};
 assert.throws(()=>assertCurrentInlineEvent(snapshot,{snapshot:{eventId:'event-a'}}),/変更/);
});
test('rejects disconnected SS context',()=>{
 assert.throws(()=>assertCurrentInlineEvent({eventId:'event-a'},null),/変更/);
});
