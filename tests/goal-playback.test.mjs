import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoalPlaybackController} from '../goal-playback.mjs';

function setup(){
 const calls={plays:0,loads:0,paused:0,logs:[],before:0};
 const events=new Map();
 const video={
  hidden:true,paused:true,seeking:false,readyState:0,currentTime:0,
  error:null,preload:'metadata',src:'',
  setAttribute(){},
  addEventListener(name,fn){events.set(name,fn)},
  pause(){this.paused=true;calls.paused++},
  load(){calls.loads++},
  removeAttribute(name){if(name==='src')this.src=''},
  play(){
   calls.plays++;
   if(calls.nextFailure){
    const e=calls.nextFailure;calls.nextFailure=null;
    return Promise.reject(e);
   }
   this.paused=false;
   return Promise.resolve();
  }
 };
 const playback=createGoalPlaybackController(video,{
  notify:x=>calls.logs.push(x),beforePlay:()=>calls.before++
 });
 return {calls,events,video,playback,fire:(type)=>events.get(type)?.()};
}
const tick=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve()};
test('show before source assignment, wait for new metadata, and invoke play from click',async()=>{
 const {calls,video,playback,fire}=setup();
 playback.open({sourceKey:'A',sourceUrl:'blob:a',at:359.2,autoplay:true});
 assert.equal(video.hidden,false);
 assert.equal(video.src,'blob:a');
 assert.equal(video.preload,'auto');
 assert.equal(calls.plays,1);
 assert.equal(calls.before,1);
 assert.equal(calls.loads,0);
 assert.equal(video.currentTime,0);
 video.readyState=1;fire('loadedmetadata');
 assert.equal(video.currentTime,359.2);
 await tick();
 playback.open({sourceKey:'A',sourceUrl:'blob:a',at:360,autoplay:true});
 assert.equal(calls.plays,2);
 assert.equal(calls.loads,0);
 assert.equal(video.src,'blob:a');
 assert.equal(video.currentTime,360);
 playback.open({sourceKey:'B',sourceUrl:'blob:b',at:97.5,autoplay:true});
 assert.equal(video.src,'blob:b');
 assert.equal(video.currentTime,360,'old metadata must not be used on source change');
 fire('loadedmetadata');
 assert.equal(video.currentTime,97.5);
});
test('AbortError on initial play is retried after seeked/canplay, not in a tight loop',async()=>{
 const {calls,video,playback,fire}=setup();
 calls.nextFailure={name:'AbortError',message:'interrupted'};
 playback.open({sourceKey:'A',sourceUrl:'blob:a',at:100,autoplay:true});
 assert.equal(calls.plays,1);
 await tick();
 assert.equal(calls.plays,1,'do not retry until metadata/canplay');
 video.readyState=1;video.seeking=true;fire('loadedmetadata');
 video.readyState=3;fire('canplay');
 assert.equal(calls.plays,1,'do not retry while seeking');
 video.seeking=false;fire('seeked');
 assert.equal(calls.plays,2,'retry after seek finishes');
 await tick();
 assert.equal(video.paused,false);
 assert.match(calls.logs.join(' '),/再生を再試行/);
});
test('NotAllowedError leaves native controls usable without automatic retry',async()=>{
 const {calls,video,playback,fire}=setup();
 calls.nextFailure={name:'NotAllowedError'};
 playback.open({sourceKey:'A',sourceUrl:'blob:a',at:5,autoplay:true});
 await tick();
 video.readyState=3;fire('loadedmetadata');fire('canplay');
 assert.equal(calls.plays,1);
 assert.match(calls.logs.at(-1),/▶/);
 assert.equal(video.hidden,false);
 playback.open({sourceKey:'A',sourceUrl:'blob:a',at:4,autoplay:true});
 await tick();
 assert.equal(calls.plays,2,'direct second tap can try again');
});
test('file or codec problems show specific diagnostic instead of silent failure',async()=>{
 const {calls,video,playback,fire}=setup();
 playback.open({sourceKey:'A',sourceUrl:'blob:a',at:10,autoplay:false});
 video.error={code:4};
 fire('error');
 assert.match(calls.logs.at(-1),/MOVの形式/);
 playback.pause();
 assert.equal(video.paused,true);
 playback.dispose();
 assert.equal(calls.loads,1,'load is only used when clearing src');
 assert.equal(playback.currentSourceKey(),'');
});


test('a successful initial play still recovers if Safari pauses during deep seek',async()=>{
 const {calls,video,playback,fire}=setup();
 playback.open({sourceKey:'A',sourceUrl:'blob:a',at:359.2,autoplay:true});
 await tick();
 assert.equal(calls.plays,1);
 video.readyState=1;video.seeking=true;
 fire('loadedmetadata');
 video.pause();
 video.readyState=3;video.seeking=false;
 fire('seeked');
 assert.equal(calls.plays,2,'resume playback after Safari pauses during a deep seek');
 assert.equal(playback.diagnostic().targetTime,359.2);
});
test('normal playback fallback skips deep seek and diagnostics describe browser state',async()=>{
 const {calls,video,playback,fire}=setup();
 playback.open({sourceKey:'A',sourceUrl:'blob:a',at:359.2,autoplay:true,fromStart:true});
 assert.equal(calls.plays,1);
 assert.equal(video.currentTime,0);
 assert.equal(playback.diagnostic().fromBeginning,true);
 assert.equal(playback.diagnostic().targetTime,0);
 video.readyState=1;fire('loadedmetadata');
 assert.equal(video.currentTime,0,'fallback must not jump into the long MOV');
 video.readyState=3;
 video.buffered={length:1,start:()=>0,end:()=>20};
 video.seekable={length:1,start:()=>0,end:()=>450};
 video.videoWidth=1920;video.videoHeight=1080;
 fire('playing');
 const out=playback.diagnostic();
 assert.equal(out.videoSize[0],1920);
 assert.equal(out.buffered[0][1],20);
 assert.equal(out.seekable[0][1],450);
 assert.equal(out.lastEvent,'playing');
 playback.pause();
});
test('the diagnostic keeps a concise list of media events without copying video bytes',()=>{
 const {playback,video,fire}=setup();
 playback.open({sourceKey:'A',sourceUrl:'blob:a',at:30,autoplay:false});
 fire('waiting');fire('stalled');
 const data=playback.diagnostic();
 assert.match(data.lastMessage,/動画画面の▶で再開してください/);
 assert.equal(Array.isArray(data.events),true);
 assert.equal(JSON.stringify(data).includes('blob:a'),false);
 assert.equal(data.events.at(-1).event,'stalled');
 playback.pause();
});

test('actual frame presentation is tracked separately from media currentTime',async()=>{
 const {video,playback,fire}=setup();
 const callbacks=new Map();
 let nextId=0;
 video.requestVideoFrameCallback=cb=>{const id=++nextId;callbacks.set(id,cb);return id;};
 video.cancelVideoFrameCallback=id=>callbacks.delete(id);
 // Controller must be initialized AFTER requestVideoFrameCallback exists.
 const controller=createGoalPlaybackController(video,{notify:()=>{}});
 controller.open({sourceKey:'B',sourceUrl:'blob:b',at:359.7,autoplay:true});
 await tick();
 let diag=controller.diagnostic();
 assert.equal(diag.frameDiagnostics.supported,true);
 assert.equal(diag.frameDiagnostics.decodedFrames,0);
 video.currentTime=366.3;
 assert.equal(controller.diagnostic().frameDiagnostics.decodedFrames,0,
  'media clock advancing does not prove a frame was presented');
 const firstId=Math.min(...callbacks.keys());
 const cb=callbacks.get(firstId);
 callbacks.delete(firstId);
 cb(1234,{mediaTime:366.3,presentedFrames:80});
 diag=controller.diagnostic();
 assert.equal(diag.frameDiagnostics.decodedFrames,1);
 assert.equal(diag.frameDiagnostics.lastFrameMediaTime,366.3);
 assert.equal(diag.frameDiagnostics.lastFramePresentedCount,80);
 assert.equal(diag.frameDiagnostics.firstFrameDelayMs>=0,true);
 assert.equal(callbacks.size,1);
 controller.pause();
 assert.equal(callbacks.size,0,'pause cancels video frame callbacks');
});
test('Safari playback-quality counters are copied into diagnostics when available',()=>{
 const {video,playback}=setup();
 video.getVideoPlaybackQuality=()=>({
  totalVideoFrames:210,droppedVideoFrames:7,corruptedVideoFrames:0
 });
 const d=playback.diagnostic();
 assert.equal(d.frameDiagnostics.quality.totalVideoFrames,210);
 assert.equal(d.frameDiagnostics.quality.droppedVideoFrames,7);
});


function frameFixture(){
 const calls={now:1000,watchdog:null,frames:new Map(),logs:[],id:0};
 const listeners=new Map();
 const video={
  readyState:4,paused:true,seeking:false,currentTime:0,networkState:1,src:'',
  setAttribute(){},removeAttribute(){},load(){},pause(){this.paused=true;},
  play(){this.paused=false;return Promise.resolve();},
  addEventListener(name,fn){listeners.set(name,fn)},
  requestVideoFrameCallback(fn){
   const id=++calls.id;calls.frames.set(id,fn);return id;
  },
  cancelVideoFrameCallback(id){calls.frames.delete(id);}
 };
 const controller=createGoalPlaybackController(video,{
  notify:message=>calls.logs.push(message),now:()=>calls.now,
  scheduleWatchdog:fn=>{
   calls.watchdog=fn;return {unref(){}};
  },
  cancelWatchdog:()=>{calls.watchdog=null;}
 });
 const fire=(name)=>listeners.get(name)?.();
 const deliverFrame=(mediaTime)=>{
  const id=[...calls.frames.keys()][0];
  assert.notEqual(id,undefined);
  const callback=calls.frames.get(id);calls.frames.delete(id);
  callback(0,{mediaTime,presentedFrames:100});
 };
 return {calls,video,controller,fire,deliverFrame};
}
test('a freeze from an earlier attempt must never be marked recovered on a new seek',async()=>{
 const {calls,video,controller,fire,deliverFrame}=frameFixture();
 controller.open({sourceKey:'same',sourceUrl:'blob:x',at:359.7,autoplay:true});
 fire('playing');await tick();
 video.currentTime=361.1;
 calls.now+=4100;
 calls.watchdog();
 let diag=controller.diagnostic();
 assert.equal(diag.frameFreezeHistory.length,1);
 assert.equal(diag.frameFreezeHistory[0].recoveredAfterMs,null);
 assert.equal(diag.freezeCurrentlySuspected,true);
 const prevAttempt=diag.activeAttemptId;
 controller.open({sourceKey:'same',sourceUrl:'blob:x',at:359.7,autoplay:true});
 video.currentTime=359.7;
 deliverFrame(359.7);
 diag=controller.diagnostic();
 assert.equal(diag.frameFreezeHistory[0].attemptId,prevAttempt);
 assert.equal(diag.frameFreezeHistory[0].endedReason,'new-playback-attempt');
 assert.equal(diag.frameFreezeHistory[0].recoveredAfterMs,null);
 assert.equal(diag.freezeCurrentlySuspected,false);
 assert.equal(diag.frameDiagnostics.decodedFrames,1);
 controller.pause();
});
test('ongoing watchdog detects a fresh freeze after frames have already rendered',async()=>{
 const {calls,video,controller,fire,deliverFrame}=frameFixture();
 controller.open({sourceKey:'same',sourceUrl:'blob:y',at:300,autoplay:true});
 fire('playing');await tick();
 calls.now+=200;
 video.currentTime=300.2;deliverFrame(300.2);
 calls.now+=3600;video.currentTime=304.3;
 calls.watchdog();
 let diag=controller.diagnostic();
 assert.equal(diag.frameFreezeHistory.length,1);
 assert.equal(diag.frameFreezeHistory[0].reason,'frame-watchdog');
 assert.equal(diag.frameFreezeHistory[0].framesAtDetection,1);
 assert.equal(diag.freezeCurrentlySuspected,true);
 calls.now+=450;
 video.currentTime=304.7;deliverFrame(304.7);
 diag=controller.diagnostic();
 assert.equal(diag.frameFreezeHistory[0].endedReason,'frames-resumed');
 assert.equal(diag.frameFreezeHistory[0].recoveredAfterMs,450);
 assert.equal(diag.freezeCurrentlySuspected,false);
 assert.equal(diag.frameDiagnostics.decodedFrames,2);
 controller.pause();
});

test('repeat freeze position groups two independent attempts around the same decoded/keyframe boundary',async()=>{
 const {calls,video,controller,fire,deliverFrame}=frameFixture();
 for(let n=0;n<2;n++){
  controller.open({sourceKey:'IMG_5292',sourceUrl:'blob:x',at:359.7,autoplay:true});
  fire('playing');await tick();
  video.currentTime=n===0?361.1:361.5;
  calls.now+=4200;
  calls.watchdog();
 }
 const diag=controller.diagnostic();
 assert.equal(diag.frameFreezeHistory.length,2);
 assert.equal(diag.frameFreezeHistory[0].recoveredAfterMs,null);
 assert.equal(diag.frameFreezeHistory[0].endedReason,'new-playback-attempt');
 assert.equal(diag.frameFreezeHistory[0].suspectedMediaPosition,359.7);
 assert.equal(diag.frameFreezeHistory[1].suspectedMediaPosition,359.7);
 assert.equal(diag.repeatFreezeLocations.length,1);
 assert.equal(diag.repeatFreezeLocations[0].repeatAcrossAttempts,true);
 assert.equal(diag.repeatFreezeLocations[0].attempts.length,2);
 controller.pause();
});
test('freeze anchor tracks most recently displayed frame rather than progressing audio clock',async()=>{
 const {calls,video,controller,fire,deliverFrame}=frameFixture();
 controller.open({sourceKey:'IMG_5292',sourceUrl:'blob:x',at:359.7,autoplay:true});
 fire('playing');await tick();
 calls.now+=200;
 video.currentTime=360.1;deliverFrame(360.1);
 calls.now+=4000;video.currentTime=364.5;
 calls.watchdog();
 const diag=controller.diagnostic();
 assert.equal(diag.frameFreezeHistory.length,1);
 assert.equal(diag.frameFreezeHistory[0].lastRenderedMediaTime,360.1);
 assert.equal(diag.frameFreezeHistory[0].suspectedMediaPosition,360.1);
 assert.equal(diag.frameFreezeHistory[0].playbackTime,364.5);
 controller.pause();
});
