/**
 * Decode WAV sections one at a time but overlap their Gemini HTTP requests.
 * At most 2 requests are in flight to limit memory and API pressure on iPhone.
 * Completed sections are cached individually. Full answers stay in source order.
 */
export async function runGeminiFastPipeline({
  ranges, makeSegment, request, cached=()=>null, save=()=>{}, onWav=async()=>{},
  onProgress=()=>{}, isCancelled=()=>false, onFailure=()=>{},
  concurrency=2
}={}) {
  if(!Array.isArray(ranges)||typeof makeSegment!=='function'||typeof request!=='function')
    throw Error('Gemini音声区間の設定が不正です。');
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>3)
    throw Error('Geminiの並列数が不正です。');
  const replies=new Array(ranges.length);
  const pending=new Set();
  let done=0,reused=0,submitted=0;
  const check=()=>{if(isCancelled())throw Error('解析を中止しました。');};
  const report=(index,phase)=>{
    onProgress({index,phase,done,total:ranges.length,reused,submitted,inFlight:pending.size});
  };
  async function settleOne(){
    const outcome=await Promise.race(pending);
    pending.delete(outcome.promise);
    if(!outcome.ok)throw outcome.error;
  }
  function startRequest(wav,range,index){
    // Wrap success and failure, so a request that finishes while another WAV
    // is being decoded never creates an unhandled rejection.
    let promise;
    promise=Promise.resolve().then(()=>request(wav,range,index)).then(answer=>{
      check();
      if(!answer||!Array.isArray(answer.events))throw Error('Geminiの区間結果が不正です。');
      save(range,answer,index);
      replies[index]={...answer,startSeconds:range.startSeconds};
      done++;
      report(index,'received');
    }).then(()=>({ok:true,promise}),error=>({ok:false,promise,error}));
    pending.add(promise);
  }
  try{
    check();
    for(let index=0;index<ranges.length;index++){
      check();
      const range=ranges[index];
      const previous=cached(range,index);
      if(previous&&Array.isArray(previous.events)){
        replies[index]={...previous,startSeconds:range.startSeconds};
        reused++;done++;
        report(index,'cached');
        continue;
      }
      // Wait BEFORE decoding another chunk, keeping at most two API
      // requests and one WAV decode active at a time.
      if(pending.size>=concurrency)await settleOne();
      check();
      report(index,'decoding');
      const wav=await makeSegment(range,index);
      check();
      await onWav(wav,range,index);
      check();
      submitted++;
      startRequest(wav,range,index);
      report(index,'submitted');
    }
    while(pending.size)await settleOne();
    check();
    return {responses:replies,completed:done,reused,submitted};
  }catch(error){
    onFailure(error);
    throw error;
  }
}
