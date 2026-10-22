import test from 'node:test';
import assert from 'node:assert/strict';
import {initGoalStatsReview} from '../goal-stats-ui.mjs';
import {createGoalDrafts,goalSourceKey,confirmedGoalExport} from '../goal-stats.mjs';

const ids=[
 'goalStatsPanel','goalStatsList','goalStatsEditor','goalStatsSummary','goalStatsStatus',
 'goalStatsPreview','goalStatsPlayingLabel','goalStatsViewer','goalStatsVideoStatus',
 'goalStatsAdd','goalStatsManualSource','goalStatsManualWrap','goalStatsExport',
 'goalStatsCopy','goalStatsShow','goalStatsJson','goalStatsJsonArea'
];
function setup(){
 const stats={loads:0,plays:0,competingPaused:0};
 class Element{
  constructor(tag='div'){
   this.tagName=tag;this.className='';this.children=[];this.events={};this.listeners={};this.dataset={};
   this.value='';this.textContent='';this.hidden=false;this.disabled=false;
   this.readyState=0;this.currentTime=0;this.paused=true;
   this.style={};this.videoWidth=1920;this.videoHeight=1080;
  }
  append(...items){this.children.push(...items)}
  replaceChildren(...items){this.children=items}
  addEventListener(name,handler){
   if(!this.listeners[name])this.listeners[name]=new Set();
   this.listeners[name].add(handler);
   this.events[name]=(...args)=>{
    for(const fn of [...(this.listeners[name]||[])])fn(...args);
   };
  }
  removeEventListener(name,handler){
   this.listeners[name]?.delete(handler);
   if(!this.listeners[name]?.size)delete this.events[name];
  }
  getBoundingClientRect(){return {left:0,top:0,width:360,height:203,right:360,bottom:203}}
  setPointerCapture(){}
  releasePointerCapture(){}
  setAttribute(){}
  removeAttribute(name){if(name==='src')this._src=''}
  scrollIntoView(){}
  focus(){}
  select(){}
  pause(){this.paused=true}
  set src(value){
   this._src=value;
   this.currentTime=0; // Browser resets currentTime on media source replacement.
   stats.loads++;
   queueMicrotask(()=>{
    this.readyState=1;
    this.events.loadedmetadata?.();
   });
  }
  get src(){return this._src}
  load(){stats.loads++}
  play(){stats.plays++;this.paused=false;return Promise.resolve()}
  webkitEnterFullscreen(){stats.nativeFullscreen=(stats.nativeFullscreen||0)+1}
 }
 const dom=Object.fromEntries(ids.map(id=>[id,new Element()]));
 dom.goalStatsViewer.hidden=true;
 dom.goalStatsPreview.hidden=true;
 const previousDocument=globalThis.document,previousWindow=globalThis.window;
 const storage={values:new Map(),getItem(k){return this.values.get(k)||null},
  setItem(k,v){this.values.set(k,v)}};
 globalThis.document={getElementById:id=>dom[id],createElement:tag=>new Element(tag)};
 globalThis.window={localStorage:storage,prompt:()=>null,addEventListener(){},removeEventListener(){}};
 const one={id:'one',objectUrl:'blob:first',duration:450.752,bins:[{}],candidates:[],
  file:{name:'IMG_5292.mov',size:591367587,lastModified:1792283825000}};
 const two={id:'two',objectUrl:'blob:second',duration:417.685,bins:[{}],candidates:[],
  file:{name:'IMG_5293.MOV',size:548875601,lastModified:1792284336000}};
 for(const [source,time,scorer,assist,label] of [
  [one,379.2,'若さん','野田さん','3と4'],
  [two,117.5,'高崎さん','たいせい','3と2']
 ]){
  storage.setItem('peakstamp_callout_pilot_v2:'+goalSourceKey(source)+'::whole',
   JSON.stringify({utterances:[
    {kind:'match_start',time_seconds:1,match_label:label},
    {kind:'goal_call',time_seconds:time,quote:scorer+'ゴール',
     scorer,assist}
   ]}));
 }
 return {dom,storage,one,two,stats,restore(){
  globalThis.document=previousDocument;globalThis.window=previousWindow;
 }};
}
function find(node,cls){
 const queue=[node];
 while(queue.length){
  const child=queue.shift();
  if(child.className===cls)return child;
  queue.push(...child.children);
 }
 return null;
}
test('one queue for multiple videos; one decoder; confirm automatically advances',async()=>{
 const {dom,storage,one,two,stats,restore}=setup();
 try{
  initGoalStatsReview({sources:[one,two]},
   {onBeforePlay:()=>stats.competingPaused++});
  assert.equal(dom.goalStatsList.children.length,2);
  assert.match(dom.goalStatsList.children[0].children[0].textContent,/IMG_5292/);
  assert.match(dom.goalStatsList.children[1].children[0].textContent,/IMG_5293/);
  assert.equal(createGoalDrafts(one,storage).items[0].goalTimeSeconds,369.2);
  assert.equal(createGoalDrafts(two,storage).items[0].goalTimeSeconds,107.5);

  dom.goalStatsList.children[0].events.click();
  await Promise.resolve();
  assert.equal(dom.goalStatsPreview.currentTime,365.2);
  assert.equal(stats.loads,1);
  assert.equal(stats.plays,1);

  find(dom.goalStatsViewer,'play-btn goal-scene-replay').events.click();
  await Promise.resolve();
  assert.equal(stats.loads,1,'replaying same video must NOT reload source');
  assert.equal(stats.plays,2);

  find(dom.goalStatsEditor,'goal-review-confirm').events.click();
  await Promise.resolve();
  assert.equal(createGoalDrafts(one,storage).items[0].status,'confirmed');
  assert.equal(stats.loads,2,'next video requires exactly one source change');
  assert.equal(stats.plays,3);
  assert.equal(dom.goalStatsPreview.currentTime,103.5);
  assert.match(dom.goalStatsPlayingLabel.textContent,/IMG_5293/);

  find(dom.goalStatsEditor,'goal-review-confirm').events.click();
  await Promise.resolve();
  assert.equal(createGoalDrafts(two,storage).items[0].status,'confirmed');
  assert.equal(dom.goalStatsViewer.hidden,true);
  assert.match(dom.goalStatsStatus.textContent,/未確定候補はありません/);
  assert.equal(confirmedGoalExport([one,two],storage).goals.length,2);
  assert.equal(stats.competingPaused,3);
 }finally{restore()}
});
test('editing scorer does not reload current video and requires reconfirmation',async()=>{
 const {dom,one,stats,storage,restore}=setup();
 try{
  initGoalStatsReview({sources:[one]});
  dom.goalStatsList.children[0].events.click();await Promise.resolve();
  const loads=stats.loads;
  const scoreInput=find(dom.goalStatsEditor,'goal-review-field').children[1];
  scoreInput.value='若さん（確認）';
  scoreInput.events.change();
  assert.equal(stats.loads,loads);
  assert.equal(createGoalDrafts(one,storage).items[0].scorer,'若さん（確認）');
 }finally{restore()}
});


test('normal goal review keeps one standard player without debug controls',async()=>{
 const {dom,one,stats,restore}=setup();
 try{
  initGoalStatsReview({sources:[one]});
  dom.goalStatsList.children[0].events.click();
  await Promise.resolve();
  assert.equal(dom.goalStatsPreview.currentTime,365.2);
  assert.equal(stats.loads,1);
  find(dom.goalStatsViewer,'play-btn goal-scene-replay').events.click();
  await Promise.resolve();
  assert.equal(stats.loads,1);
  assert.equal(stats.plays,2);
 }finally{restore()}
});

test('goal preview has shared replay, pinch controls and colored trim/playhead instead of native-only video',async()=>{
 const {dom,one,restore}=setup();
 try{
  initGoalStatsReview({sources:[one]});
  dom.goalStatsList.children[0].events.click();
  await Promise.resolve();
  assert.equal(dom.goalStatsPreview.controls,false);
  assert.ok(find(dom.goalStatsViewer,'goal-scene-viewport zoom-video-viewport'));
  assert.ok(find(dom.goalStatsViewer,'scene-pinch-hint'));
  assert.ok(find(dom.goalStatsViewer,'range-track interactive-range'));
  assert.ok(find(dom.goalStatsViewer,'range-playhead'));
  assert.ok(find(dom.goalStatsViewer,'range-dot range-start range-handle'));
  assert.ok(find(dom.goalStatsViewer,'range-dot range-end range-handle'));
  assert.ok(find(dom.goalStatsViewer,'play-btn goal-scene-replay'));
  const labels=allLabels(dom.goalStatsEditor);
  assert.ok(labels.includes('得点者（ゴール）'));
  assert.ok(labels.includes('アシスト'));
  assert.ok(labels.includes('対戦カード'));
  assert.ok(labels.includes('SS試合番号（任意）'));
 }finally{restore()}
});
function allLabels(root){
 const result=[],queue=[root];
 while(queue.length){
  const node=queue.shift();
  if(node.tagName==='span'&&typeof node.textContent==='string')result.push(node.textContent);
  queue.push(...node.children);
 }
 return result;
}
test('goal trim handles and pinch gestures persist without changing the true goal timestamp',async()=>{
 const {dom,one,storage,restore}=setup();
 try{
  initGoalStatsReview({sources:[one]});
  dom.goalStatsList.children[0].events.click();
  await Promise.resolve();
  const viewer=dom.goalStatsViewer;
  const startField=find(viewer,'range-time');
  assert.ok(startField);
  startField.value='06:02.0';
  startField.events.change();
  let item=createGoalDrafts(one,storage).items[0];
  assert.equal(item.clipStartSeconds,362);
  assert.equal(item.goalTimeSeconds,369.2);
  const viewport=find(viewer,'goal-scene-viewport zoom-video-viewport');
  const point=(id,x)=>({pointerId:id,pointerType:'touch',clientX:x,clientY:90,preventDefault(){}});
  viewport.events.pointerdown(point(1,120));
  viewport.events.pointerdown(point(2,240));
  viewport.events.pointermove(point(1,90));
  viewport.events.pointermove(point(2,270));
  viewport.events.pointerup(point(1,90));
  viewport.events.pointerup(point(2,270));
  item=createGoalDrafts(one,storage).items[0];
  assert.ok(item.clipZoom>1);
  assert.equal(item.goalTimeSeconds,369.2);
 }finally{restore()}
});
test('scrub playhead release seeks once to chosen time and plays with the shared decoder',async()=>{
 const {dom,one,stats,restore}=setup();
 try{
  initGoalStatsReview({sources:[one]});
  dom.goalStatsList.children[0].events.click();await Promise.resolve();
  const track=find(dom.goalStatsViewer,'range-track interactive-range');
  assert.ok(track);
  const before=stats.loads,plays=stats.plays;
  const touch=(x)=>({pointerId:3,pointerType:'touch',clientX:x,button:0,preventDefault(){}});
  track.events.pointerdown(touch(160));
  track.events.pointermove(touch(240));
  track.events.pointerup(touch(240));
  await Promise.resolve();
  assert.equal(stats.loads,before);
  assert.equal(stats.plays,plays+1);
 }finally{restore()}
});
