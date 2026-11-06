/**
 * Goal video replay uses the SAME direct seek-and-play primitive as regular
 * highlight cards. On iOS, waiting for an extra "deep seek completed" state
 * before calling play() can lose the tap's gesture authorization.
 *
 * Keep the goal metadata/trim editor visible, but defer opening the MOV
 * until Replay (or the explicit next-goal selection) is requested.
 * A single HTMLVideoElement is reused across scenes; one source assignment
 * is made only when switching video files.
 */
import {seekScenePreview} from './scene-preview-playback.mjs?v=autoplay51';

export function createGoalPlaybackController(video,{
 notify=()=>{},beforePlay=()=>{}
}={}){
 let sourceKey='',sourceUrl='',loadedUrl='',target=0;
 let pendingPlay=false,prepared=false,phase='idle',playAttempts=0;
 let nativeMode=false,nativeSeekPending=false,loadingTimer=null;
 let initialTapPrimed=false,needsReload=false;
 let serial=0,lastMessage='',lastAttemptedTime=null,gestureNeeded=false;
 const say=message=>{lastMessage=message;notify(message)};
 const ready=()=>video.readyState>=1;
 const clock=()=>Number(video.currentTime)||0;
 const cancelLoadTimer=()=>{if(loadingTimer!==null)clearTimeout(loadingTimer);loadingTimer=null};
 const stop=()=>{pendingPlay=false;initialTapPrimed=false;cancelLoadTimer();try{video.pause()}catch(_){}};
 const armLoadTimer=()=>{
  cancelLoadTimer();
  const token=serial;
  loadingTimer=setTimeout(()=>{
   loadingTimer=null;
   if(token!==serial||nativeMode||!sourceKey)return;
   needsReload=true;phase='stalled';
   say('動画を読み込めませんでした。「リプレイ」で読み直してください。');
  },8500);
  if(typeof loadingTimer?.unref==='function')loadingTimer.unref();
 };
 const formatTime=time=>Math.floor(time/60)+':'+String(Math.floor(time%60)).padStart(2,'0');

 function seekNativeToTarget(){
  if(!nativeMode||!nativeSeekPending||!ready())return;
  nativeSeekPending=false;
  try{video.currentTime=target;prepared=true}
  catch(_){say('ゴール位置に移動できません。標準プレーヤーで再生位置を調整してください。')}
 }
 function playAtTarget(){
  if(!pendingPlay||!sourceKey||loadedUrl!==sourceUrl||!ready())return;
  pendingPlay=false;
  // Keep the watchdog until decoded media actually advances, not just play().
  const token=serial;
  const requested=target;
  lastAttemptedTime=requested;
  phase='seeking';
  playAttempts++;
  gestureNeeded=false;
  // Exact same seek + immediate play operation as highlight scrub/replay.
  // No extra seeked/canplay gate, and no continuous forced re-seeks.
  const moved=seekScenePreview(video,requested,{
   start:requested,end:Math.max(requested+.3,Number(video.duration)||0)
  },{
   autoPlay:true,
   onBeforePlay:()=>{
    phase='starting';
    say('再生を開始しています…');
   },
   onError:error=>{
    if(token!==serial)return;
    gestureNeeded=String(error?.name||'')==='NotAllowedError';
    phase='paused';
    say('再生できませんでした。▶ リプレイをもう一度押してください。'+
      (error?.name?'（'+error.name+'）':''));
   }
  });
  if(moved===null){
   phase='seek-failed';
   say('動画の開始位置に移動できません。▶ リプレイをもう一度押してください。');
  }else{
   prepared=true;
  }
 }
 // On iOS the initial play() MUST happen inside the user's Replay tap.
 // Calling it only from a later loadedmetadata event loses gesture activation.
 // Seek the long MOV after metadata WITHOUT pausing/restarting that primed play.
 function primeFirstTap(){
  const token=serial;
  initialTapPrimed=true;
  phase='starting';
  say('再生を開始しています…');
  try{
   Promise.resolve(video.play()).catch(error=>{
    if(token!==serial||loadedUrl!==sourceUrl)return;
    pendingPlay=false;initialTapPrimed=false;
    gestureNeeded=String(error?.name||'')==='NotAllowedError';
    phase='paused';
    say('Safariで再生を開始できませんでした。▶ リプレイを再度押してください。'+
     (error?.name?'（'+error.name+'）':''));
   });
  }catch(error){
   if(token!==serial)return;
   pendingPlay=false;initialTapPrimed=false;
   gestureNeeded=String(error?.name||'')==='NotAllowedError';
   phase='paused';
   say('Safariで再生を開始できませんでした。▶ リプレイを再度押してください。');
  }
 }
 function open({sourceKey:key,sourceUrl:url,at,autoplay=false,fromStart=false,native=false}={}){
  if(!key||!url)return false;
  const requested=fromStart?0:Math.max(0,Number(at)||0);
  const changed=sourceKey!==key||sourceUrl!==url;
  serial++;
  sourceKey=key;sourceUrl=url;target=requested;
  stop();
  gestureNeeded=false;
  nativeMode=Boolean(native);
  if(nativeMode){
   beforePlay(); // pause competing highlight playback inside this tap
   video.hidden=false;video.controls=true;video.playsInline=true;
   video.setAttribute('playsinline','');
   video.setAttribute('webkit-playsinline','');
   pendingPlay=false;nativeSeekPending=true;phase='native';
   if(loadedUrl!==url){
    loadedUrl=url;prepared=false;video.preload='auto';
    video.src=url;video.load();
   }
   seekNativeToTarget();
   say('Safari標準プレーヤーに切り替えました。動画内の▶を押して再生してください。');
   return changed;
  }
  nativeSeekPending=false;
  video.controls=false;
  if(!autoplay){
   // Passive render must NOT decode/seek a 400MB iPhone MOV. This was the
   // important difference from the functioning highlight player.
   video.hidden=true;
   phase='idle';
   prepared=false;
   say('▶ リプレイを押すとゴール付近を再生します（'+formatTime(target)+'から）。');
   return changed;
  }
  // Release other decoders BEFORE src/load, within the original user tap.
  beforePlay();
  video.hidden=false;
  video.playsInline=true;
  video.setAttribute('playsinline','');
  video.setAttribute('webkit-playsinline','');
  pendingPlay=true;
  armLoadTimer();
  if(loadedUrl!==url||needsReload||video.error){
   needsReload=false;
   loadedUrl=url;
   prepared=false;
   phase='loading';
   video.preload='auto';
   say('元動画を読み込んでいます…');
   video.src=url; // healthy same-source replays retain their decoder
   video.load(); // also recover a failed/stalled decoder during the user tap.
   armLoadTimer();
   if(ready())playAtTarget();
   else primeFirstTap();
  }else if(ready()){
   playAtTarget();
  }else{
   phase='loading';
   armLoadTimer();
   say('動画を準備しています…');
   // Retry within this fresh user gesture even when metadata is still pending.
   if(video.error){video.load();}
   primeFirstTap();
  }
  return changed;
 }
 function pause(){
  stop();
  phase='paused';
 }
 function dispose(){
  serial++;stop();sourceKey='';sourceUrl='';loadedUrl='';target=0;
  prepared=false;phase='idle';gestureNeeded=false;needsReload=false;
  nativeMode=false;nativeSeekPending=false;video.controls=false;
  try{video.removeAttribute('src');video.load()}catch(_){}
  video.hidden=true;
 }
 video.addEventListener('loadedmetadata',()=>{
  if(nativeMode){seekNativeToTarget();return}
  if(!pendingPlay||!sourceKey||loadedUrl!==sourceUrl)return;
  if(initialTapPrimed){
   // No pause() or second play(): preserve the first tap's autoplay permission.
   initialTapPrimed=false;
   pendingPlay=false;
   lastAttemptedTime=target;
   try{video.currentTime=target;prepared=true}
   catch(_){phase='seek-failed';say('再生位置に移動できません。▶ リプレイを再度押してください。')}
  }else playAtTarget();
 });
 video.addEventListener('playing',()=>{
  if(!sourceKey)return;
  phase='playing';prepared=true;
 });
 // A seek alone changes currentTime. Require playable data, no seek, and
 // time beyond the requested position before declaring playback recovered.
 video.addEventListener('timeupdate',()=>{
  if(!sourceKey||video.paused||video.seeking||video.readyState<2||clock()<=target+.1)return;
  cancelLoadTimer();needsReload=false;phase='playing';say('');
 });
 video.addEventListener('waiting',()=>{
  if(!sourceKey||video.hidden)return;
  say('動画を読み込み中…');
 });
 video.addEventListener('error',()=>{
  if(!sourceKey||video.hidden)return;
  stop();phase='error';prepared=false;needsReload=true;
  const code=video.error?.code;
  say(code===4?'このMOV形式をSafariで再生できません。':
   '動画を読み込めませんでした。元動画を選び直してください。');
 });
 function currentSourceKey(){return sourceKey}
 function diagnostic(){
  return {player:'PeakStamp goal replay highlight-parity v2',sourceKey,
   currentTime:clock(),targetTime:target,readyState:video.readyState,
   seeking:video.seeking,paused:video.paused,phase,prepared,
   nativeMode,pendingPlay,playAttempts,gestureNeeded,needsReload,lastMessage,lastAttemptedTime};
 }
 return {open,pause,dispose,currentSourceKey,diagnostic};
}
