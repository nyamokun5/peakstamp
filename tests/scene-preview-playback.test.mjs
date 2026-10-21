import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createScenePreviewAudio,previewVolume,isIOSVolumeRestricted} from '../scene-preview-audio.mjs';
import {toggleScenePreviewPlayback,seekScenePreview} from '../scene-preview-playback.mjs';

test('scene preview pauses and resumes at the same frame, without resetting',async()=>{
 const video={paused:false,currentTime:24,pauses:0,plays:0,
   pause(){this.pauses++;this.paused=true},
   play(){this.plays++;this.paused=false;return Promise.resolve()}};
 let resets=0;
 toggleScenePreviewPlayback(video,{start:20,end:34},{restart:()=>resets++});
 assert.equal(video.paused,true);assert.equal(video.currentTime,24);
 toggleScenePreviewPlayback(video,{start:20,end:34},{restart:()=>resets++});
 assert.equal(video.paused,false);assert.equal(video.currentTime,24);
 assert.equal(video.plays,1);assert.equal(resets,0);
});
test('resume at end restarts, rather than attempting to play after trim',()=>{
 const video={paused:true,currentTime:34,play(){throw Error('must restart')}};
 let restarts=0;
 toggleScenePreviewPlayback(video,{start:20,end:34},{restart:()=>restarts++});
 assert.equal(restarts,1);
});
test('desktop preview has native audio volume, silence and restore',()=>{
 const v={volume:1,muted:false};
 const control=createScenePreviewAudio({needsGain:false});
 assert.equal(control.attach(v).canAdjust,true);
 control.setLevel(35);assert.equal(v.volume,.35);
 control.setLevel(0);assert.equal(v.muted,true);
 control.setLevel(85);assert.equal(v.muted,false);
 assert.equal(previewVolume(150),100);
});
test('iOS preview uses one reusable GainNode on a video element',async()=>{
 let instances=0,resumes=0,closes=0,gain=null;
 const audioContextFactory=()=>{
   instances++;
   return {
     state:'suspended',destination:{},
     createMediaElementSource(){return {connect(){}}},
     createGain(){gain={gain:{value:1},connect(){}};return gain},
     resume(){resumes++;this.state='running';return Promise.resolve()},
     close(){closes++;return Promise.resolve()}
   };
 };
 const v={volume:1,muted:false};
 const control=createScenePreviewAudio({needsGain:true,audioContextFactory});
 assert.equal(control.attach(v).mode,'gain');
 control.setLevel(40);
 assert.equal(gain.gain.value,.4);
 assert.equal(v.volume,1);
 await control.wake();
 control.attach(v);
 assert.equal(instances,1);
 assert.equal(resumes,1);
 control.dispose();
 assert.equal(closes,1);
});
test('unsupported iOS volume slider is disabled but mute still works',()=>{
 const v={volume:1,muted:false};
 const control=createScenePreviewAudio({needsGain:true,audioContextFactory:()=>null});
 assert.equal(control.attach(v).canAdjust,false);
 control.setLevel(0);
 assert.equal(v.muted,true);
 assert.equal(isIOSVolumeRestricted({userAgent:'Mozilla/5.0 (iPhone)'}),true);
});


test('combined timeline commits only one seek when released and leaves clip boundaries untouched',()=>{
 const video={currentTime:12.5,paused:false,sets:0,pauses:0,
   pause(){this.paused=true;this.pauses++}};
 let current=video.currentTime;
 Object.defineProperty(video,'currentTime',{get(){return current},set(next){video.sets++;current=next}});
 const bounds={start:10,end:26};
 const pos=seekScenePreview(video,19.37,bounds);
 assert.equal(pos,19.4);
 assert.equal(video.currentTime,19.4);
 assert.equal(video.sets,1);
 assert.equal(video.pauses,1);
 assert.deepEqual(bounds,{start:10,end:26});
 assert.equal(seekScenePreview(video,99,bounds),26);
 assert.equal(seekScenePreview(video,-5,bounds),10);
 assert.equal(seekScenePreview(video,Number.NaN,bounds),null);
});

test('normal scene editing UI uses one combined draggable timeline and no quiet/fixed selector',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const app=readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
 const montage=readFileSync(new URL('../montage-ui.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(html,/name="cutMode"|id="tailSeconds"|id="clipDuration"/);
 assert.match(app,/make\('button','range-playhead'\)/);
 assert.match(app,/track\.addEventListener\('pointerdown'/);
 assert.match(app,/track\.addEventListener\('pointerup'/);
 assert.match(app,/seekScenePreview\(replayVideo,seconds,bounds\)/);
 assert.match(app,/fixedSeconds:16/);
 assert.match(montage,/fixedSeconds:16/);
 assert.doesNotMatch(app,/make\('input','scene-seek-slider'\)/);
});

test('last review moves to final create-video button without auto-generating MP4',()=>{
 const app=readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
 const tail=app.split('function nextSceneAfter(current) {')[1].split('function decideReview(')[0];
 assert.match(tail,/if \(!next\)/);
 assert.match(tail,/\$\('montageExport'\)/);
 assert.match(tail,/scrollIntoView\(\{behavior:'smooth',block:'center'\}\)/);
 assert.doesNotMatch(tail,/exportButton\.click\(/);
});
