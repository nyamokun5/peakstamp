import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleIds,videoId,matchInfo,analysisResult,selected,forMember} from '../youtube-session.mjs';
test('4 provided URLs normalize and non-YouTube URLs are rejected',()=>{
 for(const id of sampleIds){assert.equal(videoId('https://youtu.be/'+id+'?si=example'),id);assert.equal(videoId('https://www.youtube.com/watch?v='+id),id)}
 assert.equal(videoId('https://evil.test/watch?v='+sampleIds[0]),null);
 assert.equal(matchInfo('20261108 3決 T2 vs T4 Drone').drone,true);
});
test('unbounded source count, confirmed players only, latest trimmed seconds',()=>{
 const sources=Array.from({length:15},(_,i)=>({id:'source'+i,title:'match',info:matchInfo('20261108 T1 vs T2'),candidates:[
 {enabled:true,time:10.3,manualEnd:17.6,title:'プレー',goal:{status:i<2?'confirmed':'draft',scorer:'山田',assistStatus:'named',assist:'佐藤'}},
 {enabled:false,time:20,manualEnd:22,title:'未判断'}]}));
 const all=selected(sources);assert.equal(all.length,15);assert.deepEqual(all.map(c=>c.video),sources.map(s=>s.id));assert.equal(all[0].start,10.3);assert.equal(all[0].end,17.6);assert.equal(forMember(all,'山田').length,2);assert.equal(forMember(all,'佐藤').length,2);
});
test('analysis rejects bad ranges and inaccessible responses',()=>{
 assert.throws(()=>analysisResult({status:'inaccessible',scenes:[]},{duration:60}));
 assert.throws(()=>analysisResult({status:'ok',scenes:[{start:2,end:65,peak:3}]},{duration:60}));
});
