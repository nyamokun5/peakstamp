import test from 'node:test';
import assert from 'node:assert/strict';
import {createScenePreviewAudio,previewVolume,isIOSVolumeRestricted} from '../scene-preview-audio.mjs';
import {toggleScenePreviewPlayback} from '../scene-preview-playback.mjs';

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
