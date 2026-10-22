import test from 'node:test';
import assert from 'node:assert/strict';
import { getCandidateEnd, clipMarkerPositions, defaultPeakClipBounds } from '../editing-rules.mjs';
import { buildMultiClipPlan } from '../multi-plan.mjs';

function videoSource(id, times) {
  const duration=100;
  return { id, file:{name:id+'.mov'}, duration,
    bins:Array.from({length:duration*4},(_,i)=>({time:i*.25,rms:(i>=80&&i<112)?.3:.012})),
    candidates:times.map((time,i)=>({time,peakSeconds:time+7,enabled:i===0,manualEnd:null,title:'Highlight'}))
  };
}
test('manually selected endpoint takes precedence over quiet cutoff',()=>{
  const source=videoSource('game1',[14]);
  const clip=source.candidates[0];
  const auto=getCandidateEnd(source,clip,{mode:'quiet',fixedSeconds:16,tailSeconds:3});
  assert.ok(auto>clip.time);
  clip.manualEnd=44;
  assert.equal(getCandidateEnd(source,clip,{mode:'quiet'}),44);
  assert.equal(getCandidateEnd(source,clip,{mode:'fixed',fixedSeconds:16}),44);
});
test('revert to automatic ending restores quiet detector',()=>{
  const source=videoSource('game1',[14]);
  const clip=source.candidates[0];
  const auto=getCandidateEnd(source,clip,{mode:'quiet',fixedSeconds:16,tailSeconds:3});
  clip.manualEnd=48;
  assert.equal(getCandidateEnd(source,clip,{}),48);
  clip.manualEnd=null;
  assert.equal(getCandidateEnd(source,clip,{mode:'quiet',fixedSeconds:16,tailSeconds:3}),auto);
});
test('start, peak and endpoint visual markers are ordered for normal clips',()=>{
  const p=clipMarkerPositions(12,19,31,80);
  assert.ok(p.start<p.peak&&p.peak<p.end);
  assert.ok(p.start>=0&&p.end<=100);
  assert.ok(p.left>=0&&p.right<=80);
});
test('end marker stays within the supplied video duration',()=>{
  const p=clipMarkerPositions(73,78,120,80);
  assert.equal(p.right,80);
  assert.ok(p.end<=100);
});
test('only kept candidates enter plan and manually adjusted endpoints persist',()=>{
  const a=videoSource('first',[10,40]);
  const b=videoSource('second',[50,70]);
  a.candidates[0].manualEnd=33;
  b.candidates[0].manualEnd=78;
  const plan=buildMultiClipPlan([a,b],{mode:'quiet',fixedSeconds:16,tailSeconds:3});
  assert.deepEqual(plan,[
    {sourceId:'first',sourceName:'first.mov',start:10,end:33},
    {sourceId:'second',sourceName:'second.mov',start:50,end:78},
  ]);
});
test('fixed cut mode still respects edited manual endpoint',()=>{
  const src=videoSource('first',[10]);
  src.candidates[0].manualEnd=35;
  assert.equal(buildMultiClipPlan([src],{mode:'fixed',fixedSeconds:10})[0].end,35);
});
test('invalid manual endpoints cannot extend past the file duration',()=>{
  const src=videoSource('first',[91]);
  src.candidates[0].manualEnd=1000;
  assert.equal(getCandidateEnd(src,src.candidates[0],{mode:'quiet'}),100);
});

test('new default clip bounds are peak minus 4s through peak plus 2s',()=>{
 const source=videoSource('one',[10]);
 const item=source.candidates[0];
 item.time=item.peakSeconds-4;
 assert.deepEqual(defaultPeakClipBounds(item.peakSeconds,source.duration),
  {start:item.peakSeconds-4,end:item.peakSeconds+2});
 assert.equal(getCandidateEnd(source,item,{mode:'peak'}),item.peakSeconds+2);
});
test('default cuts are clamped safely near video beginning and end',()=>{
 assert.deepEqual(defaultPeakClipBounds(1,20),{start:0,end:3});
 assert.deepEqual(defaultPeakClipBounds(19,20),{start:15,end:20});
 assert.deepEqual(defaultPeakClipBounds(0,2),{start:0,end:2});
});
test('manual trim endpoints override peak-relative automatic endpoint',()=>{
 const source=videoSource('one',[10]),item=source.candidates[0];
 item.time=8;
 item.manualEnd=34;
 assert.equal(getCandidateEnd(source,item,{mode:'peak'}),34);
 item.manualEnd=null;
 assert.equal(getCandidateEnd(source,item,{mode:'peak'}),item.peakSeconds+2);
});
test('fresh Gemini suggestions default to peak minus 4 through plus 2 instead of AI clip span',async()=>{
 const {geminiEventsToCandidates}=await import('../gemini-candidates.mjs');
 const events=[{timeSeconds:45,type:'goal_reaction',confidence:'high',
    clipStartSeconds:30,clipEndSeconds:66}];
 const newClips=geminiEventsToCandidates(events,'a',100,[]).items;
 assert.equal(newClips.length,1);
 assert.equal(newClips[0].time,41);
 assert.equal(newClips[0].manualEnd,null);
 const source={duration:100,bins:[],candidates:newClips};
 assert.equal(getCandidateEnd(source,newClips[0],{mode:'peak'}),47);
 const existing=[{origin:'gemini',peakSeconds:45,time:35,manualEnd:64,enabled:true}];
 const rerun=geminiEventsToCandidates(events,'a',100,existing).items[0];
 assert.equal(rerun.time,35);
 assert.equal(rerun.manualEnd,64);
 assert.equal(rerun.enabled,true);
});
