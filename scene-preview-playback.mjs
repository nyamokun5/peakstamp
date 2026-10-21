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
export function seekScenePreview(video,seconds,bounds){
 if(!video || !Number.isFinite(Number(seconds)))return null;
 const start=Math.max(0,Number(bounds?.start)||0);
 const end=Math.max(start,Number(bounds?.end)||start);
 const target=Math.round(Math.min(end,Math.max(start,Number(seconds)))*10)/10;
 try {
  video.pause();
  video.currentTime=target;
  return target;
 } catch(_) {return null;}
}
