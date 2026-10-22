import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoalPlaybackController} from '../goal-playback.mjs';

/** Safari-like fixture: changing src resets to 0, and deep MOV seeks
 * complete asynchronously. It NEVER delivers an actual frame immediately
 * simply because a currentTime setter was called. */
function fixture({autoMetadata=true,autoSeek=true}={}){
 const calls={plays:0,pauses:0,loads:0,events:[],messages:[],before:0};
 const listeners=new Map();
 const timers=new Map();let timerId=0;
 const video={
  hidden:true,paused:true,seeking:false,readyState:0,duration:450,
  currentTime:0,preload:'metadata',_src:'',
  setAttribute(){},removeAttribute(name){if(name==='src')this._src=''},
  load(){calls.loads++;this.readyState=0},
  pause(){calls.pauses++;this.paused=true},
  addEventListener(name,fn){
   if(!listeners.has(name))listeners.set(name,[]);
   listeners.get(name).push(fn);
  },
  play(){
   calls.plays++;
   if(calls.failNext){const e=calls.failNext;calls.failNext=null;return Promise.reject(e)}
   if(calls.resetOnPlay){
    calls.resetOnPlay=false;this.currentTime=0;
   }
   this.paused=false;
   fire('playing');
   return Promise.resolve();
  }
 };
 let position=0;
 Object.defineProperty(video,'currentTime',{
  get(){return position},
  set(value){
   position=value;
   if(video.readyState>=1){
    video.seeking=true;
    calls.events.push('seek:'+Number(value).toFixed(1));
    if(autoSeek)queueMicrotask(()=>{video.seeking=false;fire('seeked')});
   }
  }
 });
 Object.defineProperty(video,'src',{
  get(){return this._src},
  set(value){
   this._src=value;this.readyState=0;this.seeking=false;
   position=0;calls.events.push('src:'+value);
   if(autoMetadata)queueMicrotask(()=>{this.readyState=1;fire('loadedmetadata')});
  }
 });
 const fire=name=>{calls.events.push(name);for(const fn of listeners.get(name)||[])fn()};
 const controller=createGoalPlaybackController(video,{
  notify:msg=>calls.messages.push(msg),
  beforePlay:()=>calls.before++,
  schedule:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id},
  cancel:id=>timers.delete(id)
 });
 const flush=async()=>{for(let i=0;i<9;i++)await Promise.resolve()};
 return {video,calls,controller,fire,flush,timers,
  triggerTimer(){
   const entries=[...timers.entries()];
   if(!entries.length)return;
   const [id,x]=entries[0];timers.delete(id);x.fn();
  }
 };
}
test('initial goal preview loads and seeks into clip without ever playing at source t=0',async()=>{
 const {video,calls,controller,flush}=fixture();
 controller.open({sourceKey:'IMG_5292',sourceUrl:'blob:large-mov',at:365.2,autoplay:false});
 assert.equal(video.src,'blob:large-mov');
 assert.equal(video.currentTime,0,'before metadata no pretend seek');
 assert.equal(calls.plays,0);
 await flush();
 assert.equal(video.currentTime,365.2);
 assert.equal(controller.diagnostic().phase,'ready');
 assert.equal(controller.diagnostic().prepared,true);
 assert.equal(calls.plays,0);
 assert.equal(calls.before,0);
});
test('Replay uses already prepared goal timestamp, not 0, in the same user tap',async()=>{
 const {video,calls,controller,flush}=fixture();
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:365.2,autoplay:false});
 await flush();
 let playedAt=null;
 video.play=function(){
  calls.plays++;playedAt=this.currentTime;this.paused=false;return Promise.resolve();
 };
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:365.2,autoplay:true});
 assert.equal(playedAt,365.2);
 assert.equal(calls.plays,1);
 assert.equal(calls.before,1);
 assert.equal(controller.diagnostic().targetTime,365.2);
});
test('Replay on a different MOV waits for loadedmetadata and completed seek BEFORE play',async()=>{
 const {video,calls,controller,flush}=fixture();
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:365.2,autoplay:false});
 await flush();
 controller.open({sourceKey:'B',sourceUrl:'blob:b',at:103.5,autoplay:true});
 assert.equal(calls.plays,0,'never launch a new source at 0 before metadata');
 assert.equal(video.currentTime,0);
 await flush();
 assert.equal(video.currentTime,103.5);
 assert.equal(calls.plays,1);
 assert.equal(controller.diagnostic().targetTime,103.5);
 assert.equal(calls.before,1);
});
test('pressing Replay before slow MOV metadata is loaded still never plays from zero',async()=>{
 const {video,calls,controller,fire,flush}=fixture({autoMetadata:false});
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:310,autoplay:true});
 assert.equal(calls.plays,0);
 assert.equal(video.currentTime,0);
 assert.match(calls.messages.join(' '),/読み込み/);
 video.readyState=1;fire('loadedmetadata');
 assert.equal(calls.plays,0,'pending deep seek must finish first');
 await flush();
 assert.equal(calls.plays,1);
 assert.equal(video.currentTime,310);
});
test('when Safari changes the media clock back to 0 on play, stop and re-seek before retry',async()=>{
 const {video,calls,controller,flush}=fixture();
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:359.2,autoplay:false});
 await flush();
 video.currentTime=359.2;await flush();
 calls.resetOnPlay=true;
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:359.2,autoplay:true});
 await flush();
 assert.equal(calls.plays,2,'first incorrect attempt is interrupted, then re-played from goal');
 assert.equal(video.currentTime,359.2);
 assert.equal(controller.diagnostic().phase,'playing');
 assert.equal(controller.diagnostic().targetTime,359.2);
});
test('deep seek that never finishes never falls through to zero-time playback',()=>{
 const {controller,calls,video,fire,triggerTimer}=fixture({autoMetadata:false,autoSeek:false});
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:200,autoplay:true});
 video.readyState=1;fire('loadedmetadata');
 assert.equal(video.seeking,true);
 triggerTimer();
 assert.equal(calls.plays,0);
 assert.equal(controller.diagnostic().phase,'seek-failed');
 assert.match(calls.messages.at(-1),/0秒からは再生しません/);
});
test('Safari NotAllowedError leaves prepared goal and requests a second explicit Replay tap',async()=>{
 const {controller,calls,video,flush}=fixture();
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:102,autoplay:false});
 await flush();
 calls.failNext={name:'NotAllowedError'};
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:102,autoplay:true});
 await flush();
 assert.equal(calls.plays,1);
 assert.equal(controller.diagnostic().gestureNeeded,true);
 assert.match(calls.messages.at(-1),/もう一度押して/);
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:102,autoplay:true});
 await flush();
 assert.equal(calls.plays,2);
 assert.equal(video.currentTime,102);
});
test('manually changed goal cut start is respected on every new Replay',async()=>{
 const {video,calls,controller,flush}=fixture();
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:100,autoplay:false});
 await flush();
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:95.5,autoplay:true});
 await flush();
 assert.equal(controller.diagnostic().targetTime,95.5);
 assert.equal(video.currentTime,95.5);
 assert.equal(calls.plays,1);
});
test('switching video files reuses one media element; failed/stale sessions never start later',async()=>{
 const {video,controller,calls,flush}=fixture();
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:200,autoplay:true});
 controller.open({sourceKey:'B',sourceUrl:'blob:b',at:40,autoplay:false});
 await flush();
 assert.equal(video.src,'blob:b');
 assert.equal(video.currentTime,40);
 assert.equal(calls.plays,0,'stale A pending autoplay cancelled by B preview');
 assert.equal(controller.currentSourceKey(),'B');
 controller.pause();
 controller.dispose();
 assert.equal(controller.currentSourceKey(),'');
 assert.equal(video.hidden,true);
 assert.equal(calls.loads,1);
});
test('explicit fromStart remains opt-in, never used by goal UI',async()=>{
 const {video,controller,calls,flush}=fixture();
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:359,autoplay:true,fromStart:true});
 await flush();
 assert.equal(video.currentTime,0);
 assert.equal(controller.diagnostic().targetTime,0);
 assert.equal(calls.plays,1);
});

test('loadeddata/canplay do not count as completion of a delayed deep goal seek',async()=>{
 const {video,calls,controller,fire,flush}=fixture({autoMetadata:false,autoSeek:false});
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:365.2,autoplay:true});
 video.readyState=1;fire('loadedmetadata');
 assert.equal(video.seeking,true);
 video.seeking=false;
 video.readyState=3;
 fire('loadeddata');fire('canplay');
 await flush();
 assert.equal(calls.plays,0,'must not play merely because video data became available');
 assert.equal(controller.diagnostic().awaitSeek,true);
 fire('seeked');
 await flush();
 assert.equal(calls.plays,1);
 assert.equal(video.currentTime,365.2);
});
test('pressing Replay while the initial paused preview is still seeking preserves the pending seek',async()=>{
 const {video,calls,controller,fire,flush}=fixture({autoMetadata:false,autoSeek:false});
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:365.2,autoplay:false});
 video.readyState=1;fire('loadedmetadata');
 assert.equal(controller.diagnostic().awaitSeek,true);
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:365.2,autoplay:true});
 assert.equal(calls.plays,0);
 assert.equal(controller.diagnostic().awaitSeek,true);
 video.seeking=false;fire('seeked');
 await flush();
 assert.equal(video.currentTime,365.2);
 assert.equal(calls.plays,1);
});
