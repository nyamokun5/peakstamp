import test from 'node:test';
import assert from 'node:assert/strict';
import {initGoalStatsReview} from '../goal-stats-ui.mjs';
import {createGoalDrafts,goalSourceKey,confirmedGoalExport} from '../goal-stats.mjs';

const ids=[
 'goalStatsPanel','goalStatsList','goalStatsEditor','goalStatsSummary','goalStatsStatus',
 'goalStatsPreview','goalStatsPlayingLabel','goalStatsViewer','goalStatsVideoStatus',
 'goalStatsAdd','goalStatsManualSource','goalStatsManualWrap','goalStatsExport',
 'goalStatsCopy','goalStatsShow','goalStatsJson','goalStatsJsonArea',
 'goalStatsPrepare','goalStatsPlayFromStart','goalStatsPlayEarlier','goalStatsNativeFullscreen','goalStatsCopyDebug','goalStatsDebugOutput'
];
function setup(){
 const stats={loads:0,plays:0,competingPaused:0};
 class Element{
  constructor(tag='div'){
   this.tagName=tag;this.className='';this.children=[];this.events={};this.dataset={};
   this.value='';this.textContent='';this.hidden=false;this.disabled=false;
   this.readyState=0;this.currentTime=0;this.paused=true;
  }
  append(...items){this.children.push(...items)}
  replaceChildren(...items){this.children=items}
  addEventListener(name,handler){this.events[name]=handler}
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
 globalThis.window={localStorage:storage,prompt:()=>null};
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
  assert.equal(dom.goalStatsPreview.currentTime,359.2);
  assert.equal(stats.loads,1);
  assert.equal(stats.plays,1);

  find(dom.goalStatsEditor,'goal-review-play').events.click();
  await Promise.resolve();
  assert.equal(stats.loads,1,'replaying same video must NOT reload source');
  assert.equal(stats.plays,2);

  find(dom.goalStatsEditor,'goal-review-confirm').events.click();
  await Promise.resolve();
  assert.equal(createGoalDrafts(one,storage).items[0].status,'confirmed');
  assert.equal(stats.loads,2,'next video requires exactly one source change');
  assert.equal(stats.plays,3);
  assert.equal(dom.goalStatsPreview.currentTime,97.5);
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

test('goal recovery UI can restart from beginning and expose copyable diagnostics',async()=>{
 const {dom,one,stats,restore}=setup();
 try{
  initGoalStatsReview({sources:[one]});
  dom.goalStatsList.children[0].events.click();
  await Promise.resolve();
  assert.equal(dom.goalStatsPreview.currentTime,359.2);
  assert.equal(stats.loads,1);
  dom.goalStatsPlayFromStart.events.click();
  await Promise.resolve();
  assert.equal(dom.goalStatsPreview.currentTime,0,'fallback restarts at the beginning without deep seek');
  assert.equal(stats.loads,2,'fallback intentionally resets only the active media resource');
  await dom.goalStatsCopyDebug.events.click();
  const details=JSON.parse(dom.goalStatsDebugOutput.value);
  assert.equal(details.targetTime,0);
  assert.equal(details.fromBeginning,true);
  assert.equal(details.player,'PeakStamp goal playback v44');
  assert.equal(details.selectedCommentTime,379.2);
 }finally{restore()}
});

test('compare same MOV from 30 seconds before goal to isolate a time-specific stall',async()=>{
 const {dom,one,stats,restore}=setup();
 try{
  initGoalStatsReview({sources:[one]});
  dom.goalStatsList.children[0].events.click();
  await Promise.resolve();
  assert.equal(dom.goalStatsPreview.currentTime,359.2);
  assert.equal(stats.loads,1);
  dom.goalStatsPlayEarlier.events.click();
  await Promise.resolve();
  assert.equal(dom.goalStatsPreview.currentTime,339.2);
  assert.equal(stats.loads,1,'same MOV comparison reuses the current player and source');
  await dom.goalStatsCopyDebug.events.click();
  const info=JSON.parse(dom.goalStatsDebugOutput.value);
  assert.equal(info.targetTime,339.2);
 }finally{restore()}
});

test('native iPhone fullscreen video is available as an explicit user-tap comparison',async()=>{
 const {dom,one,stats,restore}=setup();
 try{
  initGoalStatsReview({sources:[one]});
  dom.goalStatsList.children[0].events.click();
  await Promise.resolve();
  dom.goalStatsNativeFullscreen.events.click();
  assert.equal(stats.nativeFullscreen,1);
  assert.equal(stats.loads,1,'native fullscreen must reuse selected MOV without copying bytes');
 }finally{restore()}
});
