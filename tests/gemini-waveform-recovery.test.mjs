import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {usableWaveform,isUnavailableFileError,blankReviewTimeline,
 restoreGeminiReviewWaveform} from '../gemini-waveform-recovery.mjs';

test('Safari "The object can not be found here." is recognized as a lost file reference',()=>{
 assert.equal(isUnavailableFileError(new Error('The object can not be found here.')),true);
 assert.equal(isUnavailableFileError({name:'NotFoundError',message:'Not found'}),true);
 assert.equal(isUnavailableFileError({name:'NotReadableError'}),true);
 assert.equal(isUnavailableFileError(new Error('Gemini HTTP 403')),false);
 assert.equal(isUnavailableFileError(new Error('The API request failed')),false);
});
test('after Gemini segment completion, a lost iCloud File creates a clearly marked flat review timeline',async()=>{
 let attempted=0;
 const result=await restoreGeminiReviewWaveform({
  durationSeconds:107.5,
  decodeAudio:async()=>{attempted++;throw Error('The object can not be found here.')}
 });
 assert.equal(attempted,1);
 assert.equal(result.recovered,true);
 assert.equal(result.decoded.waveformUnavailable,true);
 assert.equal(result.decoded.duration,107.5);
 assert.equal(result.decoded.bins.length,430);
 assert.equal(result.decoded.bins.every(x=>x.rms===0),true,'do not invent audio energy');
 assert.equal(usableWaveform(result.decoded),true,'normal review UI still accepts the timeline');
});
test('saved waveform is restored before reading old MOV again and never re-charges Gemini',async()=>{
 const cached={duration:90,bins:[{time:0,rms:0.2},{time:.25,rms:.03}]};
 let attempted=false;
 const result=await restoreGeminiReviewWaveform({
  durationSeconds:90,stored:cached,
  decodeAudio:async()=>{attempted=true;throw Error('The object can not be found here.')}
 });
 assert.equal(attempted,false);
 assert.equal(result.recovered,false);
 assert.strictEqual(result.decoded,cached);
});
test('streamed audio bins are used in preference to cached or repeated full MOV decoding',async()=>{
 const streamed={duration:5,bins:[{time:0,rms:.4}]};
 const cached={duration:5,bins:[{time:0,rms:.1}]};
 const result=await restoreGeminiReviewWaveform({durationSeconds:5,streamed,stored:cached,
  decodeAudio:async()=>{throw Error('should not be called')}});
 assert.strictEqual(result.decoded,streamed);
});
test('genuine decoder failures are NOT disguised as successful AI review',async()=>{
 await assert.rejects(()=>restoreGeminiReviewWaveform({
  durationSeconds:300,decodeAudio:async()=>{throw Error('Audio codec not supported')}
 }),/Audio codec not supported/);
 await assert.rejects(()=>restoreGeminiReviewWaveform({
  durationSeconds:300,decodeAudio:async()=>{throw Error('Gemini request 401')}
 }),/Gemini request 401/);
});
test('do not rescue an invalid or unknown-duration video',()=>{
 assert.throws(()=>blankReviewTimeline(NaN),/長さが不明/);
 assert.throws(()=>blankReviewTimeline(1900),/長さが不明/);
});
test('gemini primary saves AI response before waveform recovery and never re-requests it for 90 percent',()=>{
 const code=readFileSync(new URL('../gemini-primary.mjs',import.meta.url),'utf8');
 assert.match(code,/saveResult\(source,answer\);/);
 assert.match(code,/restoreGeminiReviewWaveform\(/);
 assert.match(code,/stored:cachedWaveform\(source\)/);
 assert.match(code,/saveWaveform\(source,decoded\)/);
 assert.match(code,/waveformUnavailable/);
 assert.ok(code.indexOf('saveResult(source,answer);')<code.indexOf('restoreGeminiReviewWaveform({'));
});
