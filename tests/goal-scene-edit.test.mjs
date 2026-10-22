import test from 'node:test';
import assert from 'node:assert/strict';
import {goalSceneBounds,goalSceneZoom,setGoalSceneEdge,goalSceneReferenceTime} from '../goal-scene-edit.mjs';

test('audio-derived goal video defaults to spoken commentary -5 seconds through +2 seconds',()=>{
 const g={origin:'audio',timeSeconds:75,goalTimeSeconds:65};
 assert.equal(goalSceneReferenceTime(g),75);
 assert.deepEqual(goalSceneBounds(g,100),{start:70,end:77});
 // Adjusting actual scoring time must NOT silently move the clip away from
 // the fixed, separately recorded original commentary timestamp.
 assert.deepEqual(goalSceneBounds({...g,goalTimeSeconds:63.5},100),{start:70,end:77});
});
test('commentary cut handles source start/end and short files',()=>{
 const g={origin:'audio',timeSeconds:1,goalTimeSeconds:0};
 assert.deepEqual(goalSceneBounds(g,20),{start:0,end:3});
 assert.deepEqual(goalSceneBounds({...g,timeSeconds:19},20),{start:14,end:20});
 assert.deepEqual(goalSceneBounds({...g,timeSeconds:1},2),{start:0,end:2});
});
test('manual goals without commentary fall back to manually marked goal -5/+2',()=>{
 const g={origin:'manual',goalTimeSeconds:60,timeSeconds:60};
 assert.equal(goalSceneReferenceTime(g),60);
 assert.deepEqual(goalSceneBounds(g,100),{start:55,end:62});
 assert.deepEqual(goalSceneBounds({...g,goalTimeSeconds:1},100),{start:0,end:3});
 assert.deepEqual(goalSceneBounds({...g,goalTimeSeconds:99},100),{start:94,end:100});
});
test('manually trimmed goals keep their bounds even when goal timestamp changes',()=>{
 const g={origin:'audio',timeSeconds:75,goalTimeSeconds:65,
 clipStartSeconds:58.7,clipEndSeconds:68.9};
 assert.deepEqual(goalSceneBounds(g,100),{start:58.7,end:68.9});
 g.goalTimeSeconds=62;
 assert.deepEqual(goalSceneBounds(g,100),{start:58.7,end:68.9});
 assert.equal(setGoalSceneEdge(g,'start',60.2,100),true);
 assert.equal(setGoalSceneEdge(g,'end',67.5,100),true);
 assert.deepEqual(goalSceneBounds(g,100),{start:60.2,end:67.5});
 assert.equal(setGoalSceneEdge(g,'start',70,100),false);
});
test('goal scene zoom clamps and uses unchanged framing coordinates',()=>{
 assert.deepEqual(goalSceneZoom({}),{zoom:1,zoomX:.5,zoomY:.5});
 assert.deepEqual(goalSceneZoom({clipZoom:2.4,clipZoomX:.27,clipZoomY:.68}),
  {zoom:2.4,zoomX:.27,zoomY:.68});
});
