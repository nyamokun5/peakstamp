import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeminiEta,formatGeminiEta} from '../gemini-eta.mjs';

test('do not claim an ETA before enough completed chunks',()=>{
 let t=0;
 const videos=[{id:1},{id:2}];
 const eta=createGeminiEta({now:()=>t});
 eta.start(videos);
 eta.begin(videos[0]);
 assert.equal(eta.estimate().currentSeconds,null);
 assert.equal(eta.estimate().totalSeconds,null);
 t=3000;eta.chunks(1,6);
 assert.equal(eta.estimate().currentSeconds,null);
 t=22000;eta.chunks(2,6);
 assert.equal(eta.estimate().currentSeconds,54);
 assert.equal(eta.estimate().totalSeconds,130);
 assert.equal(formatGeminiEta(54),'1分未満');
 assert.equal(formatGeminiEta(130),'3分');
});
test('observed file duration predicts remaining files; completed are excluded',()=>{
 let t=0;
 const videos=[{id:'a'},{id:'b'},{id:'c'}];
 const eta=createGeminiEta({now:()=>t});
 eta.start(videos);
 eta.begin(videos[0]);t=120000;eta.end(videos[0]);
 assert.equal(eta.estimate().totalSeconds,240);
 eta.begin(videos[1]);t+=30000;
 assert.equal(eta.estimate().currentSeconds,90);
 assert.equal(eta.estimate().totalSeconds,210);
 eta.end(videos[1]);eta.begin(videos[2]);
 assert.equal(eta.estimate().remainingFiles,1);
});
test('cached answer speed is never used as uncached API throughput',()=>{
 let t=0;const cached={id:'cache'},network={id:'api'};
 const eta=createGeminiEta({now:()=>t});
 eta.start([cached,network],{cached:src=>src===cached});
 eta.begin(cached);t+=1000;eta.end(cached);
 assert.equal(eta.estimate().totalSeconds,null);
 eta.begin(network);t+=22000;eta.chunks(2,6);
 assert.ok(eta.estimate().currentSeconds>0);
});
test('skipped videos do not contaminate timing, finishing stage is not a false deadline',()=>{
 let t=0;const videos=[{id:1},{id:2}];
 const eta=createGeminiEta({now:()=>t});
 eta.start(videos);
 eta.begin(videos[0]);eta.end(videos[0],{skipped:true});
 assert.equal(eta.estimate().totalSeconds,null);
 eta.begin(videos[1]);t=30000;eta.chunks(2,5);
 assert.ok(eta.estimate().currentSeconds>0);
 eta.finishing();
 assert.equal(eta.estimate().currentSeconds,null);
 eta.end(videos[1]);assert.equal(eta.estimate().totalSeconds,0);
 eta.clear();assert.equal(eta.estimate().remainingFiles,0);
});
test('format distinguishes seconds, minutes and hours without excessive precision',()=>{
 assert.equal(formatGeminiEta(0),'1分未満');
 assert.equal(formatGeminiEta(61),'2分');
 assert.equal(formatGeminiEta(3601),'1時間1分');
 assert.equal(formatGeminiEta(-1),null);
 assert.equal(formatGeminiEta(NaN),null);
});
