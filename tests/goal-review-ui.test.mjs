import test from 'node:test';
import assert from 'node:assert/strict';
import {initGoalStatsReview} from '../goal-stats-ui.mjs';
import {createGoalDrafts,goalSourceKey,confirmedGoalExport} from '../goal-stats.mjs';
import {keepGoalClip,rejectGoalClip} from '../goal-video-clip.mjs';

const ids=[
 'goalStatsPanel','goalStatsList','goalStatsEditor','goalStatsSummary','goalStatsStep','goalStatsStatus',
 'goalStatsDone','goalStatsDoneText','goalStatsDoneToRegular','goalStatsDoneAdd','resultsPanel','standardReviewArea',
 'goalStatsPreview','goalStatsPlayingLabel','goalStatsViewer','goalStatsVideoStatus',
 'goalStatsAdd','goalStatsManualSource','goalStatsManualWrap','goalStatsExport',
 'goalStatsCopy','goalStatsShow','goalStatsJson','goalStatsJsonArea'
];
const settleMedia=async()=>{for(let i=0;i<10;i++)await Promise.resolve()};
function setup(){
 const stats={loads:0,plays:0,competingPaused:0};
 class Element{
  constructor(tag='div'){
   this.tagName=tag;this.className='';this.children=[];this.events={};this.listeners={};this.dataset={};
   this.value='';this.textContent='';this.hidden=false;this.disabled=false;
   this.readyState=0;this._currentTime=0;this.paused=true;
   this.seeking=false;
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
  get currentTime(){return this._currentTime}
  set currentTime(time){
   this._currentTime=time;
   if(this.readyState>=1 && this.events.seeked){
    this.seeking=true;
    queueMicrotask(()=>{this.seeking=false;this.events.seeked?.()});
   }
  }
  getBoundingClientRect(){return {left:0,top:0,width:360,height:203,right:360,bottom:203}}
  setPointerCapture(){}
  releasePointerCapture(){}
  setAttribute(){}
  removeAttribute(name){if(name==='src')this._src=''}
  scrollIntoView(){}
  focus(){}
  select(){}
  click(){this.events.click?.()}
  pause(){this.paused=true}
  set src(value){
   this._src=value;
   this.readyState=0;this.seeking=false;
   this._currentTime=0; // Browser resets media clock on src replacement.
   stats.loads++;
   queueMicrotask(()=>{
    this.readyState=1;
    this.events.loadedmetadata?.();
   });
  }
  get src(){return this._src}
  load(){stats.explicitLoads=(stats.explicitLoads||0)+1}
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
 return {dom,storage,one,two,stats,async restore(){
  // Drain seeked/play microtasks before releasing this fake DOM; otherwise
  // an old async seek might target the next test's document.
  await settleMedia();
  globalThis.document=previousDocument;globalThis.window=previousWindow;
 }};
}
function find(node,cls){
 const queue=[node];
 while(queue.length){
  const child=queue.shift();
  if(child.className===cls||(!cls.includes(' ')&&String(child.className).split(/\s+/).includes(cls)))return child;
  queue.push(...child.children);
 }
 return null;
}
test('first goal is immediately visible; score confirmation stays put; video judgment advances one decoder',async()=>{
 const {dom,storage,one,two,stats,restore}=setup();
 try{
  initGoalStatsReview({sources:[one,two]},{
   onBeforePlay:()=>stats.competingPaused++,
   onKeepClip:(src,item)=>Boolean(keepGoalClip(src,item)),
   onRejectClip:(src,item)=>rejectGoalClip(src,item)
  });
  await settleMedia();
  assert.equal(dom.goalStatsPanel.hidden,false);
  assert.equal(dom.goalStatsList.children.length,2);
  assert.match(dom.goalStatsList.children[0].children[0].textContent,/IMG_5292/);
  assert.match(dom.goalStatsList.children[1].children[0].textContent,/IMG_5293/);
  assert.equal(createGoalDrafts(one,storage).items[0].goalTimeSeconds,369.2);
  assert.equal(createGoalDrafts(two,storage).items[0].goalTimeSeconds,107.5);
  assert.equal(dom.goalStatsViewer.hidden,false,'video editor is open without queue tap');
  assert.equal(dom.goalStatsPreview.currentTime,0);
  assert.equal(dom.goalStatsPreview.hidden,true,'MOV remains unloaded before tapping Replay');
  assert.equal(stats.loads,0);
  assert.equal(stats.plays,0,'passive goal preview never decodes the MOV');
  assert.match(dom.goalStatsStep.textContent,/ゴール 1 \/ 2/);
  const replay=find(dom.goalStatsViewer,'play-btn goal-scene-replay');
  assert.ok(replay,'Replay button is visible on first candidate');
  replay.events.click();
  await settleMedia();
  assert.equal(stats.loads,1,'Replay must not reload the same source');
  assert.equal(stats.plays,1);
  find(dom.goalStatsEditor,'goal-review-confirm').events.click();
  assert.equal(createGoalDrafts(one,storage).items[0].status,'confirmed');
  assert.equal(stats.loads,1,'scorer confirmation must not skip unjudged video');
  assert.match(dom.goalStatsStep.textContent,/1 \/ 2/);

  find(dom.goalStatsEditor,'goal-review-video-keep').events.click();
  await settleMedia();
  assert.equal(createGoalDrafts(one,storage).items[0].videoDecision,'kept');
  assert.equal(stats.loads,2,'next goal loads only when its source changes');
  assert.equal(stats.plays,2,'next goal plays automatically after Keep tap');
  assert.equal(dom.goalStatsPreview.currentTime,112.5);
  assert.match(dom.goalStatsStep.textContent,/ゴール 2 \/ 2/);
  assert.match(dom.goalStatsPlayingLabel.textContent,/IMG_5293/);

  find(dom.goalStatsEditor,'goal-review-confirm').events.click();
  assert.equal(createGoalDrafts(two,storage).items[0].status,'confirmed');
  find(dom.goalStatsEditor,'goal-review-video-reject').events.click();
  await settleMedia();
  assert.equal(createGoalDrafts(two,storage).items[0].videoDecision,'rejected');
  assert.equal(dom.goalStatsViewer.hidden,false,'after last goal the editor stays available for replay');
  assert.match(dom.goalStatsStep.textContent,/動画判定完了/);
  assert.match(dom.goalStatsStatus.textContent,/全件判定済み/);
  assert.equal(dom.goalStatsDone.hidden,false);
  assert.match(dom.goalStatsDoneText.textContent,/2件の判定が完了/);
  assert.equal(confirmedGoalExport([one,two],storage).goals.length,2);
  assert.equal(stats.competingPaused,2);
 }finally{await restore()}
});
test('editing scorer does not reload current video and requires reconfirmation',async()=>{
 const {dom,one,stats,storage,restore}=setup();
 try{
  initGoalStatsReview({sources:[one]});
  dom.goalStatsList.children[0].events.click();await settleMedia();
  const loads=stats.loads;
  const scoreInput=find(dom.goalStatsEditor,'goal-review-field').children[1];
  scoreInput.value='若さん（確認）';
  scoreInput.events.change();
  assert.equal(stats.loads,loads);
  assert.equal(createGoalDrafts(one,storage).items[0].scorer,'若さん（確認）');
 }finally{await restore()}
});


test('first goal Replay is visible without loading its MOV until tapped',async()=>{
 const {dom,one,stats,restore}=setup();
 try{
  initGoalStatsReview({sources:[one]});
  await settleMedia();
  assert.equal(dom.goalStatsViewer.hidden,false);
  assert.equal(dom.goalStatsPreview.hidden,true,'Replay button is visible; MOV is lazy');
  assert.equal(dom.goalStatsPreview.currentTime,0);
  assert.equal(stats.loads,0);
  assert.equal(stats.plays,0);
  find(dom.goalStatsViewer,'play-btn goal-scene-replay').events.click();
  await settleMedia();
  assert.equal(stats.loads,1);
  assert.equal(stats.plays,1);
  assert.equal(dom.goalStatsPreview.currentTime,374.2);
 }finally{await restore()}
});

test('goal preview has shared replay, pinch controls and colored trim/playhead instead of native-only video',async()=>{
 const {dom,one,restore}=setup();
 try{
  initGoalStatsReview({sources:[one]});
  dom.goalStatsList.children[0].events.click();
  await settleMedia();
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
 }finally{await restore()}
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
  await settleMedia();
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
 }finally{await restore()}
});
test('scrub playhead release seeks once to chosen time and plays with the shared decoder',async()=>{
 const {dom,one,stats,restore}=setup();
 try{
  initGoalStatsReview({sources:[one]});
  dom.goalStatsList.children[0].events.click();await settleMedia();
  const track=find(dom.goalStatsViewer,'range-track interactive-range');
  assert.ok(track);
  const before=stats.loads,plays=stats.plays;
  const touch=(x)=>({pointerId:3,pointerType:'touch',clientX:x,button:0,preventDefault(){}});
  track.events.pointerdown(touch(160));
  track.events.pointermove(touch(240));
  track.events.pointerup(touch(240));
  await settleMedia();
  assert.equal(stats.loads,before);
  assert.equal(stats.plays,plays+1);
 }finally{await restore()}
});

test('video can be kept or rejected inside goal editor without second review',async()=>{
 const {dom,storage,one,restore}=setup();
 try{
  const calls={kept:0,rejected:0};
  initGoalStatsReview({sources:[one]},{
   onKeepClip:(source,item)=>{calls.kept++;return Boolean(keepGoalClip(source,item));},
   onRejectClip:(source,item)=>{calls.rejected++;return rejectGoalClip(source,item);}
  });
  dom.goalStatsList.children[0].events.click();
  await settleMedia();
  const keep=find(dom.goalStatsEditor,'goal-review-video-keep');
  const reject=find(dom.goalStatsEditor,'goal-review-video-reject');
  assert.ok(keep&&reject);
  assert.equal(find(dom.goalStatsEditor,'goal-review-keep-clip'),null);
  assert.equal(keep.disabled,false);
  assert.equal(createGoalDrafts(one,storage).items[0].status,'draft');
  keep.events.click();
  assert.equal(calls.kept,1);
  assert.equal(one.candidates.length,1);
  assert.equal(one.candidates[0].enabled,true);
  assert.equal(createGoalDrafts(one,storage).items[0].videoDecision,'kept');
  assert.equal(createGoalDrafts(one,storage).items[0].status,'draft',
   'scoring confirmation is independent of video acceptance');
  assert.equal(find(dom.goalStatsEditor,'goal-review-video-keep').className.includes('is-active'),true);
  find(dom.goalStatsEditor,'goal-review-video-reject').events.click();
  assert.equal(calls.rejected,1);
  assert.equal(one.candidates[0].enabled,false);
  assert.equal(one.candidates[0].rejected,true);
  assert.equal(createGoalDrafts(one,storage).items[0].videoDecision,'rejected');
  assert.equal(one.candidates.length,1);
  find(dom.goalStatsEditor,'goal-review-video-keep').events.click();
  assert.equal(one.candidates.length,1,'Keep after Reject reuses the same candidate');
  assert.equal(one.candidates[0].enabled,true);
 }finally{await restore()}
});
test('changing a kept goal crop updates the same export candidate immediately',async()=>{
 const {dom,storage,one,restore}=setup();
 try{
  const updates=[];
  initGoalStatsReview({sources:[one]},{
   onKeepClip:(source,item)=>Boolean(keepGoalClip(source,item)),
   onRejectClip:rejectGoalClip,
   onClipEdit:(source,item)=>{updates.push(item.clipStartSeconds);keepGoalClip(source,item);}
  });
  dom.goalStatsList.children[0].events.click();
  await settleMedia();
  find(dom.goalStatsEditor,'goal-review-video-keep').events.click();
  const input=find(dom.goalStatsViewer,'range-time');
  input.value='06:03.0';input.events.change();
  assert.deepEqual(updates,[363]);
  assert.equal(createGoalDrafts(one,storage).items[0].clipStartSeconds,363);
  assert.equal(one.candidates[0].time,363);
  assert.equal(one.candidates[0].manualEnd,381.2);
 }finally{await restore()}
});

test('goal section occurs directly below main Gemini analysis before regular highlights',async()=>{
 const {readFileSync}=await import('node:fs');
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const p1=html.indexOf('id="geminiPrimaryPanel"');
 const goals=html.indexOf('id="goalStatsPanel"');
 const oldTools=html.indexOf('id="geminiCalloutPanel"');
 const standard=html.indexOf('id="resultsPanel"');
 assert.ok(p1>=0&&p1<goals&&goals<oldTools&&goals<standard);
 assert.match(html,/id="goalStatsStep"/);
 assert.match(html,/class="goal-review-queue-fold"/);
 assert.ok(html.includes('id="goalStatsViewer" class="goal-review-viewer" hidden'),
   'video is initially hidden only until the first goal preview is selected');
});
test('after first video Reject, next candidate starts automatically; final view remains editable',async()=>{
 const {dom,one,two,storage,stats,restore}=setup();
 try{
  initGoalStatsReview({sources:[one,two]},{
   onRejectClip:(source,item)=>rejectGoalClip(source,item),
   onKeepClip:(source,item)=>Boolean(keepGoalClip(source,item))
  });
  await settleMedia();
  assert.equal(stats.loads,0);
  find(dom.goalStatsEditor,'goal-review-video-reject').events.click();
  await settleMedia();
  assert.equal(createGoalDrafts(one,storage).items[0].videoDecision,'rejected');
  assert.equal(stats.loads,1,'next goal is the first MOV decoded after Reject');
  assert.equal(stats.plays,1);
  assert.match(dom.goalStatsStep.textContent,/2 \/ 2/);
  find(dom.goalStatsEditor,'goal-review-video-keep').events.click();
  assert.equal(dom.goalStatsViewer.hidden,false);
  assert.equal(createGoalDrafts(two,storage).items[0].videoDecision,'kept');
  assert.match(dom.goalStatsStep.textContent,/動画判定完了/);
 }finally{await restore()}
});

test('only one detected goal: Keep shows explicit all-done state instead of a silent stuck screen',async()=>{
 const {dom,one,storage,restore}=setup();
 try{
  initGoalStatsReview({sources:[one]},{
   onKeepClip:(src,item)=>Boolean(keepGoalClip(src,item)),
   onRejectClip:(src,item)=>rejectGoalClip(src,item)
  });
  await settleMedia();
  assert.equal(dom.goalStatsDone.hidden,true);
  assert.match(dom.goalStatsStep.textContent,/1 \/ 1/);
  find(dom.goalStatsEditor,'goal-review-video-keep').events.click();
  assert.equal(createGoalDrafts(one,storage).items[0].videoDecision,'kept');
  assert.equal(dom.goalStatsDone.hidden,false);
  assert.match(dom.goalStatsDoneText.textContent,/1件の判定が完了.*残り0件/);
  assert.match(dom.goalStatsStep.textContent,/動画判定完了/);
  assert.equal(dom.goalStatsViewer.hidden,false,'can still review final saved goal');
  assert.ok(find(dom.goalStatsViewer,'play-btn goal-scene-replay'));
  assert.equal(dom.goalStatsDoneToRegular.hidden,false);
 }finally{await restore()}
});

test('Keep advances to next unjudged goal even when save callback synchronously triggers refresh',async()=>{
 const {dom,one,two,stats,storage,restore}=setup();
 try{
  let review;
  review=initGoalStatsReview({sources:[one,two]},{
   onKeepClip:(source,item)=>{
    if(!keepGoalClip(source,item))return false;
    review.refresh();
    return true;
   },
   onRejectClip:(source,item)=>{
    if(!rejectGoalClip(source,item))return false;
    review.refresh();
    return true;
   }
  });
  await settleMedia();
  const first=dom.goalStatsPlayingLabel.textContent;
  assert.match(first,/IMG_5292/);
  find(dom.goalStatsEditor,'goal-review-video-keep').events.click();
  await settleMedia();
  assert.equal(createGoalDrafts(one,storage).items[0].videoDecision,'kept');
  assert.match(dom.goalStatsPlayingLabel.textContent,/IMG_5293/);
  assert.match(dom.goalStatsStep.textContent,/ゴール 2 \/ 2/);
  assert.equal(stats.loads,1,'next goal alone loads a MOV when first was never replayed');
  find(dom.goalStatsEditor,'goal-review-video-reject').events.click();
  assert.equal(createGoalDrafts(two,storage).items[0].videoDecision,'rejected');
  assert.equal(dom.goalStatsDone.hidden,false);
  assert.match(dom.goalStatsDoneText.textContent,/2件の判定が完了/);
 }finally{await restore()}
});

test('goal editing timeline marks COMMENTARY and Replay starts 5sec before commentary',async()=>{
 const {dom,one,stats,restore}=setup();
 try{
  initGoalStatsReview({sources:[one]});
  await settleMedia();
  assert.equal(dom.goalStatsPreview.currentTime,0,'no pre-seek before Replay');
  const row=find(dom.goalStatsViewer,'range-legend');
  assert.ok(row);
  const labels=row.children.map(x=>x.textContent);
  assert.ok(labels.some(x=>x.includes('実況')&&x.includes('06:19.2')),
   'commentary marker represents 379.2 seconds, not the estimated goal at 369.2');
  const replay=find(dom.goalStatsViewer,'play-btn goal-scene-replay');
  replay.events.click();
  await settleMedia();
  assert.equal(dom.goalStatsPreview.currentTime,374.2);
  assert.equal(stats.plays,1);
 }finally{await restore()}
});

test('goal first-pass has no blank video; Safari native button is a usable playback fallback',async()=>{
 const {dom,one,stats,restore}=setup();
 try{
  initGoalStatsReview({sources:[one]});
  await settleMedia();
  const viewport=find(dom.goalStatsViewer,'goal-scene-viewport zoom-video-viewport');
  assert.ok(viewport);
  assert.equal(viewport.hidden,true,'do not show a blank MOV frame before Replay');
  assert.equal(stats.loads,0,'do not preload the iPhone MOV just to show goals');
  const native=find(dom.goalStatsViewer,'goal-native-playback');
  assert.ok(native);
  native.events.click();
  await settleMedia();
  assert.equal(viewport.hidden,false);
  assert.equal(dom.goalStatsPreview.controls,true);
  assert.equal(dom.goalStatsPreview.hidden,false);
  assert.equal(dom.goalStatsPreview.currentTime,374.2);
  assert.equal(stats.loads,1);
  assert.equal(stats.explicitLoads,1,'match highlight player using video.load()');
  assert.equal(stats.plays,0,'native Safari button does not silently autoplay');
 }finally{await restore()}
});
test('goal custom Replay also explicitly loads source only once on Safari',async()=>{
 const {dom,one,stats,restore}=setup();
 try{
  initGoalStatsReview({sources:[one]});
  const replay=find(dom.goalStatsViewer,'play-btn goal-scene-replay');
  assert.ok(replay);
  replay.events.click();
  await settleMedia();
  assert.equal(stats.loads,1);
  assert.equal(stats.explicitLoads,1);
  assert.equal(stats.plays,1);
  replay.events.click();
  await settleMedia();
  assert.equal(stats.loads,1);
  assert.equal(stats.explicitLoads,1);
  assert.equal(stats.plays,2);
 }finally{await restore()}
});

test('native Safari controls detach crop pointer capture, restore it for custom Replay',async()=>{
 const {dom,one,restore}=setup();
 try{
  initGoalStatsReview({sources:[one]});
  const viewport=find(dom.goalStatsViewer,'goal-scene-viewport zoom-video-viewport');
  const custom=find(dom.goalStatsViewer,'play-btn goal-scene-replay');
  const native=find(dom.goalStatsViewer,'goal-native-playback');
  assert.equal(typeof viewport.events.pointerdown,'function','custom editor has pinch handlers');
  native.events.click();
  await settleMedia();
  assert.equal(viewport.events.pointerdown,undefined,'no native-control taps intercepted');
  assert.equal(viewport.style.touchAction,'manipulation');
  assert.equal(dom.goalStatsPreview.style.transform,'none');
  assert.equal(dom.goalStatsPreview.controls,true);
  custom.events.click();
  await settleMedia();
  assert.equal(typeof viewport.events.pointerdown,'function','return to custom zoom restores handlers');
  assert.equal(viewport.style.touchAction,'');
  assert.equal(dom.goalStatsPreview.controls,false);
 }finally{await restore()}
});

test('adjust goal trim and pinch zoom, Keep, Replay: playback/export must retain the edits',async()=>{
 const {dom,storage,one,stats,restore}=setup();
 try{
  initGoalStatsReview({sources:[one]},{
   onKeepClip:(src,item)=>Boolean(keepGoalClip(src,item)),
   onRejectClip:(src,item)=>rejectGoalClip(src,item),
   onClipEdit:(src,item)=>keepGoalClip(src,item)
  });
  // This queue click previously mounted a NEW scene object while the Keep
  // button remained bound to the previous rendered object.
  dom.goalStatsList.children[0].events.click();
  await settleMedia();
  const viewer=dom.goalStatsViewer;
  const controls=find(viewer,'range-inputs');
  assert.ok(controls);
  const beginning=controls.children[0].children[1];
  const ending=controls.children[1].children[1];
  beginning.value='06:02.0';beginning.events.change();
  ending.value='06:28.0';ending.events.change();
  const viewport=find(viewer,'goal-scene-viewport zoom-video-viewport');
  const touch=(pointerId,x)=>({pointerId,pointerType:'touch',clientX:x,clientY:90,preventDefault(){}});
  viewport.events.pointerdown(touch(1,120));
  viewport.events.pointerdown(touch(2,240));
  viewport.events.pointermove(touch(1,70));
  viewport.events.pointermove(touch(2,300));
  viewport.events.pointerup(touch(1,70));
  viewport.events.pointerup(touch(2,300));
  const adjusted=createGoalDrafts(one,storage).items[0];
  assert.equal(adjusted.clipStartSeconds,362);
  assert.equal(adjusted.clipEndSeconds,388);
  assert.ok(adjusted.clipZoom>1);
  const savedZoom=adjusted.clipZoom,savedX=adjusted.clipZoomX,savedY=adjusted.clipZoomY;
  find(dom.goalStatsEditor,'goal-review-video-keep').events.click();
  let kept=createGoalDrafts(one,storage).items[0];
  assert.equal(kept.videoDecision,'kept');
  assert.equal(kept.clipStartSeconds,362);
  assert.equal(kept.clipEndSeconds,388);
  assert.equal(kept.clipZoom,savedZoom);
  assert.equal(kept.clipZoomX,savedX);
  assert.equal(kept.clipZoomY,savedY);
  assert.equal(one.candidates.length,1);
  assert.equal(one.candidates[0].time,362);
  assert.equal(one.candidates[0].manualEnd,388);
  assert.equal(one.candidates[0].zoom,savedZoom);
  const replay=find(viewer,'play-btn goal-scene-replay');
  replay.events.click();
  await settleMedia();
  kept=createGoalDrafts(one,storage).items[0];
  assert.equal(dom.goalStatsPreview.currentTime,362);
  assert.equal(kept.clipStartSeconds,362);
  assert.equal(kept.clipEndSeconds,388);
  assert.equal(kept.clipZoom,savedZoom);
  assert.match(find(viewer,'range-start-label').textContent,/06:02/);
  assert.match(find(viewer,'range-end-label').textContent,/06:28/);
  assert.ok(stats.plays>=2);
 }finally{await restore()}
});
test('Keep on first video auto-advances, reopening it preserves start/end and crop',async()=>{
 const {dom,storage,one,two,restore}=setup();
 try{
  initGoalStatsReview({sources:[one,two]},{
   onKeepClip:(src,item)=>Boolean(keepGoalClip(src,item)),
   onRejectClip:(src,item)=>rejectGoalClip(src,item),
   onClipEdit:(src,item)=>keepGoalClip(src,item)
  });
  dom.goalStatsList.children[0].events.click();
  await settleMedia();
  const input=find(dom.goalStatsViewer,'range-inputs').children[0].children[1];
  input.value='06:00.0';input.events.change();
  let saved=createGoalDrafts(one,storage).items[0];
  assert.equal(saved.clipStartSeconds,360);
  find(dom.goalStatsEditor,'goal-review-video-keep').events.click();
  await settleMedia();
  assert.match(dom.goalStatsStep.textContent,/ゴール 2 \/ 2/);
  assert.equal(createGoalDrafts(one,storage).items[0].clipStartSeconds,360);
  dom.goalStatsList.children[0].events.click();
  await settleMedia();
  const replay=find(dom.goalStatsViewer,'play-btn goal-scene-replay');
  replay.events.click();
  await settleMedia();
  assert.equal(dom.goalStatsPreview.currentTime,360);
  assert.equal(createGoalDrafts(one,storage).items[0].clipStartSeconds,360);
  assert.equal(one.candidates[0].time,360);
 }finally{await restore()}
});
test('replaying before Keep never changes the editor object or discards subsequent edits',async()=>{
 const {dom,storage,one,restore}=setup();
 try{
  initGoalStatsReview({sources:[one]},{
   onKeepClip:(src,item)=>Boolean(keepGoalClip(src,item)),
   onClipEdit:(src,item)=>keepGoalClip(src,item)
  });
  dom.goalStatsList.children[0].events.click();
  await settleMedia();
  find(dom.goalStatsViewer,'play-btn goal-scene-replay').events.click();
  await settleMedia();
  const start=find(dom.goalStatsViewer,'range-inputs').children[0].children[1];
  start.value='06:01.0';start.events.change();
  assert.equal(createGoalDrafts(one,storage).items[0].clipStartSeconds,361);
  find(dom.goalStatsEditor,'goal-review-video-keep').events.click();
  assert.equal(createGoalDrafts(one,storage).items[0].clipStartSeconds,361);
  find(dom.goalStatsViewer,'play-btn goal-scene-replay').events.click();
  await settleMedia();
  assert.equal(dom.goalStatsPreview.currentTime,361);
  assert.equal(one.candidates[0].time,361);
 }finally{await restore()}
});
