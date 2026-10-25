import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {wavSegmentRanges,MAX_GEMINI_DURATION_SECONDS,mergeWavSegmentEvents}
 from '../gemini-wav-chunks.mjs';
import {createGeminiFastWaveform} from '../gemini-fast-waveform.mjs';
import {blankReviewTimeline} from '../gemini-waveform-recovery.mjs';

test('15-minute match is divided into bounded 70-second WAVs with five-second overlap',()=>{
 const ranges=wavSegmentRanges(15*60);
 assert.equal(ranges.length,14);
 assert.deepEqual(ranges[0],{startSeconds:0,endSeconds:70,durationSeconds:70});
 assert.equal(ranges.at(-1).endSeconds,900);
 assert.ok(ranges.every(x=>x.durationSeconds<=70));
 for(let i=1;i<ranges.length;i++)
  assert.equal(ranges[i-1].endSeconds-ranges[i].startSeconds,5);
});
test('three 15-minute matches can be independently divided into 42 bounded Gemini requests',()=>{
 const perVideo=[900,900,900].map(wavSegmentRanges);
 assert.deepEqual(perVideo.map(x=>x.length),[14,14,14]);
 assert.equal(perVideo.flat().length,42);
});
test('safe limit is 30 minutes PER VIDEO; over limit still fails early',()=>{
 assert.equal(MAX_GEMINI_DURATION_SECONDS,1800);
 assert.doesNotThrow(()=>wavSegmentRanges(1800));
 assert.throws(()=>wavSegmentRanges(1800.01),/30分/);
 assert.throws(()=>wavSegmentRanges(0),/30分/);
});
test('15-minute duration supports local WAV preview and restored review timeline',()=>{
 const waveform=createGeminiFastWaveform(900);
 assert.equal(waveform.finish(),null,'no fake real waveform unless every bin is populated');
 const placeholder=blankReviewTimeline(900);
 assert.equal(placeholder.duration,900);
 assert.equal(placeholder.bins.length,3600);
 assert.equal(placeholder.bins[3599].time,899.75);
 assert.equal(placeholder.waveformUnavailable,true);
 assert.throws(()=>blankReviewTimeline(1900),/長さが不明/);
});
test('15-minute segmented Gemini events preserve timestamps after the 10-minute mark',()=>{
 const ranges=wavSegmentRanges(900);
 const answers=ranges.map(range=>({startSeconds:range.startSeconds,events:[]}));
 const last=ranges.at(-1);
 answers[answers.length-1].events=[{
  reaction_time_seconds:20,
  type:'goal',confidence:'high',quote:'ゴール！'
 }];
 const merged=mergeWavSegmentEvents(answers,900);
 assert.equal(merged.duration_seconds,900);
 assert.equal(merged.meta.segments,14);
 assert.equal(merged.events.length,1);
 const first=merged.events[0];
 assert.ok(first.reaction_time_seconds>600,'must preserve event after 10 minutes');
 assert.ok(first.reaction_time_seconds<900);
});
test('main app activates current modules and avoids stale Safari caches',()=>{
 const main=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const app=readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
 const primary=readFileSync(new URL('../gemini-primary.mjs',import.meta.url),'utf8');
 assert.match(main,/app\.mjs\?v=goalnative1/);
 assert.match(app,/gemini-primary\.mjs\?v=unifiedga2/);
 assert.match(primary,/gemini-wav-stream\.mjs\?v=unifiedga2/);
 assert.match(primary,/gemini-fast-waveform\.mjs\?v=long30/);
 assert.match(primary,/gemini-waveform-recovery\.mjs\?v=long30/);
});
