import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeWavSegment,openVideoWavSegmenter} from '../gemini-wav-stream.mjs';
import {wavSegmentRanges} from '../gemini-wav-chunks.mjs';

function sample({rate=48000,channels=2,start=0,seconds=1,value=.5}={}){
 const n=Math.round(rate*seconds),data=new Float32Array(n*channels);
 data.fill(value);let closed=false;
 return {sampleRate:rate,numberOfChannels:channels,numberOfFrames:n,timestamp:start,
  allocationSize:()=>data.byteLength,copyTo:(dest)=>dest.set(data),close:()=>{closed=true;},get closed(){return closed;}};
}
async function* sampleIterator(s){yield s;}
test('stereo 48 kHz decoded sample produces valid mono WAV 16 kHz and closes sample',async()=>{
 const s=sample();const audio=await encodeWavSegment(sampleIterator(s),{startSeconds:0,endSeconds:1,durationSeconds:1});
 assert.equal(audio.bytes,32044);assert.equal(audio.blob.type,'audio/wav');assert.equal(s.closed,true);
 const v=new DataView(await audio.blob.arrayBuffer());
 assert.equal(v.getUint32(24,true),16000);assert.equal(v.getUint16(22,true),1);assert.equal(v.getInt16(44,true),16384);
});
test('70-second segment stays below API ceiling; 5-second overlaps are preserved',async()=>{
 const s=sample({seconds:70});const audio=await encodeWavSegment(sampleIterator(s),{startSeconds:0,endSeconds:70,durationSeconds:70});
 assert.equal(audio.bytes,2240044);assert.ok(audio.bytes<2900000);
 const ranges=wavSegmentRanges(130);
 assert.equal(ranges.length,2);assert.equal(ranges[0].endSeconds-ranges[1].startSeconds,5);
});
test('sample times are mapped relative to segment start',async()=>{
 const a=sample({start:64,seconds:2,value:.2}),b=sample({start:66,seconds:1,value:.6});
 async function* iter(){yield a;yield b;}
 const wav=await encodeWavSegment(iter(),{startSeconds:65,endSeconds:67,durationSeconds:2});
 const v=new DataView(await wav.blob.arrayBuffer());
 assert.ok(v.getInt16(44,true)>0);assert.ok(v.getInt16(44,true)<10000);
 assert.ok(v.getInt16(44+16000*2,true)>15000);
});
test('8 kHz input is interpolated without alternating silence',async()=>{
 const s=sample({rate:8000,channels:1});const wav=await encodeWavSegment(sampleIterator(s),{startSeconds:0,endSeconds:1});
 const v=new DataView(await wav.blob.arrayBuffer());
 assert.equal(v.getInt16(44,true),16384);assert.equal(v.getInt16(46,true),16384);
});
test('cancellation rejects and closes decoded sample',async()=>{
 const s=sample();await assert.rejects(encodeWavSegment(sampleIterator(s),{startSeconds:0,endSeconds:1},{isCancelled:()=>true}),/中止/);
 assert.equal(s.closed,true);
});
test('original video is decoded lazily by region and disposed',async()=>{
 let disposed=false,reads=0;const s=sample();
 class Input{async getPrimaryAudioTrack(){return {canDecode:async()=>true};}async computeDuration(){return 1;}dispose(){disposed=true;}}
 class BlobSource{}
 class AudioSampleSink{samples(){reads++;return sampleIterator(s);}}
 const video=new Blob(['video bytes']);
 const segmenter=await openVideoWavSegmenter(video,{loadDecoder:async()=>({Input,BlobSource,ALL_FORMATS:[],AudioSampleSink})});
 assert.equal(reads,0);
 const wav=await segmenter.makeSegment(segmenter.ranges[0]);
 assert.equal(reads,1);assert.equal(wav.bytes,32044);
 await segmenter.close();assert.equal(disposed,true);
});
