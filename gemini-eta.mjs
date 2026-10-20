/**
 * Best-effort Gemini ETA based only on measured time in this run.
 *
 * Different videos can have very different durations / codecs / network speeds,
 * so do not claim an ETA before observing a completed chunk or a whole file.
 * File-level durations exclude previously analyzed files and are separated
 * into restored-from-cache and fresh Gemini request categories.
 */
export function formatGeminiEta(seconds) {
 if(!Number.isFinite(seconds)||seconds<0)return null;
 if(seconds<60)return '1分未満';
 const mins=Math.ceil(seconds/60);
 if(mins<60)return mins+'分';
 return Math.floor(mins/60)+'時間'+(mins%60?mins%60+'分':'');
}
export function createGeminiEta({now=()=>performance.now()}={}) {
 let videos=[],isFinished=()=>false,hasSavedAnswer=()=>false;
 let completed=new Set(),history=[],active=null;
 const valid=(ms)=>Number.isFinite(ms)&&ms>0;
 const mean=(category)=>{
  const samples=history.filter(item=>item.cached===category).map(item=>item.ms).filter(valid);
  return samples.length?samples.reduce((a,b)=>a+b,0)/samples.length:null;
 };
 const remainingChunkMs=()=>{
  if(!active||active.cached||active.phase!=='segments')return null;
  const elapsed=now()-active.started,done=active.done,total=active.total;
  if(!(total>done&&done>0&&elapsed>=8000))return null;
  if(done<2&&total>2)return null; // Two concurrent requests; need some throughput.
  return Math.max(0,(total-done)*elapsed/done)+10000; // ~10s for final waveform/commit.
 };
 function currentRemaining(){
  if(!active)return null;
  const elapsed=now()-active.started;
  if(active.phase==='finishing')return null; // waveform may require another local decode
  const fromChunks=remainingChunkMs();
  if(fromChunks!==null)return fromChunks;
  const prior=mean(active.cached);
  return prior!==null ? Math.max(5000,prior-elapsed) : null;
 }
 function remaining(){
  let current=currentRemaining();
  let total=0,known=true;
  if(active){
   if(current===null)known=false;
   else total+=current;
  }
  for(const source of videos){
   if(completed.has(source)||source===active?.source)continue;
   if(isFinished(source))continue;
   const prior=mean(Boolean(hasSavedAnswer(source)));
   const projected=prior??(
    active&&!active.cached&&!hasSavedAnswer(source)&&active.total>0&&active.done>0&&
    now()-active.started>=8000&&remainingChunkMs()!==null
     ? (now()-active.started)*active.total/active.done+10000
     : null
   );
   if(projected===null)known=false;
   else total+=projected;
  }
  return {
   currentSeconds:current===null?null:current/1000,
   totalSeconds:known?total/1000:null,
   completed:completed.size,
   remainingFiles:videos.filter(s=>!completed.has(s)&&!isFinished(s)).length,
   isFinishing:Boolean(active&&active.phase==='finishing'),
  };
 }
 return {
  start(input,{finished=()=>false,cached=()=>false}={}){
   videos=Array.isArray(input)?input.slice():[];
   isFinished=finished;hasSavedAnswer=cached;
   completed=new Set();history=[];active=null;
  },
  begin(source){
   if(active?.source===source)return;
   active={source,cached:Boolean(hasSavedAnswer(source)),
    started:now(),done:0,total:0,phase:'preparing'};
  },
  chunks(done,total){
   if(!active)return;
   if(Number.isFinite(total)&&total>0){
    active.total=total;
    active.done=Math.max(active.done,Math.min(total,Number(done)||0));
    active.phase='segments';
   }
  },
  finishing(){
   if(active)active.phase='finishing';
  },
  end(source,{skipped=false,failed=false}={}){
   if(!source)return;
   if(active?.source===source&&!skipped&&!failed){
    const ms=now()-active.started;
    if(valid(ms))history.push({ms,cached:active.cached});
   }
   completed.add(source);
   if(active?.source===source)active=null;
  },
  estimate:remaining,
  clear(){videos=[];active=null;history=[];completed=new Set();}
 };
}
