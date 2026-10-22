/** Pause/resume the trim preview without discarding the selected seek time.
 * Only restart from scene start if the playhead is outside its bounds.
 */
export function toggleScenePreviewPlayback(video,bounds,{
  restart=()=>{},onBeforePlay=()=>{},onError=()=>{}
}={}){
 if(!video)return;
 if(!video.paused){
   video.pause();
   return;
 }
 const start=Math.max(0,Number(bounds?.start)||0);
 const end=Math.max(start,Number(bounds?.end)||0);
 if(video.currentTime>=end-.08 || video.currentTime<start-.1){
   restart();
   return;
 }
 try {
   onBeforePlay();
   Promise.resolve(video.play()).catch(onError);
 } catch(e) {onError(e);}
}


/**
 * Seek once when the user releases the preview progress slider.
 * Avoid decoding on every thumb movement: long iPhone MOV files can stall
 * when Safari receives a burst of deep seeks.
 * This changes video playback only, not the saved clip boundaries.
 */
export function seekScenePreview(video,seconds,bounds,{
 autoPlay=false,onBeforePlay=()=>{},onError=()=>{}
}={}){
 if(!video || !Number.isFinite(Number(seconds)))return null;
 const start=Math.max(0,Number(bounds?.start)||0);
 const end=Math.max(start,Number(bounds?.end)||start);
 // When autoplaying, a drop at the right edge must leave a playable frame
 // before the configured trim end; otherwise the end watcher pauses at once.
 const lastPlayable=autoPlay&&end>start?Math.max(start,end-.2):end;
 const target=Math.round(Math.min(lastPlayable,Math.max(start,Number(seconds)))*10)/10;
 try {
  video.pause();
  // A single seek even for a long MOV: no seeking during pointer movement.
  video.currentTime=target;
 } catch(_) {return null;}
 if(autoPlay){
  // Request play synchronously in pointerup/keyboard interaction on iOS.
  try {
   onBeforePlay();
   Promise.resolve(video.play()).catch(onError);
  } catch(error){onError(error);}
 }
 return target;
}
