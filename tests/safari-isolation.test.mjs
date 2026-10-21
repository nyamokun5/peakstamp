import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const standalone=readFileSync(new URL("../safari-video-isolation.html", import.meta.url),"utf8");
const app=readFileSync(new URL("../index.html", import.meta.url),"utf8");

test("standalone Safari page has valid JavaScript and native video playback",()=>{
 const inline=standalone.match(/<script>([\s\S]*?)<\/script>/i);
 assert.ok(inline,"inline test script missing");
 assert.doesNotThrow(()=>new vm.Script(inline[1]));
 assert.match(standalone,/<video id="player" controls playsinline/);
 assert.match(standalone,/requestVideoFrameCallback/);
 assert.match(standalone,/lastRenderedMediaTime/);
});

test("standalone video uses only a user-chosen local file and no app persistence or uploads",()=>{
 assert.match(standalone,/type="file"/);
 assert.match(standalone,/URL\.createObjectURL\(selected\)/);
 assert.doesNotMatch(standalone,/\bfetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage/);
 assert.match(standalone,/URL\.revokeObjectURL\(url\)/);
});

test("goal debugging links isolated comparison without modifying existing control IDs",()=>{
 assert.match(app,/safari-video-isolation\.html\?v=46/);
 for(const id of ["goalStatsPlayEarlier","goalStatsNativeFullscreen","goalStatsCopyDebug","goalStatsDebugOutput"])
  assert.match(app,new RegExp('id="'+id+'"'));
 for(const id of ["at","earlier","zero","fresh","full","copy"])
  assert.match(standalone,new RegExp('id="'+id+'"'));
});


function createStandalonePlaybackHarness(){
 const inline=standalone.match(/<script>([\s\S]*?)<\/script>/i);
 assert.ok(inline);
 const ids=["player","file","target","fileInfo","status","live","output","events",
   "at","earlier","zero","fresh","full","copy"];
 const elements=Object.fromEntries(ids.map(id=>[id,{
  value:"",textContent:"",disabled:true,listeners:{},
  addEventListener(name,fn){this.listeners[name]=fn;},
  fire(name){this.listeners[name]?.();}
 }]));
 const video=elements.player;
 Object.assign(video,{
  currentTime:0,duration:450.7,paused:true,seeking:false,ended:false,
  readyState:4,networkState:1,videoWidth:1920,videoHeight:1080,
  play(){this.paused=false;return Promise.resolve();},
  pause(){this.paused=true;},
  requestVideoFrameCallback(fn){onFrame=fn;}
 });
 elements.target.value="360";
 let ms=0,onFrame=null,tick=null;
 const context={
  document:{
   getElementById:id=>elements[id],visibilityState:"visible",
   addEventListener(){}
  },
  window:{addEventListener(){}},
  URL:{createObjectURL:()=>"blob:local-test",revokeObjectURL(){}},
  navigator:{userAgent:"test iPhone"},
  performance:{now:()=>ms},
  setInterval:fn=>{tick=fn;return 1;}
 };
 new vm.Script(inline[1]).runInNewContext(context);
 elements.file.files=[{name:"IMG_5292.mov",size:591367587,type:"video/quicktime",lastModified:0}];
 elements.file.fire("change");
 return {
  video,
  play(){elements.at.fire("click");},
  setTime(value){ms=value;},
  reportFrame(mediaTime){assert.ok(onFrame);onFrame(ms,{mediaTime});},
  tick(){assert.ok(tick);tick();},
  state(){return JSON.parse(elements.output.value);}
 };
}

test("v47 detects paused media-clock and frozen frames from the user's v46 log",()=>{
 const h=createStandalonePlaybackHarness();
 h.play();
 h.video.currentTime=352.2;
 h.setTime(100);
 h.reportFrame(352);
 h.setTime(7450);
 h.tick();
 const state=h.state();
 assert.equal(state.currentTime,352.2);
 assert.equal(state.lastPresentedMediaTime,352);
 assert.equal(state.stallActive,true);
 assert.equal(state.stallHistory.length,1);
 assert.equal(state.stallHistory[0].reason,"video-clock-and-frames-stalled");
 assert.ok(state.stallHistory[0].frameAgeMs>7000);
 h.setTime(7600);
 h.reportFrame(352.3);
 assert.equal(h.state().stallActive,true); // publish runs on the next timer tick
 h.tick();
 assert.equal(h.state().stallActive,false);
 assert.equal(h.state().stallHistory[0].endedBy,"frames-resumed");
});

test("v47 captures stalled playback before any first frame appears",()=>{
 const h=createStandalonePlaybackHarness();
 h.play();
 h.setTime(6500);
 h.tick();
 const state=h.state();
 assert.equal(state.lastPresentedMediaTime,null);
 assert.equal(state.stallActive,true);
 assert.equal(state.stallHistory[0].reason,"no-first-rendered-frame");
});

test("v47 distinguishes moving clock from frozen displayed frames",()=>{
 const h=createStandalonePlaybackHarness();
 h.play();
 h.video.currentTime=360.4;
 h.setTime(100);
 h.reportFrame(352);
 h.setTime(4000);
 h.tick();
 assert.equal(h.state().stallHistory[0].reason,"clock-advanced-without-video-frames");
});

test("v47 does not diagnose deliberate pauses as playback stalls",()=>{
 const h=createStandalonePlaybackHarness();
 h.play();
 h.video.currentTime=352.2;
 h.setTime(100);
 h.reportFrame(352);
 h.video.paused=true;
 h.setTime(7300);
 h.tick();
 assert.equal(h.state().stallHistory.length,0);
});
