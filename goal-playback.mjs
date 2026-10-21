/**
 * iPhone-Safari-compatible local MOV playback for the PS goal review.
 * Keep one player: a new source is loaded only when the source key changes.
 * iOS playback requires a synchronous .play() from the original tap.
 * The metadata/seek events can retry a transient AbortError afterwards.
 */
export function createGoalPlaybackController(video,{
 notify=()=>{},beforePlay=()=>{},
 now=()=>Date.now(),
 scheduleWatchdog=(fn,ms)=>setInterval(fn,ms),
 cancelWatchdog=id=>clearInterval(id)
}={}){
 let activeKey='',activeUrl='',wantedTime=0,pendingSeek=false,wantsPlayback=false;
 let requestId=0,playPending=false,retryNeeded=false,denied=false,retries=0;
 let seekingOwnJump=false,expectResume=false,fromBeginning=false,progressWatch=0;
 let lastProgress=0,lastEvent='init',lastMessage='',lastFailure='';
 let frameCallbackId=null,decodedFrames=0,lastFrameAt=null,lastFrameMediaTime=null;
 let lastFramePresentedCount=null,lastVisibilityAt=null,visibilityChanges=0;
 let playbackOpenedAt=null,firstFrameDelayMs=null;
 let suspectedFreeze=null,playingStartedAt=null,playingStartPosition=null,watchdogId=null;
 let lastWatchClock=null,lastWatchAt=null;
 const freezeHistory=[];
 const eventLog=[];
 const timeNow=now;
 const visible=()=>typeof document==='undefined'||document.visibilityState!=='hidden';
 function stopWatchdog(){
  if(watchdogId!==null)cancelWatchdog(watchdogId);
  watchdogId=null;lastWatchClock=null;lastWatchAt=null;
 }
 function markFreeze(reason,clockAdvance){
  if(suspectedFreeze||!wantsPlayback||video.paused||video.seeking||!visible())return;
  suspectedFreeze={
   sourceKey:activeKey,attemptId:requestId,reason,
   detectedAt:timeNow(),playbackTime:Number(video.currentTime)||0,
   // The displayed frame is more useful than the audio/media clock for
   // identifying a repeatable decoding/keyframe boundary.
   lastRenderedMediaTime:lastFrameMediaTime,
   suspectedMediaPosition:lastFrameMediaTime??wantedTime,
   framesAtDetection:decodedFrames,timeAdvanceSeconds:clockAdvance,
   pageVisibility:typeof document!=='undefined'?document.visibilityState||'unknown':'unknown'
  };
  freezeHistory.push(suspectedFreeze);
  if(freezeHistory.length>5)freezeHistory.shift();
  record('video-frame-freeze-suspected');
  report('動画の読み込みに時間がかかっています。動画画面の▶で再生をお試しください。');
 }
 function closeFreeze(reason){
  if(!suspectedFreeze)return;
  suspectedFreeze.endedReason=reason;
  suspectedFreeze=null;
 }
 function startWatchdog(){
  stopWatchdog();
  if(!hasVideoFrames)return;
  lastWatchClock=Number(video.currentTime)||0;
  lastWatchAt=timeNow();
  watchdogId=scheduleWatchdog(()=>{
   if(!wantsPlayback||video.paused||video.seeking||!visible()){
    lastWatchClock=Number(video.currentTime)||0;
    lastWatchAt=timeNow();
    return;
   }
   const now=timeNow(),clock=Number(video.currentTime)||0;
   const earliestFrame=lastFrameAt??playingStartedAt;
   const stalledFor=earliestFrame===null?0:now-earliestFrame;
   const advancedFromWatch=clock-(lastWatchClock??clock);
   const advancedFromFrame=clock-(lastFrameMediaTime??playingStartPosition??clock);
   // A progressing media clock is not proof of frame presentation.
   if(stalledFor>=3000&&advancedFromFrame>=.5&&
     (advancedFromWatch>=.15||clock>(playingStartPosition??clock)+.5))
    markFreeze('frame-watchdog',Math.round(advancedFromFrame*10)/10);
   lastWatchClock=clock;lastWatchAt=now;
  },1200);
  // In Node tests this background diagnostic must never keep the process alive.
  if(typeof watchdogId?.unref==='function')watchdogId.unref();
 }
 const hasVideoFrames=typeof video.requestVideoFrameCallback==='function';
 function cancelFrameWatch(){
  if(frameCallbackId!==null&&typeof video.cancelVideoFrameCallback==='function')
   try{video.cancelVideoFrameCallback(frameCallbackId);}catch(_){}
  frameCallbackId=null;
 }
 function watchFrames(){
  if(!hasVideoFrames||frameCallbackId!==null)return;
  const token=requestId;
  const onFrame=(_now,metadata)=>{
   frameCallbackId=null;
   if(token!==requestId||!wantsPlayback)return;
   const first=decodedFrames===0;
   decodedFrames++;
   lastFrameAt=timeNow();
   if(suspectedFreeze&&suspectedFreeze.attemptId===requestId){
    suspectedFreeze.recoveredAfterMs=lastFrameAt-suspectedFreeze.detectedAt;
    suspectedFreeze.recoveredAt=lastFrameAt;
    suspectedFreeze.endedReason='frames-resumed';
    record('video-frames-resumed');
    report('映像フレームの更新が再開しました。');
    suspectedFreeze=null;
   }
   if(first&&playbackOpenedAt!==null)firstFrameDelayMs=lastFrameAt-playbackOpenedAt;
   if(Number.isFinite(metadata?.mediaTime))lastFrameMediaTime=metadata.mediaTime;
   if(Number.isFinite(metadata?.presentedFrames))lastFramePresentedCount=metadata.presentedFrames;
   if(first)record('first-video-frame');
   watchFrames();
  };
  try{frameCallbackId=video.requestVideoFrameCallback(onFrame);}
  catch(_){frameCallbackId=null;}
 }
 const record=(name)=>{
  lastEvent=name;
  eventLog.push({event:name,time:Number(video.currentTime)||0,
   readyState:video.readyState,networkState:video.networkState,
   paused:video.paused,seeking:video.seeking,
   frameCount:decodedFrames});
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
  watchFrames();
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
  playingStartedAt=timeNow();playingStartPosition=Number(video.currentTime)||0;
  startWatchdog();
  // A resolved play() promise can still leave an iOS video frozen on one frame.
  if(progressWatch)clearTimeout(progressWatch);
  watchFrames();
  const token=requestId,at=lastProgress,framesAtStart=decodedFrames;
  progressWatch=setTimeout(()=>{
   progressWatch=0;
   if(token!==requestId||video.paused||video.seeking)return;
   const audioClockAdvance=Math.abs((Number(video.currentTime)||0)-at);
   if(audioClockAdvance<.15)
    report('動画の再生が進んでいません。動画画面の▶で再生をお試しください。');
   else if(hasVideoFrames&&decodedFrames===framesAtStart&&visible())
    markFreeze('initial-playing-no-frames',Math.round(audioClockAdvance*10)/10);
  },3000);
 });
 video.addEventListener('timeupdate',()=>{
  const time=Number(video.currentTime)||0;
  if(Math.abs(time-lastProgress)>.2){lastProgress=time;record('timeupdate');}
 });
 video.addEventListener('pause',()=>{
  record('pause');
  stopWatchdog();
  if(wantsPlayback&&seekingOwnJump)expectResume=true;
  else if(wantsPlayback&&!pendingSeek&&!denied)
   report('再生が一時停止しました。動画画面の▶で再開してください。');
 });
 video.addEventListener('ended',()=>{
  record('ended');stopWatchdog();closeFreeze('video-ended');
  report('動画が最後まで再生されました。別のゴール候補を選ぶか、再生ボタンで戻れます。');
 });
 video.addEventListener('suspend',()=>record('suspend'));
 // Returning to a backgrounded Safari tab may restart the compositor/decoder.
 if(typeof document!=='undefined'&&typeof document.addEventListener==='function')
  document.addEventListener('visibilitychange',()=>{
   visibilityChanges++;lastVisibilityAt=timeNow();
   record('visibility:'+String(document.visibilityState||'unknown'));
   if(document.visibilityState==='hidden'){
    stopWatchdog();closeFreeze('page-hidden');
   }else if(wantsPlayback){
    watchFrames();if(!video.paused)startWatchdog();
   }
  });
 video.addEventListener('waiting',()=>{record('waiting');report('動画の読み込み中…');});
 video.addEventListener('stalled',()=>{record('stalled');report('動画の読み込みが一時停止しています。動画画面の▶で再開してください。');});
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
  closeFreeze('new-playback-attempt');
  stopWatchdog();
  requestId++;
  const token=requestId;
  if(progressWatch){clearTimeout(progressWatch);progressWatch=0;}
  cancelFrameWatch();
  decodedFrames=0;lastFrameAt=null;lastFrameMediaTime=null;
  lastFramePresentedCount=null;firstFrameDelayMs=null;
  playbackOpenedAt=timeNow();
  playingStartedAt=null;playingStartPosition=null;
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
  closeFreeze('manual-pause');stopWatchdog();
  if(progressWatch){clearTimeout(progressWatch);progressWatch=0;}
  cancelFrameWatch();
  video.pause();
 }
 function dispose(){
  closeFreeze('disposed');stopWatchdog();
  requestId++;wantsPlayback=false;retryNeeded=false;playPending=false;
  if(progressWatch){clearTimeout(progressWatch);progressWatch=0;}
  cancelFrameWatch();
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
 function repeatFreezeLocations(){
  const rows=[];
  for(const freeze of freezeHistory){
   const pos=Number(freeze.suspectedMediaPosition);
   if(!Number.isFinite(pos)||pos<0)continue;
   let group=rows.find(x=>x.sourceKey===freeze.sourceKey&&
    Math.abs(x.approxPositionSeconds-pos)<=2);
   if(!group){
    group={sourceKey:freeze.sourceKey,approxPositionSeconds:Math.round(pos*10)/10,
     attempts:[],records:0};rows.push(group);
   }
   group.records++;
   if(!group.attempts.includes(freeze.attemptId))group.attempts.push(freeze.attemptId);
  }
  return rows.map(x=>({...x,repeatAcrossAttempts:x.attempts.length>=2}))
   .sort((a,b)=>b.attempts.length-a.attempts.length);
 }
 function diagnostic(){
  let quality=null;
  try{
   if(typeof video.getVideoPlaybackQuality==='function'){
    const x=video.getVideoPlaybackQuality();
    quality={totalVideoFrames:x.totalVideoFrames,droppedVideoFrames:x.droppedVideoFrames,
     corruptedVideoFrames:x.corruptedVideoFrames??null};
   }
  }catch(_){}
  const now=timeNow();
  return {
   player:'PeakStamp goal playback v45',sourceKey:activeKey,
   currentTime:round(video.currentTime),targetTime:round(wantedTime),
   duration:round(video.duration),paused:video.paused,seeking:video.seeking,
   readyState:video.readyState,networkState:video.networkState,
   videoSize:[video.videoWidth||0,video.videoHeight||0],
   buffered:range(video.buffered),seekable:range(video.seekable),
   mediaError:video.error?{code:video.error.code,message:video.error.message||''}:null,
   pageVisibility:typeof document!=='undefined'?document.visibilityState||'unknown':'unknown',
   lastEvent,lastMessage,lastFailure,fromBeginning,retries,
   frameDiagnostics:{
    supported:hasVideoFrames,decodedFrames,lastFrameMediaTime,
    lastFramePresentedCount,
    lastFrameAgeMs:lastFrameAt!==null?now-lastFrameAt:null,
    firstFrameDelayMs,quality,
    playbackElapsedMs:playbackOpenedAt!==null?now-playbackOpenedAt:null
   },
   visibility:{changes:visibilityChanges,lastChangeAgeMs:lastVisibilityAt!==null?now-lastVisibilityAt:null},
   activeAttemptId:requestId,freezeCurrentlySuspected:!!suspectedFreeze,
   repeatFreezeLocations:repeatFreezeLocations(),
   frameFreezeHistory:freezeHistory.map(x=>({
    sourceKey:x.sourceKey,attemptId:x.attemptId,reason:x.reason,
    endedReason:x.endedReason??null,detectedAt:x.detectedAt,
    playbackTime:Math.round(x.playbackTime*10)/10,
    lastRenderedMediaTime:x.lastRenderedMediaTime??null,
    suspectedMediaPosition:Math.round(x.suspectedMediaPosition*10)/10,
    framesAtDetection:x.framesAtDetection,timeAdvanceSeconds:Math.round(x.timeAdvanceSeconds*10)/10,
    pageVisibility:x.pageVisibility,
    recoveredAfterMs:x.recoveredAfterMs??null,
    recoveredAt:x.recoveredAt??null
   })),
   events:eventLog.slice(-15)
  };
 }
 return {open,pause,dispose,currentSourceKey,diagnostic};
}
