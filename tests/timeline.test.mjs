import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTimelineTime,timelineTimeAt,clampTimelineEdge,getCandidateEnd } from '../editing-rules.mjs';
import { buildMultiClipPlan } from '../multi-plan.mjs';

test('timeline shows positive original-video times to a tenth',()=>{
  assert.equal(formatTimelineTime(12.34),'00:12.3');
  assert.equal(formatTimelineTime(-15),'00:00.0');
  assert.equal(formatTimelineTime(59.96),'01:00.0');
  assert.equal(formatTimelineTime(3672.8),'1:01:12.8');
});
test('coarse drag maps finger coordinate to zoomed range',()=>{
  const rect={left:100,width:200};
  assert.equal(timelineTimeAt(100,rect,10,30,.25),10);
  assert.equal(timelineTimeAt(200,rect,10,30,.25),20);
  assert.equal(timelineTimeAt(300,rect,10,30,.25),30);
});
test('drag cannot seek outside source or produce negative timestamps',()=>{
  const rect={left:100,width:200};
  assert.equal(timelineTimeAt(0,rect,10,30,.25),10);
  assert.equal(timelineTimeAt(500,rect,10,30,.25),30);
});
test('fractional scrub rounds to the requested 0.1 second',()=>{
  assert.equal(timelineTimeAt(142, {left:100,width:100},20,24,.1),21.7);
});
test('start and end controls cannot cross or exceed source duration',()=>{
  assert.equal(clampTimelineEdge('start',33,10,30,80),29.7);
  assert.equal(clampTimelineEdge('start',-10,10,30,80),0);
  assert.equal(clampTimelineEdge('end',8,10,30,80),10.3);
  assert.equal(clampTimelineEdge('end',100,10,30,80),80);
  assert.throws(()=>clampTimelineEdge('unknown',22,10,30,80));
});
test('tenths edits are honored by generated clip plan, not just the timeline',()=>{
  const a={id:'A',file:{name:'a.mov'},duration:80,bins:[{rms:.2}],
    candidates:[{time:12.4,peakSeconds:19,manualEnd:28.7,enabled:true}]};
  assert.equal(getCandidateEnd(a,a.candidates[0],{mode:'quiet'}),28.7);
  assert.deepEqual(buildMultiClipPlan([a],{mode:'quiet'}),[
    {sourceId:'A',sourceName:'a.mov',start:12.4,end:28.7}
  ]);
});
