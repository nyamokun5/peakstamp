import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSceneZoom,normalizeSceneFocus,zoomDrawRect } from '../editing-rules.mjs';
import { pinchSceneCrop,panSceneCrop,attachScenePinchEditor } from '../scene-gesture.mjs';
import { buildMultiClipPlan } from '../multi-plan.mjs';

const almost=(a,b)=>assert.ok(Math.abs(a-b)<.025, a+' should be near '+b);
const initial={zoom:1,zoomX:.5,zoomY:.5};
const left={x:250,y:300},right={x:350,y:300};

test('pinch on the right half keeps the touched subject under fingers',()=>{
  const next=pinchSceneCrop(1000,600,1000,600,initial,
    {x:650,y:300},{x:750,y:300},{x:600,y:300},{x:800,y:300});
  assert.equal(next.zoom,2);
  const crop=zoomDrawRect(1000,600,1000,600,next.zoom,next.zoomX,next.zoomY);
  almost((700-crop.dx)/crop.dw,.7);
  almost(next.zoomX,.6);
});
test('off-center pinch pans as the midpoint moves',()=>{
  const next=pinchSceneCrop(1000,600,1000,600,initial,
    {x:250,y:250},{x:350,y:250},{x:340,y:260},{x:540,y:260});
  assert.equal(next.zoom,2);
  const crop=zoomDrawRect(1000,600,1000,600,next.zoom,next.zoomX,next.zoomY);
  almost((440-crop.dx)/crop.dw,.3);
  almost((260-crop.dy)/crop.dh,250/600);
});
test('one-finger pan moves the crop right when swiping left',()=>{
  const result=panSceneCrop(1000,600,1000,600,
    {zoom:2,zoomX:.5,zoomY:.5},{x:500,y:300},{x:300,y:300});
  almost(result.zoomX,.6);
  almost(result.zoomY,.5);
});
test('clamp crop at all edges without black borders',()=>{
  for(const zoom of [1,1.25,2,3])
  for(const x of [0,.15,.5,.9,1])
  for(const y of [0,.1,.5,1]){
    const rect=zoomDrawRect(1280,720,1280,720,zoom,x,y);
    assert.ok(rect.dx<=.0001&&rect.dy<=.0001);
    assert.ok(rect.dx+rect.dw>=1280-.0001);
    assert.ok(rect.dy+rect.dh>=720-.0001);
  }
});
test('previous centered-only zoom values still match their previous output geometry',()=>{
  assert.deepEqual(zoomDrawRect(1920,1080,1280,720,2),{dx:-640,dy:-360,dw:2560,dh:1440});
  assert.equal(normalizeSceneFocus(undefined),.5);
  assert.equal(normalizeSceneZoom('1.75'),1.75);
});
test('pinch back to 1x resets the focus and restores the full field',()=>{
 const p=pinchSceneCrop(1000,600,1000,600,{zoom:2.1,zoomX:.7,zoomY:.2},
   left,right,{x:299,y:300},{x:301,y:300});
 assert.deepEqual(p,initial);
});
test('different pan positions never merge into a single output scene',()=>{
 const src={
  id:'one',file:{name:'match.mov'},duration:100,bins:[{rms:.1}],
  candidates:[
   {time:12,manualEnd:21,enabled:true,zoom:2,zoomX:.3,zoomY:.5},
   {time:20,manualEnd:30,enabled:true,zoom:2,zoomX:.75,zoomY:.5}
  ]
 };
 const clips=buildMultiClipPlan([src],{mode:'fixed',fixedSeconds:12});
 assert.equal(clips.length,2);
 assert.equal(clips[0].end,20);
 assert.deepEqual([clips[0].zoomX,clips[1].zoomX],[.3,.75]);
});
test('same zoom and same pan can still be merged',()=>{
 const src={id:'one',file:{name:'match.mov'},duration:100,bins:[{rms:.1}],
 candidates:[{time:10,manualEnd:22,enabled:true,zoom:1.5,zoomX:.7,zoomY:.3},
   {time:21,manualEnd:30,enabled:true,zoom:1.5,zoomX:.7,zoomY:.3}]};
 const clips=buildMultiClipPlan([src],{mode:'fixed'});
 assert.equal(clips.length,1);
 assert.deepEqual([clips[0].start,clips[0].end,clips[0].zoom,clips[0].zoomX,clips[0].zoomY],
   [10,30,1.5,.7,.3]);
});
test('pointer listener supports a complete two-finger pinch and reset without slider',()=>{
 const viewport={
  handlers:{},style:{},addEventListener(name,handler){this.handlers[name]=handler},
  removeEventListener(name){delete this.handlers[name]},
  getBoundingClientRect(){return{left:0,top:0,width:1000,height:600}},
  setPointerCapture(){},releasePointerCapture(){}
 };
 const video={videoWidth:1000,videoHeight:600,style:{},events:{},
  addEventListener(name,handler){this.events[name]=handler},
  removeEventListener(name){delete this.events[name]}
 };
 const resetButton={disabled:true,handlers:{},
  addEventListener(name,handler){this.handlers[name]=handler},
  removeEventListener(name){delete this.handlers[name]}};
 const readout={textContent:''};
 const oldWindow=globalThis.window;
 let state={zoom:1,zoomX:.5,zoomY:.5},commits=0;
 globalThis.window={addEventListener(){},removeEventListener(){}};
 try{
  const detach=attachScenePinchEditor({viewport,video,read:()=>state,
    write:next=>{state=next},commit:()=>{commits++},resetButton,readout});
  const e=(id,x,y)=>({pointerId:id,pointerType:'touch',clientX:x,clientY:y,preventDefault(){}});
  viewport.handlers.pointerdown(e(11,250,300));
  viewport.handlers.pointerdown(e(12,350,300));
  viewport.handlers.pointermove(e(11,200,300));
  viewport.handlers.pointermove(e(12,400,300));
  viewport.handlers.pointerup(e(11,200,300));
  viewport.handlers.pointerup(e(12,400,300));
  assert.equal(state.zoom,2);
  assert.equal(commits,1);
  assert.equal(resetButton.disabled,false);
  assert.ok(video.style.transform.includes('scale(2)'));
  // Swipe with one finger after the pinch.
  const focusBeforePan=state.zoomX;
  viewport.handlers.pointerdown(e(15,500,300));
  viewport.handlers.pointermove(e(15,400,300));
  viewport.handlers.pointerup(e(15,400,300));
  assert.ok(state.zoomX>focusBeforePan);
  assert.equal(commits,2);
  resetButton.handlers.click();
  assert.deepEqual(state,initial);
  assert.equal(commits,3);
  assert.equal(resetButton.disabled,true);
  detach();
  assert.equal(viewport.handlers.pointerdown,undefined);
 }finally{globalThis.window=oldWindow;}
});
