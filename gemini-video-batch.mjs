/**
 * Sequentially process selected videos to bound Safari memory usage.
 * Each file can run Gemini's existing limited per-chunk parallel pipeline.
 * Failures are recorded per file and never prevent later files from running;
 * cancellation prevents starting further files.
 */
export async function runGeminiVideoBatch({
 videos, processVideo, isAlreadyAnalyzed=()=>false,
 isCancelled=()=>false, onProgress=()=>{}
}={}) {
 if(!Array.isArray(videos)||typeof processVideo!=='function')
   throw new Error('一括解析の動画が指定されていません。');
 let success=0,skipped=0;
 const failures=[];
 const total=videos.length;
 const progress=(phase,index,video)=>{
  onProgress({phase,index,total,processed:success+skipped+failures.length,
   success,skipped,failures:failures.length,video});
 };
 for(let index=0;index<total;index++){
  if(isCancelled())break;
  const video=videos[index];
  progress('starting',index,video);
  if(isAlreadyAnalyzed(video)){
   skipped++;
   progress('skipped',index,video);
   continue;
  }
  try{
   await processVideo(video,index);
   if(isCancelled())break;
   success++;
   progress('complete',index,video);
  }catch(e){
   if(isCancelled())break;
   failures.push({
    name:video?.file?.name||'動画 '+(index+1),
    error:e?.message||String(e)
   });
   progress('failed',index,video);
  }
 }
 return {total,success,skipped,failures,
   processed:success+skipped+failures.length,cancelled:Boolean(isCancelled())};
}
