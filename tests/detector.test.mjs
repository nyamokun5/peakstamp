import test from 'node:test';
import assert from 'node:assert/strict';
import { detectHighlights, formatTime, makeComment } from '../detector.mjs';

function envelope(duration, peaks = []) {
  return Array.from({length: duration * 4}, (_, i) => {
    const time = i * .25;
    return {time, rms: peaks.some(p => time >= p && time < p + 3) ? .42 : .012};
  });
}
test('empty audio yields no highlights', () => assert.deepEqual(detectHighlights([]), []));
test('steady ambient volume yields none', () => assert.equal(detectHighlights(envelope(60)).length, 0));
test('distant cheers become candidates', () => {
  const found = detectHighlights(envelope(120,[24,85]), {sensitivity:'sensitive'});
  assert.ok(found.length >= 2, JSON.stringify(found));
  assert.ok(found.some(c => c.time >= 15 && c.time <= 26));
  assert.ok(found.some(c => c.time >= 76 && c.time <= 87));
});
test('adjacent peaks merge and remain sorted', () => {
  const found = detectHighlights(envelope(140,[20,26,90]), {sensitivity:'sensitive'});
  assert.ok(found.length <= 2);
  assert.deepEqual(found.map(x => x.time), [...found.map(x => x.time)].sort((a,b) => a-b));
});
test('limit and lead offset work', () => {
  const bins = envelope(200,[10,50,90,130,170]);
  const a = detectHighlights(bins,{sensitivity:'sensitive',maxResults:3,leadSeconds:0});
  const b = detectHighlights(bins,{sensitivity:'sensitive',maxResults:3,leadSeconds:10});
  assert.equal(a.length,3);
  assert.equal(b.length,3);
  assert.deepEqual(a.map(x => x.time - 10), b.map(x => x.time));
});
test('time and comment format', () => {
  assert.equal(formatTime(3723.7),'1:02:03');
  assert.equal(formatTime(79.9),'01:19');
  const comment=makeComment([{time:12,title:'⚽ Goal',enabled:true},{time:43,title:'skip',enabled:false}]);
  assert.match(comment,/00:12 ⚽ Goal/);
  assert.doesNotMatch(comment,/00:43/);
});

test('fresh offline audio candidates default to exactly 4 seconds before each detected peak',()=>{
 const clips=detectHighlights(envelope(90,[20,60]),{sensitivity:'sensitive'});
 assert.ok(clips.length>=2);
 for(const clip of clips)assert.ok(Math.abs(clip.time-Math.max(0,clip.peakSeconds-4))<1e-8);
});
