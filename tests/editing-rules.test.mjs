import test from 'node:test';
import assert from 'node:assert/strict';
import { quietClipEnd, dissolveFrames, dissolveOverlap,
  normalizeFont, normalizeSize, DISSOLVE_SECONDS } from '../editing-rules.mjs';
import { buildMultiClipPlan, sourceTimestampComments } from '../multi-plan.mjs';

const envelope=(duration, loudStart=20, loudEnd=27)=>
  Array.from({length:duration*4},(_,i)=>({time:i*.25,
    rms:i*.25>=loudStart&&i*.25<loudEnd ? .3 : .012}));
test('quiet confirmation and 3-second trailing action yields correct end',()=>{
  const bins=envelope(70);
  const end=quietClipEnd({bins,peakSeconds:22,startSeconds:15,
    duration:70,tailSeconds:3});
  assert.ok(end>=31 && end<=34, 'end '+end);
});
test('loud scene with no quiet stretch uses fixed fallback',()=>{
  const bins=Array.from({length:60*4},()=>({rms:.3}));
  assert.equal(quietClipEnd({bins,peakSeconds:25,startSeconds:18,
    duration:60,fallbackSeconds:16}),34);
});
test('short noise dips are not mistaken for settled quiet',()=>{
  const bins=envelope(70);
  for(let i=24*4;i<25*4;i++)bins[i].rms=.006; // only one second
  const end=quietClipEnd({bins,peakSeconds:22,startSeconds:15,
    duration:70,tailSeconds:3});
  assert.ok(end>=31, 'ended too early at '+end);
});
test('clip end remains within source duration',()=>{
  assert.ok(quietClipEnd({bins:envelope(30,22,27),peakSeconds:23,
    startSeconds:20,duration:30})<=30);
});
test('0.5s dissolve is fifteen frames at 30fps',()=>{
  assert.equal(DISSOLVE_SECONDS,.5);
  assert.equal(dissolveFrames(30),15);
  assert.equal(dissolveOverlap([{start:0,end:10},{start:3,end:13}],30),.5);
});
test('short clips cap dissolve to safe overlap',()=>{
  const n=dissolveOverlap([{start:0,end:.3},{start:2,end:2.3}],30);
  assert.ok(n>=0 && n<.5);
});
test('safe title font and size presets',()=>{
  assert.equal(normalizeFont('serif'),'serif');
  assert.equal(normalizeFont('unknown'),'impact');
  assert.equal(normalizeSize(200),150);
  assert.equal(normalizeSize(30),60);
});
test('each original video gets its own non-cumulative timestamps',()=>{
  const sources=[
    {id:'a',file:{name:'Game1.mov'},duration:60,bins:envelope(60),
      candidates:[{time:14,peakSeconds:21,enabled:true,title:'Goal!'},
      {time:24,enabled:false,title:'Not kept'}]},
    {id:'b',file:{name:'Game2.mov'},duration:60,bins:envelope(60),
      candidates:[{time:8,peakSeconds:15,enabled:true,title:'Save'}]},
  ];
  const comments=sourceTimestampComments(sources);
  assert.equal(comments[0].text,'⚽ Game1.mov — Highlights\n00:14 Goal!');
  assert.equal(comments[1].text,'⚽ Game2.mov — Highlights\n00:08 Save');
  assert.ok(!comments[0].text.includes('Not kept'));
  const clips=buildMultiClipPlan(sources,{mode:'quiet',tailSeconds:3});
  assert.deepEqual(clips.map(x=>x.sourceId),['a','b']);
  assert.ok(clips[0].end>clips[0].start);
});
test('unkept candidates are never included in montage',()=>{
  const source={id:'a',file:{name:'a.mov'},duration:70,bins:envelope(70),
    candidates:[{time:10,peakSeconds:17,enabled:false}]};
  assert.deepEqual(buildMultiClipPlan([source],{mode:'quiet'}),[]);
  source.candidates[0].enabled=true;
  assert.equal(buildMultiClipPlan([source],{mode:'quiet'}).length,1);
});
