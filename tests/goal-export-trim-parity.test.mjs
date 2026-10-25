import test from 'node:test';
import assert from 'node:assert/strict';
import {keepGoalClip,rejectGoalClip,syncGoalClipDecisions} from '../goal-video-clip.mjs';
import {buildMultiClipPlan} from '../multi-plan.mjs';
import {setGoalSceneEdge} from '../goal-scene-edit.mjs';
import {geminiEventsToCandidates} from '../gemini-candidates.mjs';

const goal=(overrides={})=>({
 id:'goal-241',origin:'gemini',timeSeconds:241,goalTimeSeconds:238,
 clipStartSeconds:233,clipEndSeconds:246,
 clipZoom:1,clipZoomX:.5,clipZoomY:.5,videoDecision:'kept',
 ...overrides
});
const source=(candidates=[])=>({
 id:'video1',file:{name:'IMG_0289.MOV',size:410181435,lastModified:1792900000000},
 duration:366.69733333333335,bins:[{time:0,rms:.1}],candidates
});
const plan=source=>buildMultiClipPlan([source]).map(({start,end,zoom,zoomX,zoomY})=>({
 start,end,zoom:zoom??1,zoomX:zoomX??.5,zoomY:zoomY??.5
}));
test('goal trim overrides an already kept regular highlight in the FINAL MP4 plan',()=>{
 const clip={id:'gemini-241',sourceId:'video1',origin:'gemini',geminiType:'goal_reaction',
  time:237,peakSeconds:241,manualEnd:243,enabled:true,rejected:false,
  zoom:1,zoomX:.5,zoomY:.5};
 const s=source([clip]),g=goal();
 assert.deepEqual(plan(s).map(x=>[x.start,x.end]),[[237,243]]);
 assert.equal(keepGoalClip(s,g),clip);
 assert.equal(s.candidates.length,1,'same source candidate is used for goal and normal highlight');
 assert.deepEqual(plan(s).map(x=>[x.start,x.end]),[[233,246]]);
 assert.equal(clip.goalVideoOwned,true);
 assert.equal(clip.goalRecordId,g.id);
 assert.deepEqual(clip.goalPriorHighlight.time,237);
 assert.equal(setGoalSceneEdge(g,'start',230.4,s.duration),true);
 assert.equal(setGoalSceneEdge(g,'end',250.7,s.duration),true);
 g.clipZoom=1.8;g.clipZoomX=.3;g.clipZoomY=.7;
 keepGoalClip(s,g); // goal editor onChange does this for already kept goal.
 assert.deepEqual(plan(s),[{start:230.4,end:250.7,zoom:1.8,zoomX:.3,zoomY:.7}]);
 assert.deepEqual(clip.goalPriorHighlight.time,237,'initial regular trim is retained for rejection');
});
test('rejecting a goal restores an independently kept highlight without deleting it',()=>{
 const clip={id:'regular',sourceId:'video1',origin:'gemini',
  time:237,peakSeconds:241,manualEnd:243,zoom:1.4,zoomX:.4,zoomY:.6,
  enabled:true,rejected:false};
 const s=source([clip]),g=goal();
 keepGoalClip(s,g);
 assert.deepEqual(plan(s).map(c=>[c.start,c.end]),[[233,246]]);
 assert.equal(rejectGoalClip(s,g),true);
 assert.equal(clip.enabled,true);
 assert.equal(clip.goalRecordId,undefined);
 assert.equal(clip.goalVideoOwned,undefined);
 assert.equal(clip.goalPriorHighlight,undefined);
 assert.deepEqual(plan(s),[{start:237,end:243,zoom:1.4,zoomX:.4,zoomY:.6}]);
});
test('goal-only candidate keeps exact trim without needing a waveform',()=>{
 const s=source([]);
 s.bins=null;
 const g=goal({clipStartSeconds:232.1,clipEndSeconds:248.4});
 const added=keepGoalClip(s,g);
 assert.equal(added.goalVideoOwned,true);
 assert.deepEqual(plan(s).map(c=>[c.start,c.end]),[[232.1,248.4]]);
 g.clipStartSeconds=228;g.clipEndSeconds=251;
 keepGoalClip(s,g);
 assert.deepEqual(plan(s).map(c=>[c.start,c.end]),[[228,251]]);
});
test('Gemini reanalysis preserves goal ownership, edits and undo metadata',()=>{
 const s=source([{id:'gemini-old',sourceId:'video1',origin:'gemini',
  peakSeconds:241,time:237,enabled:true,manualEnd:243,
  zoom:1,zoomX:.5,zoomY:.5}]);
 const g=goal();
 keepGoalClip(s,g);
 const scans=geminiEventsToCandidates([{
  timeSeconds:241,type:'goal_reaction',confidence:'high',
  clipStartSeconds:233,clipEndSeconds:246,quote:'ゴール！'
 }],s.id,s.duration,s.candidates);
 assert.equal(scans.items.length,1);
 const updated=scans.items[0];
 assert.equal(updated.goalRecordId,g.id);
 assert.equal(updated.goalVideoOwned,true);
 assert.equal(updated.goalPriorHighlight.time,237);
 s.candidates=scans.items;
 syncGoalClipDecisions(s,[g]);
 assert.deepEqual(plan(s).map(x=>[x.start,x.end]),[[233,246]]);
 g.clipStartSeconds=225.5;
 g.clipEndSeconds=247.6;
 keepGoalClip(s,g);
 assert.deepEqual(plan(s).map(x=>[x.start,x.end]),[[225.5,247.6]]);
});
test('editing goal after matching unkept Gemini proposal also updates export',()=>{
 const clip={id:'proposal',origin:'gemini',sourceId:'video1',
  peakSeconds:241,time:237,enabled:false,rejected:false,manualEnd:null,
  zoom:1,zoomX:.5,zoomY:.5};
 const s=source([clip]),g=goal({clipStartSeconds:227.8,clipEndSeconds:254.3});
 keepGoalClip(s,g);
 assert.deepEqual(plan(s).map(x=>[x.start,x.end]),[[227.8,254.3]]);
 g.clipStartSeconds=230.6;g.clipEndSeconds=248.1;
 syncGoalClipDecisions(s,[g]);
 assert.deepEqual(plan(s).map(x=>[x.start,x.end]),[[230.6,248.1]]);
});
