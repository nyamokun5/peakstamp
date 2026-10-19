/**
 * Broad, optional AI discovery pool. Does not change the normal PeakStamp
 * candidate list / review decisions / export plan.
 *
 * Sources:
 *  - existing audio highlights (user's current settings)
 *  - sensitive audio peak search with a shorter min-gap
 *  - additional relative-volume surges from raw 250ms audio bins
 *
 * A pool can still miss silent plays; the algorithm does not see video.
 */
import { detectHighlights } from './detector.mjs?v=audio12';

export const EXPLORATION_LIMIT=20;
const GAP_SECONDS=7;

export function rawSurgeCandidates(bins,leadSeconds=7,binSeconds=.25) {
  if(!Array.isArray(bins)||bins.length<12)return [];
  const value=bins.map(b=>Math.max(0,Number(b?.rms)||0));
  const smooth=value.map((_,i)=>{
    let s=0,count=0;
    for(let j=Math.max(0,i-1);j<=Math.min(value.length-1,i+1);j++){s+=value[j]*value[j];count++;}
    return Math.sqrt(s/count);
  });
  const sorted=[...smooth].sort((a,b)=>a-b);
  const percentile=p=>sorted[Math.min(sorted.length-1,Math.floor(p*(sorted.length-1)))];
  const median=percentile(.5),p85=percentile(.85),p97=percentile(.97);
  const spread=Math.max(.004,p97-median);
  // Avoid manufacturing events from silence or constant machinery hum.
  if(p97<.009 || p97<median*1.14)return [];
  const gate=Math.max(.008,median*1.32,p85*.77);
  const found=[];
  const span=Math.max(2,Math.round(.8/binSeconds));
  for(let i=span;i<smooth.length-span;i++){
    const level=smooth[i];
    if(level<gate)continue;
    let peak=true;
    for(let j=i-span;j<=i+span;j++){
      if(smooth[j]>level+1e-10 || (j<i&&Math.abs(smooth[j]-level)<1e-10)){peak=false;break;}
    }
    if(!peak)continue;
    const b0=Math.max(0,i-Math.round(6/binSeconds));
    const b1=Math.max(b0+1,i-Math.round(.8/binSeconds));
    let background=0;
    for(let j=b0;j<b1;j++)background+=smooth[j];
    background/=(b1-b0);
    const contrast=level/Math.max(.004,background);
    const prominence=(level-median)/spread;
    if(contrast<1.17&&prominence<.38)continue;
    const signal=.25*Math.min(2,Math.max(0,prominence))+.13*Math.min(2,Math.max(0,contrast-1));
    const score=Math.round(Math.min(.98,Math.max(.12,.26+signal))*1000)/1000;
    const second=Number.isFinite(bins[i]?.time)?Number(bins[i].time):i*binSeconds;
    found.push({id:'explore-'+Math.round(second*1000),peakSeconds:second,
      time:Math.max(0,Math.floor(second-leadSeconds)),score,db:20*Math.log10(level)});
  }
  return found.sort((a,b)=>b.score-a.score||a.peakSeconds-b.peakSeconds).slice(0,100);
}

function entry(source,candidate,discovery,originalRank=null) {
  const time=Math.max(0,Number(candidate.peakSeconds)||0);
  return {
    key:[source.file.name,source.file.size,source.file.lastModified,Math.round(time*1000)].join('::'),
    sourceId:source.id,candidateId:candidate.id,fileName:source.file.name,
    duration:source.duration,peakSeconds:time,time:candidate.time,
    score:Number(candidate.score),source,candidate,discovery,originalRank
  };
}
function tooClose(candidate,selected,minimum=GAP_SECONDS) {
  return selected.some(x=>x.sourceId===candidate.sourceId &&
    Math.abs(x.peakSeconds-candidate.peakSeconds)<minimum);
}
export function discoverScenePool(sources,options={}) {
  const limit=Math.max(1,Math.min(40,Number(options.limit)||EXPLORATION_LIMIT));
  const originals=[];
  const sensitive=[];
  const surges=[];
  for(const source of sources||[]) {
    if(!source?.bins?.length||!(source.duration>0))continue;
    for(const candidate of source.candidates||[]) {
      if(Number.isFinite(Number(candidate.score)))originals.push(entry(source,candidate,'existing'));
    }
    const wider=detectHighlights(source.bins,{
      sensitivity:'sensitive',leadSeconds:7,binSeconds:.25,
      minGapSeconds:GAP_SECONDS,maxResults:100
    });
    for(const candidate of wider){
      if(Number.isFinite(Number(candidate.score)))sensitive.push(entry(source,candidate,'sensitive'));
    }
    for(const candidate of rawSurgeCandidates(source.bins)){
      surges.push(entry(source,candidate,'surge'));
    }
  }
  const byScore=(a,b)=>b.score-a.score||a.peakSeconds-b.peakSeconds;
  originals.sort(byScore);
  originals.forEach((x,i)=>{x.originalRank=i+1;});
  // "new" MUST mean absent from every existing source.candidates entry,
  // not merely absent from the first eight of the original pool.
  const alreadyInNormalReview=x=>originals.some(y=>
    y.sourceId===x.sourceId && Math.abs(y.peakSeconds-x.peakSeconds)<3);
  const novelSensitive=sensitive.filter(x=>!alreadyInNormalReview(x)).sort(byScore);
  const novelSurges=surges.filter(x=>!alreadyInNormalReview(x)).sort(byScore);
  const selected=[];
  const targetOriginal=Math.min(originals.length,Math.max(1,Math.floor(limit*.4)));
  const add=(pool,limitTo=limit)=>{
    let added=0;
    for(const option of pool){
      if(selected.length>=limit||added>=limitTo)break;
      if(tooClose(option,selected))continue;
      selected.push(option);added++;
    }
    return added;
  };
  add(originals,targetOriginal);
  const targetNovel=Math.max(0,limit-selected.length);
  // Mix types: reserve 1/4 of novel slots for events outside sensitive detector thresholds.
  const surgeSlots=Math.min(Math.ceil(targetNovel*.25),Math.max(0,limit-selected.length));
  add(novelSensitive,Math.max(0,targetNovel-surgeSlots));
  add(novelSurges,surgeSlots);
  add(novelSensitive);
  add(novelSurges);
  add(originals);
  const previous=selected.filter(x=>x.discovery==='existing').length;
  return {
    entries:selected,
    statistics:{
      pool:selected.length,
      existing:previous,
      newFound:selected.length-previous,
      sensitive:selected.filter(x=>x.discovery==='sensitive').length,
      rawSurges:selected.filter(x=>x.discovery==='surge').length,
      oldTopFive:Math.min(5,originals.length),
      oldTotal:originals.length
    }
  };
}
