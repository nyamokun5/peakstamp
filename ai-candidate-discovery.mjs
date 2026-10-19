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

// All discovery algorithms have different native score scales.
// Recalculate every candidate's acoustic strength on the SAME source-aware
// signal scale before mixing scores or applying speech-based boosts.
const profileCache=new WeakMap();
const clamp01=n=>Math.max(0,Math.min(1,n));
function binProfile(bins){
  const cached=profileCache.get(bins);
  if(cached)return cached;
  const rms=bins.map(x=>Math.max(0,Number(x?.rms)||0));
  const ordered=[...rms].sort((a,b)=>a-b);
  const quantile=p=>ordered[Math.min(ordered.length-1,Math.floor(p*(ordered.length-1)))]||0;
  const profile={rms,median:quantile(.5),p95:quantile(.95)};
  profileCache.set(bins,profile);
  return profile;
}
export function comparableAcousticScore(bins,seconds,binSeconds=.25){
  if(!Array.isArray(bins)||!bins.length)return 0;
  const p=binProfile(bins),values=p.rms;
  const centre=Math.max(0,Math.min(values.length-1,Math.round(seconds/binSeconds)));
  const from=Math.max(0,centre-Math.round(.5/binSeconds));
  const to=Math.min(values.length-1,centre+Math.round(1.25/binSeconds));
  let peak=0,sustained=0,count=0;
  for(let i=from;i<=to;i++){
    peak=Math.max(peak,values[i]);
    if(values[i]>=Math.max(.01,p.median*1.25))sustained++;
    count++;
  }
  const baselineBegin=Math.max(0,centre-Math.round(10/binSeconds));
  const baselineEnd=Math.max(baselineBegin+1,centre-Math.round(2/binSeconds));
  let baseline=0;
  for(let i=baselineBegin;i<Math.min(baselineEnd,values.length);i++)baseline+=values[i];
  baseline/=Math.max(1,Math.min(baselineEnd,values.length)-baselineBegin);
  const prominence=clamp01((peak-p.median)/Math.max(.006,p.p95-p.median)/2);
  const contrast=clamp01((peak/Math.max(.004,baseline)-1)/2.5);
  const persistence=clamp01((sustained*binSeconds)/1.5);
  const salience=.40*prominence+.36*contrast+.24*persistence;
  // Constant ambient speech or silence cannot become a top-rank event.
  return peak<.009 ? 0 : Math.round((.2+.8*salience)*10000)/10000;
}

function entry(source,candidate,discovery,originalRank=null) {
  const time=Math.max(0,Number(candidate.peakSeconds)||0);
  return {
    key:[source.file.name,source.file.size,source.file.lastModified,Math.round(time*1000)].join('::'),
    sourceId:source.id,candidateId:candidate.id,fileName:source.file.name,
    duration:source.duration,peakSeconds:time,time:candidate.time,
    score:Number(candidate.score),
    reviewScore:comparableAcousticScore(source.bins,time),
    source,candidate,discovery,originalRank
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
