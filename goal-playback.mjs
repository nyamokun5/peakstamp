/**
 * Goal-only local MOV replay (v60).
 *
 * Deliberately small state machine:
 *   load metadata -> seek clip start -> await seeked/decoded data -> play.
 *
 * Never call play() while a deep seek is pending. That was the cause of
 * long iPhone MOVs starting visibly at source t=0 before seeking.
 * The first opening preloads/seeks while paused; ▶ Replay uses that state.
 */
export function createGoalPlaybackController(video,{
 notify=()=>{},beforePlay=()=>{},
 schedule=(fn,ms)=>setTimeout(fn,ms),
 cancel=id=>clearTimeout(id)
}={}){
 const TOLERANCE=.32;
 const MAX_RESEEKS=2;
 let sourceKey='',sourceUrl='',target=0,serial=0;
 let wantPlay=false,prepared=false,awaitSeek=false;
 let seekAttempts=0,playAttempts=0,playingRequest=false,gestureNeeded=false;
 let pendingTimer=null,frameCallback=null,lastMessage='',phase='idle';
 let lastAttemptedTime=null;
 const clock=()=>Number(video.currentTime)||0;
 const nearTarget=()=>Math.abs(clock()-target)<=TOLERANCE;
 const say=(s)=>{lastMessage=s;notify(s)};
 const cancelTimer=()=>{
  if(pendingTimer!==null)cancel(pendingTimer);
  pendingTimer=null;
 };
 const cancelFrame=()=>{
  if(frameCallback!==null&&typeof video.cancelVideoFrameCallback==='function')
   try{video.cancelVideoFrameCallback(frameCallback)}catch(_){}
  frameCallback=null;
 };
 const later=(fn,delay=10000)=>{
  cancelTimer();
  const id=serial;
  pendingTimer=schedule(()=>{
   pendingTimer=null;
   if(serial===id)fn();
  },delay);
  if(typeof pendingTimer?.unref==='function')pendingTimer.unref();
 };
 function handleError(error){
  if(!wantPlay)return;
  phase='paused';
  playingRequest=false;
  const name=String(error?.name||'');
  if(name==='NotAllowedError'){
   gestureNeeded=true;
   say('ゴール位置への移動は完了しました。iPhoneの再生許可が必要です。▶ リプレイをもう一度押してください。');
  }else if(name==='AbortError'){
   // A pending seek may interrupt a play attempt on Safari; do not
   // loop while the decoder is seeking.
   if(video.seeking||!prepared){phase='seeking';say('ゴール位置に移動中…');}
   else{say('再生が中断されました。▶ リプレイで再開してください。');gestureNeeded=true;}
  }else{
   gestureNeeded=true;
   say('再生できませんでした。▶ リプレイを押してください。'+(name?'（'+name+'）':''));
  }
 }
 function beginPlayback(){
  if(!wantPlay||!prepared||awaitSeek||video.seeking||playingRequest||gestureNeeded)return;
  // Do not start until the media clock has landed on the actual goal.
  // In particular, never try to play while metadata is still pending.
  if(!nearTarget()){seekToGoal();return}
  cancelTimer();
  phase='playing';
  playingRequest=true;
  playAttempts++;
  say('');
  let promise;
  try{promise=video.play()}catch(error){handleError(error);return}
  Promise.resolve(promise).then(()=>{
   playingRequest=false;
   if(!wantPlay)return;
   if(clock()<target-TOLERANCE)guardWrongStart();
  },handleError);
 }
 function finishSeek(){
  if(!sourceKey||!awaitSeek||video.readyState<1)return;
  // A future timestamp is not automatically "ready": an actual seek
  // completion or loaded video frame is required before playing.
  if(video.seeking)return;
  if(!nearTarget()){
   if(seekAttempts<=MAX_RESEEKS){seekToGoal(true);return}
   failSeek();return;
  }
  awaitSeek=false;
  prepared=true;
  phase='ready';
  cancelTimer();
  if(wantPlay)beginPlayback();
  else say('');
 }
 function failSeek(){
  awaitSeek=false;prepared=false;wantPlay=false;phase='seek-failed';
  try{video.pause()}catch(_){}
  say('ゴール位置まで移動できませんでした。▶ リプレイで再試行してください。元動画の0秒からは再生しません。');
 }
 function seekToGoal(force=false){
  if(!sourceKey||video.readyState<1)return;
  // Do not keep assigning currentTime for the same in-flight deep seek.
  if(video.seeking&&!force)return;
  if(seekAttempts>MAX_RESEEKS){failSeek();return}
  seekAttempts++;
  awaitSeek=true;prepared=false;phase='seeking';
  lastAttemptedTime=target;
  say('ゴール位置（'+formatTime(target)+'）へ移動中…');
  try{
   video.currentTime=target;
  }catch(error){
   if(seekAttempts>MAX_RESEEKS){failSeek();return}
   later(()=>seekToGoal(true),400);
   return;
  }
  // Event-driven completion only: Safari may expose the requested
  // currentTime immediately even when the MOV is still showing frame 0.
  // A genuine seeked event, or loadeddata for an already-seeked frame,
  // is needed. If seeked never arrives, show a retry instead of playing t=0.
  later(()=>{if(awaitSeek)failSeek()},12000);
 }
 function guardWrongStart(){
  if(!wantPlay||!sourceKey)return;
  if(clock()>=target-TOLERANCE)return;
  if(awaitSeek||video.seeking){
   try{video.pause()}catch(_){}
   return;
  }
  try{video.pause()}catch(_){}
  playingRequest=false;prepared=false;awaitSeek=false;
  gestureNeeded=false;
  if(seekAttempts>MAX_RESEEKS){failSeek();return}
  say('再生位置が先頭に戻ったため、ゴール位置を再設定しています…');
  seekToGoal(true);
 }
 function inspectFrame(mediaTime){
  frameCallback=null;
  if(!sourceKey||!wantPlay)return;
  // On some iPhones currentTime is correct while the displayed frame
  // is still from 0. Guard the decoded frame time independently.
  if(Number.isFinite(mediaTime)&&mediaTime<target-TOLERANCE){
   guardWrongFrame();
   return;
  }
  watchFirstFrame();
 }
 function guardWrongFrame(){
  if(!wantPlay)return;
  try{video.pause()}catch(_){}
  playingRequest=false;prepared=false;awaitSeek=false;
  gestureNeeded=false;
  if(seekAttempts>MAX_RESEEKS){failSeek();return}
  say('ゴール以外の映像が出たため再調整しています…');
  seekToGoal(true);
 }
 function watchFirstFrame(){
  if(frameCallback!==null||typeof video.requestVideoFrameCallback!=='function')return;
  try{frameCallback=video.requestVideoFrameCallback((_now,metadata)=>{
   inspectFrame(metadata?.mediaTime);
  })}catch(_){frameCallback=null}
 }
 function prepareSource(){
  if(!sourceKey||video.readyState<1)return;
  if(awaitSeek||prepared)return;
  seekToGoal();
 }
 function stopIntent(){
  wantPlay=false;playingRequest=false;gestureNeeded=false;
  cancelTimer();cancelFrame();
  try{video.pause()}catch(_){}
 }
 function open({sourceKey:key,sourceUrl:url,at,autoplay=false,fromStart=false}){
  if(!key||!url)return false;
  // The target is ALWAYS an actual clip start (except an explicit
  // debugging fromStart call), never a source-relative fallback to zero.
  const requested=fromStart?0:Math.max(0,Number(at)||0);
  const change=sourceKey!==key||sourceUrl!==url;
  const changedTarget=Math.abs(target-requested)>TOLERANCE;
  serial++;
  cancelTimer();cancelFrame();
  const alreadyPrepared=!change&&!changedTarget&&prepared&&!video.seeking;
  stopIntent();
  sourceKey=key;sourceUrl=url;target=requested;
  wantPlay=Boolean(autoplay);
  gestureNeeded=false;playingRequest=false;
  seekAttempts=0;playAttempts=0;
  video.hidden=false;video.playsInline=true;
  video.setAttribute('playsinline','');
  video.setAttribute('webkit-playsinline','');
  if(autoplay)beforePlay(); // synchronous user-gesture dependent cleanup
  if(change){
   prepared=false;awaitSeek=false;phase='loading';
   video.preload='auto';
   video.src=url; // only when changing source: no extra MOV reload
   say('動画を読み込み、ゴール位置を準備しています…');
  }else if(alreadyPrepared&&nearTarget()){
   // This is the fast path: user tapped ▶ after initial paused preview
   // already sought to the correct goal start.
   prepared=true;awaitSeek=false;phase='ready';
   beginPlayback(); // synchronously inside the Replay button tap
  }else{
   prepared=false;awaitSeek=false;phase='loading';
   prepareSource();
  }
  return change;
 }
 function pause(){
  stopIntent();phase='paused';
 }
 function dispose(){
  serial++;stopIntent();
  sourceKey='';sourceUrl='';target=0;
  prepared=false;awaitSeek=false;phase='idle';
  try{video.removeAttribute('src');video.load()}catch(_){}
  video.hidden=true;
 }
 video.addEventListener('loadedmetadata',()=>{
  if(!sourceKey)return;
  prepareSource();
 });
 video.addEventListener('loadeddata',()=>{
  // 'loadeddata' can still refer to frame 0 when currentTime already reads
  // the *requested* goal time; never mistake that for seek completion.
  if(awaitSeek&&target<=TOLERANCE&&!video.seeking)finishSeek();
  else if(!prepared)prepareSource();
 });
 video.addEventListener('seeked',()=>{
  if(awaitSeek)finishSeek();
 });
 video.addEventListener('canplay',()=>{
  // A deep MOV is ready only on 'seeked', not on generic canplay.
  if(awaitSeek&&target<=TOLERANCE&&!video.seeking)finishSeek();
 });
 video.addEventListener('playing',()=>{
  if(!wantPlay)return;
  if(!prepared||awaitSeek||video.seeking||clock()<target-TOLERANCE){
   guardWrongStart();
   return;
  }
  phase='playing';watchFirstFrame();
 });
 video.addEventListener('timeupdate',()=>{
  if(!wantPlay)return;
  if(clock()<target-TOLERANCE)guardWrongStart();
 });
 video.addEventListener('pause',()=>{
  if(!wantPlay)return;
  if(phase==='playing')phase='paused';
 });
 video.addEventListener('error',()=>{
  if(!sourceKey)return;
  phase='error';wantPlay=false;prepared=false;awaitSeek=false;cancelTimer();
  const code=video.error?.code;
  say(code===4?'このMOV形式をSafariで再生できません。元動画の形式を確認してください。':
   '動画の読み込みに失敗しました。元動画を選び直してください。');
 });
 function currentSourceKey(){return sourceKey}
 function diagnostic(){
  return {player:'PeakStamp goal replay v60',sourceKey,
   currentTime:Number(video.currentTime)||0,targetTime:target,
   readyState:video.readyState,seeking:video.seeking,paused:video.paused,
   phase,prepared,awaitSeek,seekAttempts,playAttempts,
   gestureNeeded,lastMessage,lastAttemptedTime};
 }
 function formatTime(t){
  const m=Math.floor(t/60),s=Math.floor(t%60);
  return m+':'+String(s).padStart(2,'0');
 }
 return {open,pause,dispose,currentSourceKey,diagnostic};
}
