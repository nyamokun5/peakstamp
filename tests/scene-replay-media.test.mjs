import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneReplayMedia} from '../scene-replay-media.mjs';
function fake(){return {src:'',preload:'none',loads:0,pauses:0,removes:0,
 pause(){this.pauses++}, load(){this.loads++},remove(){this.removes++},removeAttribute(name){if(name==='src')this.src=''}}}
test('one video is retained for multiple scenes of same MOV',()=>{
 let creations=0;
 const m=createSceneReplayMedia(()=>{creations++;return fake()});
 const first=m.acquire('v1','blob:one');
 assert.equal(first.sourceChanged,true); assert.equal(first.video.loads,1);
 m.release();
 const second=m.acquire('v1','blob:one');
 assert.equal(second.video,first.video);assert.equal(second.sourceChanged,false);
 assert.equal(second.video.loads,1);assert.equal(creations,1);
});
test('new source resets only once, preserving the shared video object',()=>{
 const m=createSceneReplayMedia(fake);
 const old=m.acquire('v1','blob:one').video;
 m.release();
 const next=m.acquire('v2','blob:two');
 assert.equal(next.video,old);assert.equal(next.video.src,'blob:two');
 assert.equal(next.video.loads,2);assert.equal(next.sourceChanged,true);
});
test('releasing the player does not clear its source',()=>{
 const m=createSceneReplayMedia(fake);
 const v=m.acquire('v1','blob:one').video;
 m.release();
 assert.equal(v.src,'blob:one');assert.equal(v.loads,1);assert.equal(v.removes,1);
});
test('dispose clears resources and the next acquisition is fresh',()=>{
 let n=0;
 const m=createSceneReplayMedia(()=>{n++;return fake()});
 const v=m.acquire('v1','blob:one').video;
 m.dispose();assert.equal(v.src,'');assert.equal(v.loads,2);
 const w=m.acquire('v1','blob:one').video;
 assert.notEqual(w,v);assert.equal(n,2);
});
test('missing reference is rejected without allocating a player',()=>{
 const m=createSceneReplayMedia(()=>{throw Error('should not run')});
 assert.throws(()=>m.acquire('','blob:url'),/参照先/);
});

test('inline playback is enabled before first source load on iPhone',()=>{
 const sequence=[];
 const v={pause(){},remove(){},setAttribute(name){sequence.push('attribute:'+name)},
  load(){sequence.push('load');assert.equal(this.playsInline,true)}};
 const m=createSceneReplayMedia(()=>v);
 m.acquire('A','blob:first');
 assert.equal(v.playsInline,true);
 assert.ok(sequence.indexOf('attribute:playsinline')<sequence.indexOf('load'));
 assert.ok(sequence.indexOf('attribute:webkit-playsinline')<sequence.indexOf('load'));
});
