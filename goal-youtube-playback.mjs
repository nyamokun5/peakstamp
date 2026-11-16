// Adapt YouTube to the existing goal editor's media contract. Overrides are
// installed only for a YouTube source and fully restored for local MOV files.
import {goalSourceKey} from './goal-stats.mjs';
let apiPromise;
export function loadGoalYouTubeAPI(){
 if(globalThis.YT?.Player)return Promise.resolve(globalThis.YT);
 if(apiPromise)return apiPromise;
 apiPromise=new Promise((resolve,reject)=>{
  const prior=globalThis.onYouTubeIframeAPIReady;
  const timer=setTimeout(()=>{apiPromise=null;reject(Error('YouTubeの準備に時間がかかっています。リプレイを押して再試行してください。'));},15000);
  globalThis.onYouTubeIframeAPIReady=()=>{
   clearTimeout(timer);try{prior?.();}catch{}
   if(globalThis.YT?.Player)resolve(globalThis.YT);
   else{apiPromise=null;reject(Error('YouTubeを準備できませんでした。'));}
  };
  let script=[...document.scripts].find(s=>s.src==='https://www.youtube.com/iframe_api');
  if(!script){script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';document.head.append(script);}
  script.addEventListener('error',()=>{clearTimeout(timer);apiPromise=null;reject(Error('YouTubeに接続できません。通信状態を確認してください。'));},{once:true});
 });
 return apiPromise;
}
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{11}$/.test(id);
export function createGoalYouTubePlayback({video,viewer,notify=()=>{},beforePlay=()=>{},
 loadAPI=loadGoalYouTubeAPI,setIntervalImpl=setInterval,clearIntervalImpl=clearInterval,
 document=globalThis.document,origin=globalThis.location?.origin||''}){
 let source=null,sourceKey='',frame=null,player=null,ready=false,target=0,paused=true,muted=false,
  pendingPlay=false,timer=null,serial=0,patched=false;
 const originals=new Map();
 const emit=name=>video.dispatchEvent(new Event(name));
 const duration=()=>{
  const remote=Number(player?.getDuration?.());return remote>0?remote:Number(source?.duration)||NaN;
 };
 const clock=()=>{const remote=Number(player?.getCurrentTime?.());return ready&&Number.isFinite(remote)?remote:target;};
 const stop=()=>{pendingPlay=false;paused=true;try{player?.pauseVideo?.();}catch{}emit('pause');};
 const play=()=>{
  pendingPlay=true;beforePlay();
  if(ready){paused=false;player.playVideo();emit('play');}
  return Promise.resolve();
 };
 const seek=value=>{
  const at=Number(value);if(!Number.isFinite(at)||at<0)return;
  const length=duration();target=Number.isFinite(length)?Math.min(length,at):at;
  if(ready)player.seekTo(target,true);
  emit('seeked');emit('timeupdate');
 };
 function patch(name,descriptor){
  originals.set(name,Object.getOwnPropertyDescriptor(video,name));
  Object.defineProperty(video,name,{configurable:true,...descriptor});
 }
 function installMedia(){
  if(patched)return;patched=true;
  patch('currentTime',{get:clock,set:seek});patch('duration',{get:duration});
  patch('readyState',{get:()=>ready?4:0});patch('paused',{get:()=>paused});
  patch('seeking',{get:()=>false});
  patch('muted',{get:()=>muted,set:value=>{muted=Boolean(value);if(ready){if(muted)player.mute();else player.unMute();}emit('volumechange');}});
  patch('play',{value:play,writable:true});patch('pause',{value:stop,writable:true});
  video.hidden=true;
 }
 function restoreMedia(){
  if(!patched)return;patched=false;
  for(const [name,descriptor] of originals){if(descriptor)Object.defineProperty(video,name,descriptor);else delete video[name];}
  originals.clear();
 }
 function destroyFrame(){
  serial++;if(timer!==null){clearIntervalImpl(timer);timer=null;}
  try{player?.destroy?.();}catch{}
  frame?.remove();frame=null;player=null;ready=false;pendingPlay=false;paused=true;
 }
 function activate(next){
  if(!validId(next?.youtubeId))throw Error('YouTube動画IDが正しくありません。');
  if(source?.youtubeId!==next.youtubeId){destroyFrame();sourceKey='';target=0;}
  source=next;installMedia();
 }
 function deactivate(){
  destroyFrame();source=null;sourceKey='';target=0;restoreMedia();
 }
 function open({sourceKey:key,at,autoplay=false}={}){
  if(!source||!key)return false;
  const changed=sourceKey!==key;sourceKey=key;
  target=Math.max(0,Number(at)||0);pendingPlay=Boolean(autoplay);
  if(!autoplay){if(ready){player.pauseVideo();player.seekTo(target,true);}paused=true;return changed;}
  beforePlay();video.hidden=true;
  if(ready){seek(target);paused=false;player.playVideo();emit('play');return changed;}
  if(frame)return changed;
  const token=serial,viewport=viewer.querySelector('.goal-scene-viewport');
  if(!viewport)throw Error('ゴールの再生画面を準備できません。');
  frame=document.createElement('iframe');
  const iframe=frame;
  iframe.title='ゴールシーンのYouTube再生';iframe.allow='autoplay';
  iframe.style.cssText='display:block;width:100%;aspect-ratio:16/9;border:0';
  const params=new URLSearchParams({start:String(Math.floor(target)),autoplay:'1',playsinline:'1',controls:'0',fs:'0',disablekb:'1',enablejsapi:'1'});
  if(origin)params.set('origin',origin);
  iframe.src='https://www.youtube.com/embed/'+source.youtubeId+'?'+params;
  viewport.prepend(iframe);notify('YouTubeを準備しています…');
  loadAPI().then(YT=>{
   if(token!==serial||frame!==iframe)return;
   player=new YT.Player(iframe,{events:{
    onReady:({target:remote})=>{
     if(token!==serial||frame!==iframe)return;
     player=remote;ready=true;
     remote.seekTo(target,true);if(muted)remote.mute();else remote.unMute();
     if(pendingPlay){paused=false;remote.playVideo();emit('play');}else{paused=true;remote.pauseVideo();}
     notify('');emit('loadedmetadata');emit('timeupdate');
     if(timer!==null)clearIntervalImpl(timer);
     let lastClock=clock();
     timer=setIntervalImpl(()=>{
      if(token!==serial)return;
      const at=clock();
      // Native paused videos do not continuously dispatch timeupdate. In
      // particular, do not overwrite the shared exact-time input mid-edit.
      if(!paused||at!==lastClock)emit('timeupdate');
      lastClock=at;
     },120);
    },
    onStateChange:event=>{
     if(token!==serial||frame!==iframe)return;
     if(event.data===1){paused=false;emit('play');emit('playing');}
     else if(event.data===0||event.data===2){paused=true;emit('pause');}
     emit('timeupdate');
    },
    onAutoplayBlocked:()=>{if(token===serial)notify('動画の下の「再生」または「リプレイ」を押してください。');},
    onError:()=>{if(token===serial){paused=true;notify('YouTube動画を再生できません。公開・埋め込み設定を確認してください。');}}
   }});
  }).catch(error=>{
   if(token!==serial)return;
   destroyFrame();notify(error?.message||'YouTube動画を準備できません。');
  });
  return changed;
 }
 return {activate,deactivate,open,pause:stop,dispose:deactivate,
  currentSourceKey:()=>sourceKey,active:()=>Boolean(source),
  diagnostic:()=>({player:'PeakStamp YouTube goal replay',sourceKey,currentTime:clock(),readyState:ready?4:0,paused,targetTime:target}),
  sourceKey:()=>source?goalSourceKey(source):''};
}
