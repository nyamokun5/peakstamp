/**
 * iPhone-Safari-compatible local MOV playback for the PS goal review.
 * Keep one player: a new source is loaded only when the source key changes.
 * iOS playback requires a synchronous .play() from the original tap.
 * The metadata/seek events can retry a transient AbortError afterwards.
 */
export function createGoalPlaybackController(video,{notify=()=>{},beforePlay=()=>{}}={}){
 let activeKey='',activeUrl='',wantedTime=0,pendingSeek=false,wantsPlayback=false;
 let requestId=0,playPending=false,retryNeeded=false,denied=false,retries=0;
 let seekingOwnJump=false,expectResume=false,fromBeginning=false,progressWatch=0;
 let lastProgress=0,lastEvent='init',lastMessage='',lastFailure='';
 const eventLog=[];
 const record=(name)=>{
  lastEvent=name;
  eventLog.push({event:name,time:Number(video.currentTime)||0,
   readyState:video.readyState,networkState:video.networkState,
   paused:video.paused,seeking:video.seeking});
  if(eventLog.length>24)eventLog.shift();
 };
 const report=message=>{lastMessage=message;notify(message);};
 function mediaError(e){
  const name=e?.name||'';
  if(name==='NotAllowedError')return 'Safariが自動再生を制限しました。動画画面の▶を直接タップしてください。';
  if(name==='NotSupportedError')return 'この動画の形式・コーデックを再生できません。iPhoneの写真アプリで再生できるか確認してください。';
  if(name==='AbortError')return '再生位置の移動で一時停止しました。再生を再試行します。';
  return '動画を再生できませんでした（'+(name||e?.message||'不明なエラー')+'）。動画画面の▶をお試しください。';
 }
 function seek(){
  if(!pendingSeek||video.readyState<1)return false;
  try{
   if(fromBeginning){pendingSeek=false;return true;}
   seekingOwnJump=true;expectResume=wantsPlayback;
   video.currentTime=wantedTime;
   pendingSeek=false;
   record('target-seek');
   // Playing can stop even after play() has resolved when iOS starts seeking.
   if(wantsPlayback)retryNeeded=true;
   if(!denied)report(video.seeking?'ゴール位置に移動中…':'');
   return true;
  }catch(_){report('動画の位置を調整しています…');return false;}
 }
 function startPlay(token,{userGesture=false}={}){
  if(token!==requestId||!wantsPlayback||playPending||denied)return;
  if(userGesture)beforePlay();
  record(userGesture?'user-play':'retry-play');
  // Keep the original gesture alive: call play synchronously before any awaits.
  let attempt;
  try{attempt=video.play();}
  catch(error){handlePlayFailure(token,error);return;}
  if(attempt&&typeof attempt.then==='function'){
   playPending=true;
   Promise.resolve(attempt).then(()=>{
    if(token!==requestId)return;
    playPending=false;
    if(!video.paused){retryNeeded=false;}
    else if(expectResume&&wantsPlayback&&!denied){retryNeeded=true;retryWhenReady();}
   },error=>{
    if(token!==requestId)return;
    playPending=false;handlePlayFailure(token,error);
   });
  }
 }
 function handlePlayFailure(token,error){
  if(token!==requestId||!wantsPlayback)return;
  const message=mediaError(error);lastFailure=String(error?.name||error?.message||error);
  record('play-error:'+lastFailure);
  if(error?.name==='AbortError'&&retries<2){
   retryNeeded=true;
   report('ゴール位置へ移動中… 読み込み後に再生を再試行します。');
   retryWhenReady();
  }else{
   retryNeeded=false;
   denied=error?.name==='NotAllowedError';
   report(message);
  }
 }
 function retryWhenReady(){
  if(!retryNeeded||!wantsPlayback||denied||playPending||
    video.readyState<2||video.seeking||pendingSeek||retries>=2)return;
  if(!video.paused){retryNeeded=false;expectResume=false;return;}
  retries++;
  retryNeeded=false;expectResume=false;
  startPlay(requestId);
 }
 video.addEventListener('loadedmetadata',()=>{
  record('loadedmetadata');
  seek();retryWhenReady();
 });
 video.addEventListener('loadeddata',()=>{record('loadeddata');retryWhenReady();});
 video.addEventListener('canplay',()=>{record('canplay');retryWhenReady();});
 video.addEventListener('seeking',()=>{record('seeking');});
 video.addEventListener('seeked',()=>{
  record('seeked');
  seekingOwnJump=false;
  retryWhenReady();
  if(!video.paused)report('');
 });
 video.addEventListener('playing',()=>{
  record('playing');retryNeeded=false;lastProgress=Number(video.currentTime)||0;report('');
  // A resolved play() promise can still leave an iOS video frozen on one frame.
  if(progressWatch)clearTimeout(progressWatch);
  const token=requestId,at=lastProgress;
  progressWatch=setTimeout(()=>{
   progressWatch=0;
   if(token!==requestId||video.paused||video.seeking)return;
   if(Math.abs((Number(video.currentTime)||0)-at)<.15)
    report('再生状態ですが映像が進んでいません。下の「先頭から再生」を試し、診断結果をコピーしてください。');
  },3000);
 });
 video.addEventListener('timeupdate',()=>{
  const time=Number(video.currentTime)||0;
  if(Math.abs(time-lastProgress)>.2){lastProgress=time;record('timeupdate');}
 });
 video.addEventListener('pause',()=>{
  record('pause');
  if(wantsPlayback&&seekingOwnJump)expectResume=true;
 });
 video.addEventListener('waiting',()=>{record('waiting');report('動画の読み込み中…');});
 video.addEventListener('stalled',()=>{record('stalled');report('読み込みが一時停止しています。下の「先頭から再生」も試せます。');});
 video.addEventListener('error',()=>{
  record('error');
  const code=video.error?.code;
  report(code===4
   ?'SafariがこのMOVの形式を再生できません。iPhoneの写真アプリで開けるか確認してください。'
   :code===3
   ?'動画のデコードに失敗しました。動画画面の▶か、元ファイルの再選択をお試しください。'
   :'動画を読み込めませんでした。ファイルを再選択してください。');
 });

 function open({sourceKey,sourceUrl,at,autoplay=false,fromStart=false}){
  if(!sourceKey||!sourceUrl)return false;
  requestId++;
  const token=requestId;
  if(progressWatch){clearTimeout(progressWatch);progressWatch=0;}
  fromBeginning=Boolean(fromStart);
  wantedTime=fromBeginning?0:Math.max(0,Number(at)||0);
  pendingSeek=!fromBeginning;wantsPlayback=Boolean(autoplay);
  seekingOwnJump=false;expectResume=false;
  playPending=false;retryNeeded=false;denied=false;retries=0;
  record(fromBeginning?'open-from-start':'open-goal');
  // IMPORTANT: the containing player and <video> must be unhidden BEFORE
  // setting src or play() on Safari, otherwise decoding may remain suspended.
  video.hidden=false;
  video.playsInline=true;
  video.setAttribute('playsinline','');
  video.setAttribute('webkit-playsinline','');
  const switching=activeKey!==sourceKey||activeUrl!==sourceUrl;
  const restartFromBeginning=fromBeginning&&!switching;
  if(switching||restartFromBeginning){
   video.pause();
   video.preload='auto';
   // For the explicit fallback, reassign the original blob URL to RESET
   // the media pipeline at t=0 instead of seeking backward within a stalled MOV.
   video.src=sourceUrl; // src initiates load; do not call load() twice.
   activeKey=sourceKey;activeUrl=sourceUrl;
  }
  // On a new src, wait for its metadata: readyState may still describe
  // the previous source during Safari's media-resource reset.
  if(!switching&&!fromBeginning)seek();
  if(autoplay){
   report('動画を準備しています…');
   startPlay(token,{userGesture:true});
  }else video.pause();
  return switching;
 }
 function pause(){
  wantsPlayback=false;retryNeeded=false;expectResume=false;
  if(progressWatch){clearTimeout(progressWatch);progressWatch=0;}
  video.pause();
 }
 function dispose(){
  requestId++;wantsPlayback=false;retryNeeded=false;playPending=false;
  if(progressWatch){clearTimeout(progressWatch);progressWatch=0;}
  video.pause();video.removeAttribute('src');video.load();
  video.hidden=true;activeKey='';activeUrl='';pendingSeek=false;
 }
 function currentSourceKey(){return activeKey;}
 const round=x=>Number.isFinite(Number(x))?Math.round(Number(x)*10)/10:null;
 function range(x){
  try{const out=[];for(let i=0;i<Math.min(x?.length||0,5);i++)
    out.push([round(x.start(i)),round(x.end(i))]);return out;}
  catch(_){return [];}
 }
 function diagnostic(){
  return {
   player:'PeakStamp goal playback v42',sourceKey:activeKey,
   currentTime:round(video.currentTime),targetTime:round(wantedTime),
   duration:round(video.duration),paused:video.paused,seeking:video.seeking,
   readyState:video.readyState,networkState:video.networkState,
   videoSize:[video.videoWidth||0,video.videoHeight||0],
   buffered:range(video.buffered),seekable:range(video.seekable),
   mediaError:video.error?{code:video.error.code,message:video.error.message||''}:null,
   pageVisibility:typeof document!=='undefined'?document.visibilityState||'unknown':'unknown',
   lastEvent,lastMessage,lastFailure,fromBeginning,retries,
   events:eventLog.slice(-15)
  };
 }
 return {open,pause,dispose,currentSourceKey,diagnostic};
}
