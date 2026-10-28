import test from 'node:test';
import assert from 'node:assert/strict';
import {
 KNOWN_TEST_ACTIVITY_URL,workerTimeKey,storeWorkerTiming,readWorkerTiming,
 elapsedSeconds,completionSeconds,expectedSSAppLink,validatedSSAppLink,
 savedSSAppLink,resultLinkKey
} from '../sposched-completion.mjs';
const E='11111111-1111-4111-8111-111111111111';
const REQUEST='21111111-1111-4111-8111-111111111111';
const storage=()=>({data:new Map(),getItem(k){return this.data.get(k)||null},
 setItem(k,v){this.data.set(k,String(v))}});
test('full elapsed time covers pauses, never resets at decision resume',()=>{
 const click=1793100000000;
 const decisionPausedAt=click+10300;
 const finishedAt=click+47200;
 assert.equal(elapsedSeconds(click,decisionPausedAt),10.3);
 assert.equal(elapsedSeconds(click,finishedAt),47.2);
 assert.equal(elapsedSeconds(0,finishedAt),null);
 assert.equal(elapsedSeconds(finishedAt,click),null);
});
test('durable Worker timing uses completed_at rather than late reconnect observation',()=>{
 const store=storage(),click=1793100000000;
 storeWorkerTiming(store,E,REQUEST,click);
 assert.equal(readWorkerTiming(store,E,REQUEST),click);
 assert.equal(readWorkerTiming(store,E,'31111111-1111-4111-8111-111111111111'),null);
 assert.equal(completionSeconds(click,click+47200,click+120000),47.2);
 assert.equal(completionSeconds(click,undefined,click+49100),49.1);
 assert.equal(completionSeconds(click,click-1,click+49200),49.2);
 assert.equal(completionSeconds(click,click+1000000,click+49200),49.2);
 assert.match(workerTimeKey(E),/worker-elapsed-v1/);
});
test('supplied October 25 TEST URL is exact and never guessed for later events or production',()=>{
 assert.equal(expectedSSAppLink('staging','2026-10-25'),KNOWN_TEST_ACTIVITY_URL);
 assert.equal(expectedSSAppLink('staging','2026-11-01'),'');
 assert.equal(expectedSSAppLink('production','2026-10-25'),'');
 assert.equal(validatedSSAppLink(KNOWN_TEST_ACTIVITY_URL),KNOWN_TEST_ACTIVITY_URL);
 const store=storage();
 assert.equal(savedSSAppLink(store,'staging',E,'2026-10-25'),KNOWN_TEST_ACTIVITY_URL);
 assert.equal(savedSSAppLink(store,'staging',E,'2026-11-01'),'');
 store.setItem(resultLinkKey('staging',E),KNOWN_TEST_ACTIVITY_URL);
 assert.equal(savedSSAppLink(store,'staging',E,'2026-11-01'),KNOWN_TEST_ACTIVITY_URL);
 assert.equal(savedSSAppLink(store,'staging','another-event','2026-11-01'),'');
});
test('TEST result URL permits only HTTPS event activity page from supplied host',()=>{
 for(const link of [
  'javascript:alert(1)',
  'https://testsundayfront.web.app.attacker.com/app/shoot/activity/?event=x',
  'http://testsundayfront.web.app/app/shoot/activity/?event=x',
  'https://testsundayfront.web.app/app/shoot/activity/',
  'https://testsundayfront.web.app/other/?event=x',
  'https://evil.example/app/shoot/activity/?event=x',
  'https://testsundayfront.web.app/app/shoot/activity/?event=x#fragment'
 ])assert.throws(()=>validatedSSAppLink(link),/TEST版SS|URL/);
 assert.throws(()=>validatedSSAppLink(KNOWN_TEST_ACTIVITY_URL,'production'),/本番SS/);
});
