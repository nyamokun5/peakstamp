import test from 'node:test';
import assert from 'node:assert/strict';
import {goalSceneBounds,goalSceneZoom,setGoalSceneEdge} from '../goal-scene-edit.mjs';

test('goal candidates default to 4 seconds before goal and 2 seconds after',()=>{
 const g={origin:'manual',goalTimeSeconds:60,timeSeconds:60};
 assert.deepEqual(goalSceneBounds(g,100),{start:56,end:62});
 assert.deepEqual(goalSceneBounds({...g,goalTimeSeconds:1},100),{start:0,end:3});
 assert.deepEqual(goalSceneBounds({...g,goalTimeSeconds:99},100),{start:95,end:100});
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
