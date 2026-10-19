/**
 * Compare prior candidate-level labels across local video scans.
 * Pure, browser-local, no timestamps to type, no claim of full-video recall.
 */
export function priorShotLabels(feedback,source){
  const size=Number(source?.file?.size),duration=Number(source?.duration);
  if(!Number.isSafeInteger(size)||size<=0||!(duration>0))return [];
  const found=[];
  for(const [key,label] of Object.entries(feedback||{})){
    if(!['shot','goal','save'].includes(label))continue;
    const fields=key.split('::');
    if(fields.length<5||fields.at(-1)!=='video-motion'||Number(fields.at(-4))!==size)continue;
    const ms=Number(fields.at(-2));
    if(!Number.isSafeInteger(ms)||ms<0||ms>1000*(duration+1))continue;
    found.push({timeSeconds:ms/1000,label});
  }
  found.sort((a,b)=>a.timeSeconds-b.timeSeconds);
  const unique=[];
  for(const m of found){
    const similar=unique.find(x=>Math.abs(x.timeSeconds-m.timeSeconds)<=4);
    if(similar)similar.previousLabels=[...new Set([...similar.previousLabels,m.label])];
    else unique.push({...m,previousLabels:[m.label]});
  }
  return unique.slice(0,100);
}
export function comparePriorShots(prior,candidates,toleranceSeconds=5){
  const tolerance=Math.max(1,Math.min(12,Number(toleranceSeconds)||5));
  const rows=(prior||[]).map(mark=>{
    let nearest=null,gap=Infinity;
    for(const c of candidates||[]){
      const time=Number(c.peakSeconds??c.timeSeconds);
      if(!Number.isFinite(time))continue;
      const distance=Math.abs(time-mark.timeSeconds);
      if(distance<gap){gap=distance;nearest=time;}
    }
    return {timeSeconds:mark.timeSeconds,previousLabels:mark.previousLabels||[mark.label],
      newCandidateNear:gap<=tolerance,
      newCandidateTimeSeconds:gap<=tolerance?nearest:null,
      secondsApart:gap<=tolerance?+gap.toFixed(2):null};
  });
  return {previouslyLabeledShots:rows.length,rediscovered:rows.filter(x=>x.newCandidateNear).length,
    notRediscovered:rows.filter(x=>!x.newCandidateNear).length,
    toleranceSeconds:tolerance,rows,
    caveat:'過去にラベル付けした候補との時刻照合。動画内の全シュート数・見逃し率は測定できない。'};
}
