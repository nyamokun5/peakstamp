import test from 'node:test';
import assert from 'node:assert/strict';
import {runGeminiFastPipeline} from '../gemini-fast-pipeline.mjs';
import {createGeminiFastWaveform} from '../gemini-fast-waveform.mjs';
const ranges=Array.from({length:5},(_,i)=>({startSeconds:i*65,durationSeconds:70}));
const wait=()=>new Promise(resolve=>setImmediate(resolve));
test('requests overlap, WAV decoding remains sequential, results preserve original order',async()=>{
  let active=0,peak=0,decoding=0,peakDecoding=0;
  const gates=[];const sent=[];
  const work=runGeminiFastPipeline({
    ranges:ranges.slice(0,3),
    makeSegment:async(r,i)=>{decoding++;peakDecoding=Math.max(peakDecoding,decoding);await wait();decoding--;return {bytes:10}},
    request:async(w,r,i)=>{active++;peak=Math.max(peak,active);sent.push(i);return await new Promise(resolve=>{
      gates[i]=()=>{active--;resolve({events:[{id:i}]})};
    });},
  });
  while(gates.length<2)await wait();
  assert.deepEqual(sent,[0,1]);assert.equal(peak,2);assert.equal(peakDecoding,1);
  gates[1]();while(gates.length<3)await wait();assert.deepEqual(sent,[0,1,2]);
  gates[2]();gates[0]();
  const result=await work;
  assert.deepEqual(result.responses.map(x=>x.events[0].id),[0,1,2]);
});
test('cached sections are retained and not sent again',async()=>{
  const saved=[];
  const result=await runGeminiFastPipeline({ranges:ranges.slice(0,3),
    cached:(r,i)=>i===1?{events:[{id:'cached'}]}:null,
    makeSegment:async()=>({bytes:5}),
    request:async(w,r,i)=>({events:[{id:i}]}),
    save:(range,answer,i)=>saved.push(i)
  });
  assert.equal(result.reused,1);assert.equal(result.submitted,2);
  assert.deepEqual(result.responses.map(x=>x.events[0].id),[0,'cached',2]);
  assert.deepEqual(saved.sort(),[0,2]);
});
test('an API error rejects without leaking an unhandled promise',async()=>{
 let cancelled=false;
 await assert.rejects(runGeminiFastPipeline({
  ranges:ranges.slice(0,3),makeSegment:async()=>({bytes:5}),
  request:async(w,r,i)=>{if(i===1)throw Error('429');return {events:[]};},
  onFailure:()=>{cancelled=true;}
 }),/429/);
 assert.equal(cancelled,true);
});
test('cancellation prevents result persistence',async()=>{
 let aborted=false,saved=0;
 await assert.rejects(runGeminiFastPipeline({
  ranges:ranges.slice(0,1),makeSegment:async()=>{aborted=true;return {}},
  request:async()=>({events:[]}),save:()=>saved++,isCancelled:()=>aborted
 }),/中止/);
 assert.equal(saved,0);
});
test('WAV waveform allows skip of second full source decode',async()=>{
 const bytes=new ArrayBuffer(44+16000*2);
 const view=new DataView(bytes);
 view.setUint32(24,16000,true);view.setUint16(22,1,true);
 view.setUint16(34,16,true);view.setUint32(40,32000,true);
 for(let i=0;i<16000;i++)view.setInt16(44+2*i,16384,true);
 const wave=createGeminiFastWaveform(1);
 await wave.add({blob:new Blob([bytes]),startSeconds:0});
 const result=wave.finish();
 assert.equal(result.bins.length,4);assert.ok(Math.abs(result.bins[0].rms-.5)<.0001);
 const incomplete=createGeminiFastWaveform(2);
 await incomplete.add({blob:new Blob([bytes]),startSeconds:0});
 assert.equal(incomplete.finish(),null);
});
