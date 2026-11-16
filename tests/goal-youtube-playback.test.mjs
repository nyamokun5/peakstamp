import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoalYouTubePlayback} from '../goal-youtube-playback.mjs';
const source=id=>({youtubeId:id,file:{name:'YouTube-'+id,size:0,lastModified:0},duration:120});
function fixture({reject=false}={}){
 const video=new EventTarget();let nativePlays=0,nativePauses=0,time=0,remoteDuration=240,mute=false;
 Object.assign(video,{currentTime:9,duration:90,readyState:3,paused:true,seeking:false,muted:false,
  play(){nativePlays++;return Promise.resolve()},pause(){nativePauses++},hidden:false});
 const nativePlay=video.play,nativePause=video.pause,frames=[],calls=[],timers=[];let events,apiCalls=0,ytDestroyed=0;
 const remote={getCurrentTime:()=>time,getDuration:()=>remoteDuration,
  seekTo:(value)=>{time=value;calls.push(['seek',value]);},
  playVideo:()=>calls.push(['play']),pauseVideo:()=>calls.push(['pause']),
  mute:()=>{mute=true;calls.push(['mute']);},unMute:()=>{mute=false;},destroy:()=>{ytDestroyed++;}};
 const viewer={querySelector:()=>({prepend:frame=>frames.push(frame)})};
 const messages=[];
 const adapter=createGoalYouTubePlayback({video,viewer,origin:'https://peakstamp.local',
  document:{createElement:()=>({style:{},remove(){this.removed=true;}})},
  loadAPI:async()=>{apiCalls++;if(reject)throw Error('mock YouTube unavailable');return {Player:class{constructor(frame,options){events=options.events;return remote;}}};},
  notify:m=>messages.push(m),setIntervalImpl:fn=>{timers.push(fn);return timers.length;},clearIntervalImpl:id=>{calls.push(['clear',id]);}});
 return {adapter,video,frames,calls,messages,timers,nativePlay,nativePause,
  ready:()=>events.onReady({target:remote}),state:value=>events.onStateChange({data:value}),
  apiCalls:()=>apiCalls,nativePlays:()=>nativePlays,nativePauses:()=>nativePauses,
  time:value=>{time=value;},destroyed:()=>ytDestroyed,muted:()=>mute};
}
test('YouTube uses the shared media clock/seek/pause/mute contract only after an explicit replay',async()=>{
 const f=fixture();let ticks=0;f.video.addEventListener('timeupdate',()=>ticks++);
 f.adapter.activate(source('abcdefghijk'));
 f.adapter.open({sourceKey:'yt1',at:25,autoplay:false});
 assert.equal(f.frames.length,0);assert.equal(f.apiCalls(),0);assert.equal(f.video.duration,120);assert.equal(f.video.readyState,0);
 f.adapter.open({sourceKey:'yt1',at:25,autoplay:true});await Promise.resolve();
 assert.equal(f.frames.length,1);assert.match(f.frames[0].src,/youtube\.com\/embed\/abcdefghijk/);
 const params=new URL(f.frames[0].src).searchParams;
 assert.equal(params.get('controls'),'0');assert.equal(params.get('playsinline'),'1');
 assert.equal(params.get('fs'),'0');assert.equal(params.get('disablekb'),'1');
 assert.match(f.frames[0].src,/start=25/);f.ready();
 assert.equal(f.video.currentTime,25);assert.equal(f.video.readyState,4);assert.equal(f.video.duration,240);assert.equal(f.video.paused,false);
 f.video.currentTime=29.5;assert.equal(f.video.currentTime,29.5);
 f.video.muted=true;assert.equal(f.muted(),true);
 f.video.pause();assert.equal(f.video.paused,true);
 await f.video.play();assert.equal(f.video.paused,false);
 f.time(30);f.timers[0]();assert.ok(ticks>0);assert.equal(f.video.currentTime,30);
 assert.equal(f.nativePlays(),0);assert.equal(f.nativePauses(),0);
});
test('leaving YouTube restores every native media method and property and releases its timer',async()=>{
 const f=fixture();f.adapter.activate(source('abcdefghijk'));f.adapter.open({sourceKey:'yt',at:5,autoplay:true});await Promise.resolve();f.ready();
 f.adapter.deactivate();
 assert.equal(f.video.currentTime,9);assert.equal(f.video.duration,90);assert.equal(f.video.readyState,3);
 assert.equal(f.video.play,f.nativePlay);assert.equal(f.video.pause,f.nativePause);
 await f.video.play();assert.equal(f.nativePlays(),1);assert.equal(f.destroyed(),1);assert.ok(f.frames[0].removed);
 assert.equal(f.adapter.currentSourceKey(),'');assert.equal(f.adapter.active(),false);
 assert.ok(f.calls.some(c=>c[0]==='clear'));
});
test('late ready events from an earlier source cannot play or seek a replacement source',async()=>{
 const f=fixture();f.adapter.activate(source('abcdefghijk'));f.adapter.open({sourceKey:'old',at:5,autoplay:true});await Promise.resolve();
 const previousReady=f.ready; // Accessor calls the original event set until another player is created.
 f.adapter.activate(source('lmnopqrstuv'));previousReady();
 assert.equal(f.calls.filter(c=>c[0]==='play').length,0);
 assert.equal(f.adapter.currentSourceKey(),'');assert.equal(f.video.readyState,0);
});
test('a failed API load reports its error and does not fall back to loading a YouTube page as MOV',async()=>{
 const f=fixture({reject:true});f.adapter.activate(source('abcdefghijk'));f.adapter.open({sourceKey:'yt',at:5,autoplay:true});
 await Promise.resolve();await Promise.resolve();
 assert.ok(f.messages.some(m=>m==='mock YouTube unavailable'));assert.equal(f.video.readyState,0);assert.equal(f.video.src,undefined);
 assert.ok(f.frames[0].removed);assert.equal(f.nativePlays(),0);
 f.adapter.deactivate();assert.equal(f.video.play,f.nativePlay);
});
test('invalid YouTube source IDs are rejected without patching the local media object',()=>{
 const f=fixture();assert.throws(()=>f.adapter.activate(source('../unsafe')),/動画ID/);
 assert.equal(f.video.play,f.nativePlay);assert.equal(f.video.currentTime,9);assert.equal(f.frames.length,0);
});
test('a paused YouTube player does not keep redrawing exact-time inputs',async()=>{
 const f=fixture();let ticks=0;f.video.addEventListener('timeupdate',()=>ticks++);
 f.adapter.activate(source('abcdefghijk'));f.adapter.open({sourceKey:'yt',at:25,autoplay:true});await Promise.resolve();f.ready();
 f.video.pause();const before=ticks;f.timers[0]();f.timers[0]();
 assert.equal(ticks,before);f.video.currentTime=26;assert.ok(ticks>before);
 f.adapter.deactivate();
});
