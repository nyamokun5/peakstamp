/**
 * iPhone-Safari-compatible local MOV playback for the PS goal review.
 * Keep one player: a new source is loaded only when the source key changes.
 * iOS playback requires a synchronous .play() from the original tap.
 * The metadata/seek events can retry a transient AbortError afterwards.
 */
export function createGoalPlaybackController(video,{notify=()=>{},beforePlay=()=>{}}={}){
 let activeKey='',activeUrl='',wantedTime=0,pendingSeek=false,wantsPlayback=false;
 let requestId=0,playPending=false,retryNeeded=false,denied=false,retries=0;
 const report=(message)=>notify(message);
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
   video.currentTime=wantedTime;
   pendingSeek=false;
   report(video.seeking?'ゴール位置に移動中…':'');
   return true;
  }catch(_){report('動画の位置を調整しています…');return false;}
 }
 function startPlay(token,{userGesture=false}={}){
  if(token!==requestId||!wantsPlayback||playPending||denied)return;
  if(userGesture)beforePlay();
  // Keep the original gesture alive: call play synchronously before any awaits.
  let attempt;
  try{attempt=video.play();}
  catch(error){handlePlayFailure(token,error);return;}
  if(attempt&&typeof attempt.then==='function'){
   playPending=true;
   Promise.resolve(attempt).then(()=>{
    if(token!==requestId)return;
    playPending=false;retryNeeded=false;
   },error=>{
    if(token!==requestId)return;
    playPending=false;handlePlayFailure(token,error);
   });
  }
 }
 function handlePlayFailure(token,error){
  if(token!==requestId||!wantsPlayback)return;
  const message=mediaError(error);
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
  retries++;
  retryNeeded=false;
  startPlay(requestId);
 }
 video.addEventListener('loadedmetadata',()=>{
  seek();
  retryWhenReady();
 });
 video.addEventListener('loadeddata',retryWhenReady);
 video.addEventListener('canplay',retryWhenReady);
 video.addEventListener('seeked',()=>{retryWhenReady();if(!video.paused)report('');});
 video.addEventListener('playing',()=>{retryNeeded=false;report('');});
 video.addEventListener('waiting',()=>report('動画の読み込み中…'));
 video.addEventListener('stalled',()=>report('読み込みが一時停止しています。画面の▶で再開できます。'));
 video.addEventListener('error',()=>{
  const code=video.error?.code;
  report(code===4
   ?'SafariがこのMOVの形式を再生できません。iPhoneの写真アプリで開けるか確認してください。'
   :code===3
   ?'動画のデコードに失敗しました。動画画面の▶か、元ファイルの再選択をお試しください。'
   :'動画を読み込めませんでした。ファイルを再選択してください。');
 });

 function open({sourceKey,sourceUrl,at,autoplay=false}){
  if(!sourceKey||!sourceUrl)return false;
  requestId++;
  const token=requestId;
  wantedTime=Math.max(0,Number(at)||0);
  pendingSeek=true;wantsPlayback=Boolean(autoplay);
  playPending=false;retryNeeded=false;denied=false;retries=0;
  // IMPORTANT: the containing player and <video> must be unhidden BEFORE
  // setting src or play() on Safari, otherwise decoding may remain suspended.
  video.hidden=false;
  video.playsInline=true;
  video.setAttribute('playsinline','');
  video.setAttribute('webkit-playsinline','');
  const switching=activeKey!==sourceKey||activeUrl!==sourceUrl;
  if(switching){
   video.pause();
   video.preload='auto';
   video.src=sourceUrl; // .src assignment initiates load; never double load().
   activeKey=sourceKey;activeUrl=sourceUrl;
  }
  // On a new src, wait for its metadata: readyState may still describe
  // the previous source during Safari's media-resource reset.
  if(!switching)seek();
  if(autoplay){
   report('動画を準備しています…');
   startPlay(token,{userGesture:true});
  }else video.pause();
  return switching;
 }
 function pause(){wantsPlayback=false;retryNeeded=false;video.pause();}
 function dispose(){
  requestId++;wantsPlayback=false;retryNeeded=false;playPending=false;
  video.pause();video.removeAttribute('src');video.load();
  video.hidden=true;activeKey='';activeUrl='';pendingSeek=false;
 }
 function currentSourceKey(){return activeKey;}
 return {open,pause,dispose,currentSourceKey};
}
