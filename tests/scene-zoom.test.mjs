import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSceneZoom,zoomDrawRect } from '../editing-rules.mjs';
import { buildMultiClipPlan } from '../multi-plan.mjs';
const source=(clips)=>({
 id:'v1',file:{name:'game.mov'},duration:100,bins:[{rms:.2}],candidates:clips
});
test('zoom defaults to unchanged original',()=>{
 assert.equal(normalizeSceneZoom(undefined),1);
 assert.equal(normalizeSceneZoom('1'),1);
 assert.equal(normalizeSceneZoom('1.5'),1.5);
 assert.equal(normalizeSceneZoom('2'),2);
 assert.equal(normalizeSceneZoom(17),1);
 assert.equal(normalizeSceneZoom(-1),1);
});
test('1x geometry fits centered source with no cropping',()=>{
 assert.deepEqual(zoomDrawRect(1920,1080,1280,720,1),{dx:0,dy:0,dw:1280,dh:720});
});
test('1.5x and 2x zoom enlarge around the center, crop outside canvas',()=>{
 assert.deepEqual(zoomDrawRect(1920,1080,1280,720,1.5),{
   dx:-320,dy:-180,dw:1920,dh:1080
 });
 assert.deepEqual(zoomDrawRect(1920,1080,1280,720,2),{
   dx:-640,dy:-360,dw:2560,dh:1440
 });
});
test('zoom preserves letterbox behavior on portrait source at 1x',()=>{
 const r=zoomDrawRect(1080,1920,1280,720,1);
 assert.equal(r.dh,720);
 assert.equal(r.dx>0,true);
 assert.equal(r.dw<1280,true);
});
test('zoom does not change export resolution, clips or duration',()=>{
 const input=source([{time:10,peakSeconds:18,manualEnd:25,enabled:true,zoom:1.5}]);
 assert.deepEqual(buildMultiClipPlan([input],{mode:'quiet'}),[
  {sourceId:'v1',sourceName:'game.mov',start:10,end:25,zoom:1.5}
 ]);
 input.candidates[0].zoom=1;
 assert.deepEqual(buildMultiClipPlan([input],{mode:'quiet'}),[
  {sourceId:'v1',sourceName:'game.mov',start:10,end:25}
 ]);
});
test('neighboring highlights of the same zoom merge without duplicated footage',()=>{
 const clips=[
  {time:10,peakSeconds:18,manualEnd:24,zoom:2,enabled:true},
  {time:20,peakSeconds:27,manualEnd:37,zoom:2,enabled:true}
 ];
 assert.deepEqual(buildMultiClipPlan([source(clips)],{mode:'quiet'}),[
  {sourceId:'v1',sourceName:'game.mov',start:10,end:37,zoom:2}
 ]);
});
test('different zoom highlights split at boundary and avoid repeated overlap',()=>{
 const clips=[
  {time:10,peakSeconds:17,manualEnd:25,zoom:2,enabled:true},
  {time:20,peakSeconds:27,manualEnd:35,zoom:1,enabled:true}
 ];
 assert.deepEqual(buildMultiClipPlan([source(clips)],{mode:'quiet'}),[
  {sourceId:'v1',sourceName:'game.mov',start:10,end:20,zoom:2},
  {sourceId:'v1',sourceName:'game.mov',start:20,end:35}
 ]);
});
