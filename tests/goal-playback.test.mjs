import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoalPlaybackController} from '../goal-playback.mjs';

function fixture(){
 const calls={plays:[],pauses:0,sources:0,loads:0,before:0,messages:[]};
 const events=new Map();
 const video={
  readyState:0,paused:true,seeking:false,duration:450,currentTime:0,
  hidden:true,_src:'',
  setAttribute(){},
  removeAttribute(name){if(name==='src')this._src=''},
  load(){calls.loads++;this.readyState=0},
  pause(){this.paused=true;calls.pauses++},
  addEventListener(type,handler){
   if(!events.has(type))events.set(type,[]);
   events.get(type).push(handler);
  },
  play(){
   calls.plays.push({src:this.src,time:this.currentTime});
   if(calls.nextError){const problem=calls.nextError;calls.nextError=null;return Promise.reject(problem)}
   this.paused=false;emit('playing');return Promise.resolve();
  }
 };
 const emit=type=>(events.get(type)||[]).forEach(fn=>fn());
 Object.defineProperty(video,'src',{
  get(){return this._src},
  set(value){
   this._src=value;this.readyState=0;this.currentTime=0;this.seeking=false;
   calls.sources++;
   queueMicrotask(()=>{this.readyState=1;emit('loadedmetadata')});
  }
 });
 const controller=createGoalPlaybackController(video,{
  notify:x=>calls.messages.push(x),
  beforePlay:()=>calls.before++
 });
 const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
 return {video,calls,controller,emit,flush};
}
test('passive first goal shows Replay but never preloads/decodes/seeks a long MOV',async()=>{
 const {video,calls,controller,flush}=fixture();
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:365.2,autoplay:false});
 await flush();
 assert.equal(video.src,'');
 assert.equal(video.currentTime,0);
 assert.equal(video.hidden,true);
 assert.equal(calls.sources,0);
 assert.equal(calls.plays.length,0);
 assert.match(calls.messages.at(-1),/リプレイ/);
});
test('one Replay tap triggers source load, exact deep seek and play as with highlight previews',async()=>{
 const {video,calls,controller,flush}=fixture();
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:365.2,autoplay:false});
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:365.2,autoplay:true});
 await flush();
 assert.equal(video.hidden,false);
 assert.equal(calls.sources,1);
 assert.equal(calls.plays.length,1);
 assert.equal(calls.plays[0].time,365.2);
 assert.equal(controller.diagnostic().phase,'playing');
 assert.equal(calls.before,1);
});
test('repeat Replay of the same MOV reuses the decoder with no source reassignment',async()=>{
 const {calls,controller,flush}=fixture();
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:105,autoplay:true});
 await flush();
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:103,autoplay:true});
 await flush();
 assert.equal(calls.sources,1);
 assert.deepEqual(calls.plays.map(x=>x.time),[105,103]);
});
test('choosing next goal from a different video loads once and starts from its clip',async()=>{
 const {video,calls,controller,flush}=fixture();
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:379,autoplay:true});
 await flush();
 controller.open({sourceKey:'B',sourceUrl:'blob:b',at:117,autoplay:true});
 await flush();
 assert.equal(video.src,'blob:b');
 assert.equal(calls.sources,2);
 assert.deepEqual(calls.plays.map(x=>x.time),[379,117]);
 assert.equal(controller.currentSourceKey(),'B');
});
test('passive queue selection cancels a pending metadata-triggered replay',async()=>{
 const {calls,controller,flush}=fixture();
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:300,autoplay:true});
 controller.open({sourceKey:'B',sourceUrl:'blob:b',at:90,autoplay:false});
 await flush();
 assert.equal(calls.plays.length,0);
 assert.equal(controller.currentSourceKey(),'B');
});
test('play failures report a repeatable button action, not an endless seek wait',async()=>{
 const {video,calls,controller,flush}=fixture();
 calls.nextError={name:'NotAllowedError'};
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:200,autoplay:true});
 await flush();
 assert.equal(calls.plays.length,1);
 assert.match(calls.messages.at(-1),/もう一度押して/);
 assert.equal(controller.diagnostic().gestureNeeded,true);
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:200,autoplay:true});
 await flush();
 assert.equal(calls.plays.length,2);
 assert.equal(calls.plays[1].time,200);
 assert.equal(video.hidden,false);
});
test('manual trim start and user scrub time are respected without old goal -10s logic',async()=>{
 const {calls,controller,flush}=fixture();
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:374.2,autoplay:true});
 await flush();
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:363,autoplay:true});
 await flush();
 assert.deepEqual(calls.plays.map(x=>x.time),[374.2,363]);
});
test('dispose detaches media and resets shared goal decoder',async()=>{
 const {video,calls,controller,flush}=fixture();
 controller.open({sourceKey:'A',sourceUrl:'blob:a',at:100,autoplay:true});
 await flush();
 controller.dispose();
 assert.equal(video.hidden,true);
 assert.equal(controller.currentSourceKey(),'');
 assert.equal(calls.loads,1);
});
