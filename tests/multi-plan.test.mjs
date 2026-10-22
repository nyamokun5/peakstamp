import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMultiClipPlan, montageChapters } from '../multi-plan.mjs';

const file = (id, name, duration, candidates, analyzed = true) =>
  ({id, file:{name}, bins: analyzed ? [{time:0,rms:0.1}] : null,
    duration, candidates});
test('multiple files create plan in chosen file order, with file-local timestamps', () => {
  const clips=buildMultiClipPlan([
    file('B','match-b.mov',60,[{time:20,enabled:true}]),
    file('A','match-a.mov',60,[{time:10,enabled:true},{time:25,enabled:false}])
  ],12);
  assert.deepEqual(clips,[
    {sourceId:'B',sourceName:'match-b.mov',start:20,end:32},
    {sourceId:'A',sourceName:'match-a.mov',start:10,end:22}
  ]);
});
test('reordering sources changes final playback order', () => {
  const sources=[
    file('A','A.mov',50,[{time:8,enabled:true}]),
    file('B','B.mov',50,[{time:16,enabled:true}]),
  ];
  assert.deepEqual(buildMultiClipPlan([...sources].reverse(),8)
    .map(c=>c.sourceId), ['B','A']);
});
test('each file has independent overlap merging and duration cap', () => {
  const plan=buildMultiClipPlan([
    file('A','A.mov',25,[{time:10,enabled:true},{time:14,enabled:true}]),
    file('B','B.mov',12,[{time:9,enabled:true}]),
  ],8);
  assert.deepEqual(plan,[
    {sourceId:'A',sourceName:'A.mov',start:10,end:22},
    {sourceId:'B',sourceName:'B.mov',start:9,end:12}
  ]);
});
test('unselected, unanalyzed and non-video files are skipped', () => {
  assert.deepEqual(buildMultiClipPlan([
    file('x','x.mov',20,[{time:10}],false),
    file('y','y.mov',20,[{time:2,enabled:false}]),
  ]),[]);
});
test('generated video chapters account for 5-second title and selected clips', () => {
  const plan=buildMultiClipPlan([
    file('A','A.mov',30,[{time:4,enabled:true}]),
    file('B','B.mov',30,[{time:10,enabled:true}]),
  ],8);
  assert.equal(montageChapters(plan,'GOALS!'),
    '0:00 GOALS!\n00:05 Highlight 1 — A.mov\n00:12 Highlight 2 — B.mov');
});
test('empty selection returns empty chapter text',()=>{
  assert.equal(montageChapters([], 'GOALS!'),'');
});

test('default export plan uses the same peak minus 4/plus 2 as scene preview',()=>{
 const source=file('A','game.mov',100,[
  {time:21,peakSeconds:25,manualEnd:null,enabled:true},
  {time:56,peakSeconds:60,manualEnd:null,enabled:true},
 ]);
 assert.deepEqual(buildMultiClipPlan([source]),[
  {sourceId:'A',sourceName:'game.mov',start:21,end:27},
  {sourceId:'A',sourceName:'game.mov',start:56,end:62}
 ]);
 const edited=file('B','edited.mov',100,[
  {time:18,peakSeconds:25,manualEnd:34,enabled:true}
 ]);
 assert.deepEqual(buildMultiClipPlan([edited]),[
  {sourceId:'B',sourceName:'edited.mov',start:18,end:34}
 ]);
});
test('default plan handles peak within four seconds of the video boundaries',()=>{
 const source=file('A','short.mov',20,[
  {time:0,peakSeconds:1,enabled:true},
  {time:15,peakSeconds:19,enabled:true}
 ]);
 assert.deepEqual(buildMultiClipPlan([source]),[
  {sourceId:'A',sourceName:'short.mov',start:0,end:3},
  {sourceId:'A',sourceName:'short.mov',start:15,end:20}
 ]);
});

test('accepted goal is interleaved chronologically with standard Keep clips',()=>{
 const src=file('A','game.mov',120,[
   {id:'regular-later',time:70,peakSeconds:74,manualEnd:76,enabled:true},
   {id:'goal',goalRecordId:'g1',origin:'goal-commentary',
    time:34,peakSeconds:38,manualEnd:40,enabled:true},
   {id:'regular-earlier',time:10,peakSeconds:14,manualEnd:16,enabled:true},
 ]);
 const plan=buildMultiClipPlan([src]);
 assert.deepEqual(plan.map(c=>c.start),[10,34,70]);
 assert.deepEqual(plan.map(c=>c.end),[16,40,76]);
});
test('goal-only file exports without waveform; video file order is preserved',()=>{
 const goalOnly=file('A','goal.mov',100,[
  {goalRecordId:'g1',origin:'goal-commentary',
   time:31,peakSeconds:35,manualEnd:37,enabled:true}
 ],false);
 const other=file('B','regular.mov',100,[
  {time:5,peakSeconds:9,manualEnd:11,enabled:true}
 ]);
 assert.deepEqual(buildMultiClipPlan([goalOnly,other]).map(c=>[c.sourceId,c.start,c.end]),
  [['A',31,37],['B',5,11]]);
});
test('unanalyzed ordinary candidates are still excluded from video export',()=>{
 const src=file('X','old.mov',100,[
  {time:8,peakSeconds:12,manualEnd:14,enabled:true}
 ],false);
 assert.deepEqual(buildMultiClipPlan([src]),[]);
});
