import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalVideoUrl,planVideoRegistration,registrationEvents} from './youtube-video-registration.mjs';
const eventId='test-event';
const slots=[
 {id:'a',eventId,kind:'ground',matchId:'m1',url:''},
 {id:'b',eventId,kind:'ground',matchId:'m2',url:'https://youtu.be/ey1_5PaMvBo'},
 {id:'c',eventId,kind:'goal_collection',url:'https://example.com/old'},
];
test('canonicalizes YouTube URLs without losing video ID',()=>{
 assert.equal(canonicalVideoUrl('https://youtu.be/-sEOeqqTyuw?t=3'),'https://www.youtube.com/watch?v=-sEOeqqTyuw');
 assert.equal(canonicalVideoUrl('javascript:alert(1)'),'');
});
test('matches exact event, match and slot type',()=>{
 const p=planVideoRegistration([{eventId,matchId:'m1',kind:'ground',url:'https://youtu.be/-sEOeqqTyuw'}],slots);
 assert.equal(p[0].slotId,'a');assert.equal(p[0].status,'ready');
});
test('identical URL is idempotent',()=>{
 const p=planVideoRegistration([{eventId,matchId:'m2',kind:'ground',url:'https://www.youtube.com/watch?v=ey1_5PaMvBo'}],slots);
 assert.equal(p[0].status,'already_registered');
});
test('existing different URL requires confirmation',()=>{
 const p=planVideoRegistration([{eventId,kind:'goal_collection',url:'https://example.com/new'}],slots);
 assert.equal(p[0].status,'conflict');assert.equal(p[0].existingUrl,'https://example.com/old');
});
test('does not match a different event or an ambiguous slot',()=>{
 assert.equal(planVideoRegistration([{eventId:'wrong',matchId:'m1',kind:'ground',url:'https://youtu.be/-sEOeqqTyuw'}],slots)[0].status,'missing_slot');
 assert.equal(planVideoRegistration([{eventId,matchId:'m1',kind:'ground',url:'https://youtu.be/-sEOeqqTyuw'}],[slots[0],{...slots[0],id:'d'}])[0].status,'ambiguous');
});
test('does not assign same slot to two requests',()=>{
 const req={eventId,matchId:'m1',kind:'ground',url:'https://youtu.be/-sEOeqqTyuw'};
 assert.deepEqual(planVideoRegistration([req,req],slots).map(x=>x.status),['ready','ambiguous']);
});


test('approved Nov 10 TEST event matches separate API date/name without selecting Nov 8',()=>{
 const events=[{event_id:'target',date:'2026-11-10',name:'日曜定期'},
  {event_id:'recording-day',date:'2026-11-08',name:'日曜定期'},
  {event_id:'other',date:'2026-11-10',name:'別イベント'}];
 assert.deepEqual(registrationEvents(events,'2026-11-10',true).map(e=>e.event_id),['target']);
 assert.equal(registrationEvents([{date:'2026-11-10',name:'日曜定期 （10 Nov）'}],'2026-11-10',true).length,1);
 assert.equal(registrationEvents([{date:'2025-11-10',name:'日曜定期 (10 Nov)'}],'2026-11-10',true).length,0);
 assert.equal(registrationEvents([events[0],{...events[0],event_id:'duplicate'}],'2026-11-10',true).length,2);
});
