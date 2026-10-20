import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initIntroEditor,getIntroConfiguration,setIntroWorking} from '../intro-ui.mjs';

function makeElement(){
  return {
    textContent:'',value:'',disabled:false,hidden:false,style:{},
    events:{},classList:{toggle(){}},
    addEventListener(type,fn){this.events[type]=fn},
    click(){this.events.click?.()},
    pause(){},load(){},removeAttribute(){},setAttribute(){},
    setPointerCapture(){},releasePointerCapture(){},
    getBoundingClientRect(){return {left:0,top:0,width:320,height:180}},
    getContext(){return {
      clearRect(){},fillText(){},
      measureText:label=>({width:String(label).length*34})
    }}
  };
}
test('intro is positioned by dragging the preview; only a center reset is offered',()=>{
  const ids=['introError','introCardBackgroundSettings','introDurationLabel',
    'introPreviewHelp','introBackgroundName','introOverlayName',
    'introOverlayClear','introOverlayControls','introPositionLabel',
    'introCenterPosition','introImagePicker','introVideoPicker',
    'introPlay','introCanvas','introPreviewFrame','introVideoPreview',
    'introFirstScenePreview','titleFont','titleSize','montageTitle',
    'introImageFile','introVideoFile','introOverlayFile','introOverlayScale','introScaleValue'];
  const elements=Object.fromEntries(ids.map(id=>[id,makeElement()]));
  const canvas=elements.introCanvas;
  canvas.width=640;canvas.height=360;
  elements.titleFont.value='impact';
  elements.titleSize.value='100';
  elements.montageTitle.value='GOALS!';
  const priorDocument=globalThis.document,priorWindow=globalThis.window;
  globalThis.document={
    getElementById:id=>elements[id],
    querySelectorAll:()=>[]
  };
  globalThis.window={addEventListener(){}};
  try{
    let changeCount=0;
    initIntroEditor(()=>changeCount++,()=>false);
    assert.deepEqual(getIntroConfiguration().position,{x:.5,y:.5});
    assert.equal(elements.introCenterPosition.disabled,true);
    const event=(x,y)=>({pointerId:1,clientX:x,clientY:y,preventDefault(){}});
    canvas.events.pointerdown(event(160,90));
    canvas.events.pointermove(event(190,110));
    canvas.events.pointerup(event(190,110));
    const moved=getIntroConfiguration().position;
    assert.ok(moved.x>.5&&moved.y>.5);
    assert.equal(changeCount,1);
    assert.equal(elements.introCenterPosition.disabled,false);
    elements.introCenterPosition.click();
    assert.deepEqual(getIntroConfiguration().position,{x:.5,y:.5});
    assert.equal(elements.introCenterPosition.disabled,true);
    assert.equal(changeCount,2);
    setIntroWorking(true);
    assert.equal(elements.introCenterPosition.disabled,true);
    const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
    assert.doesNotMatch(html,/data-intro-position=|introPositionGrid/);
    assert.match(html,/id="introCenterPosition"/);
  }finally{
    globalThis.document=priorDocument;
    globalThis.window=priorWindow;
  }
});
