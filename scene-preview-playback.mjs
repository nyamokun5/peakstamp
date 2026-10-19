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
