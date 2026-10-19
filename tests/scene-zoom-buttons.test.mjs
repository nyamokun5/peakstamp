import test from 'node:test';
import assert from 'node:assert/strict';
import {attachScenePinchEditor} from '../scene-gesture.mjs';

test('zoom buttons reuse the original pinch crop pipeline and commit',()=>{
 globalThis.window={addEventListener(){},removeEventListener(){}};
 const events=()=>({addEventListener(){},removeEventListener(){}});
 const viewport={...events(),style:{},
   getBoundingClientRect:()=>({width:360,height:203,left:0,top:0})};
 const video={...events(),style:{},videoWidth:1920,videoHeight:1080};
 const resetButton={...events(),disabled:false};
 const readout={textContent:''};
 let state={zoom:1,zoomX:.5,zoomY:.5},commits=0;
 const close=attachScenePinchEditor({viewport,video,read:()=>state,
  write:s=>{state=s},commit:()=>commits++,resetButton,readout});
 close.zoomBy(1.25);
 assert.equal(state.zoom,1.25);assert.equal(commits,1);
 assert.equal(readout.textContent,'1.25倍');
 close.zoomBy(8);
 assert.equal(state.zoom,3);
 close.reset();
 assert.equal(state.zoom,1);assert.equal(resetButton.disabled,true);
 close();
});
