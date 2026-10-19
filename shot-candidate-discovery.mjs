/**
 * Experimental SHOT-OPPORTUNITY acoustic probes.
 *
 * Audio cannot tell whether a soccer ball was shot. This lane detects short,
 * high-contrast impulsive events and (optionally) nearby delayed vocal activity.
 * A quiet shot or a shot far from the microphone can still be completely missed.
 * No mutations to main PeakStamp candidates, keep state, export or AI rank.
 */
export const SHOT_PROBE_LIMIT=8;
const MIN_GAP=5.0;
const DEFAULT_STEP=.25;

function finitePositive(x,defaultValue=0){
  const n=Number(x);
  return Number.isFinite(n)?Math.max(0,n):defaultValue;
}
const clamp=(n,min=0,max=1)=>Math.max(min,Math.min(max,n));
function q(arr,quantile){
  if(!arr.length)return 0;
  const sorted=[...arr].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length-1,Math.round((sorted.length-1)*quantile))]||0;
}
/**
 * Bins: [{time, rms, crest?, highRatio?, lowRatio?}].
 * Designed to favour impulses different from long cheering peaks.
 */
export function findAcousticShotProbes(bins,options={}){
  const step=Number.isFinite(options.step)?options.step:DEFAULT_STEP;
  if(!Array.isArray(bins)||bins.length<20||step<=0)return [];
  const amplitude=bins.map(x=>finitePositive(x?.rms));
  const median=q(amplitude,.5),upper=q(amplitude,.92);
  if(upper<.008 && Math.max(...amplitude)<.017)return [];
  const peaks=[];
  const radius=Math.max(1,Math.round(.5/step));
  const preCount=Math.max(3,Math.round(3.5/step));
  const reactionStart=Math.max(1,Math.round(.6/step));
  const reactionEnd=Math.max(reactionStart+1,Math.round(3.5/step));
  const followCount=Math.max(1,Math.round(1.5/step));
  for(let i=Math.max(radius,preCount);i<amplitude.length-reactionEnd;i++){
    const level=amplitude[i];
    // Preserve shots below the big cheering peaks, while suppressing near silence.
    if(level<Math.max(.015,median*1.5))continue;
    if(amplitude[i-1]>level||amplitude[i+1]>level||amplitude[i-2]>level*1.06)continue;
    let left=0,leftCount=0;
    for(let j=Math.max(0,i-preCount);j<=i-2;j++){left+=amplitude[j];leftCount++;}
    const baseline=Math.max(.004,median,left/Math.max(1,leftCount));
    const immediate=Math.max(.004,amplitude[i-1],amplitude[i+1]);
    const sharpness=level/immediate;
    const contrast=level/baseline;
    const crest=finitePositive(bins[i]?.crest);
    const high=Number.isFinite(bins[i]?.highRatio)?clamp(bins[i].highRatio):null;
    const low=Number.isFinite(bins[i]?.lowRatio)?clamp(bins[i].lowRatio):null;
    // No single feature proves a kick. A strong crest/bright burst is useful.
    const strike=clamp((sharpness-1.08)/1.5)*.38+
      clamp((contrast-1.20)/3.5)*.34+
      clamp((crest-2.2)/5)*.20+
      (high===null?0:clamp((high-.22)/.5)*.08);
    if(contrast<1.45||sharpness<1.14||strike<.25)continue;
    if(low!==null&&low>.84 && crest<3.0)continue; // dominant rumble
    const firstAfter=Math.min(amplitude.length-1,i+reactionStart);
    const lastAfter=Math.min(amplitude.length-1,i+reactionEnd);
    let reaction=0,spikes=0;
    for(let j=firstAfter;j<=lastAfter;j++){
      const v=amplitude[j];
      reaction=Math.max(reaction,v);
      if(v>=baseline*1.5)spikes++;
    }
    const reactionRatio=reaction/baseline;
    const reactionBonus=.23*clamp((reactionRatio-1.2)/2)+
      .10*clamp((spikes*step-.25)/1.25);
    // Long ongoing sound is less likely to be a distinct ball kick.
    let sustain=0;
    for(let j=i+1;j<=Math.min(i+followCount,amplitude.length-1);j++){
      if(amplitude[j]>=level*.66)sustain++;
    }
    const sustainPenalty=.19*clamp(sustain/followCount);
    const weight=clamp(.13+.64*strike+reactionBonus-sustainPenalty);
    if(weight<.28)continue;
    const time=Number.isFinite(bins[i]?.time)?Number(bins[i].time):i*step;
    peaks.push({
      peakSeconds:time,time:Math.max(0,Math.floor(time-7)),
      score:+weight.toFixed(3),
      strength:+strike.toFixed(3),
      reaction:+clamp((reactionRatio-1)/3).toFixed(3),
      evidence:['短い鋭い音',reactionBonus>.08?'数秒後の音量変化':'後続の反応は弱い'],
      id:'shot-probe-'+Math.round(time*1000),
      enabled:false,title:'シュート候補（未確認）'
    });
  }
  return peaks.sort((a,b)=>b.score-a.score||a.peakSeconds-b.peakSeconds)
    .filter((x,i,all)=>!all.slice(0,i).some(y=>Math.abs(y.peakSeconds-x.peakSeconds)<MIN_GAP))
    .slice(0,140);
}
function tooNear(entry,others,gap=5){
  return others.some(other=>other.sourceId===entry.sourceId&&
    Math.abs(other.peakSeconds-entry.peakSeconds)<gap);
}
export function discoverShotProbes(sources,exclude=[],options={}){
  const limit=Math.max(1,Math.min(16,Math.floor(Number(options.limit)||SHOT_PROBE_LIMIT)));
  const pool=[];
  for(const source of sources||[]){
    if(!source?.file||!(source.duration>0)||!source.bins?.length)continue;
    for(const shot of findAcousticShotProbes(source.bins,options)){
      pool.push({
        ...shot,source,sourceId:source.id,fileName:source.file.name,
        duration:source.duration,candidate:shot,
        candidateId:shot.id,discovery:'shot-probe',
        key:[source.file.name,source.file.size,source.file.lastModified,
          Math.round(shot.peakSeconds*1000)].join('::')
      });
    }
  }
  pool.sort((a,b)=>b.score-a.score||a.peakSeconds-b.peakSeconds);
  // Prefer genuinely new times, but also provide shot-focused review
  // of existing candidates when the main search already captured all impulses.
  const fresh=pool.filter(entry=>!tooNear(entry,exclude,5));
  const shared=pool.filter(entry=>tooNear(entry,exclude,5));
  const choices=[];
  for(const entry of [...fresh,...shared]){
    if(choices.length>=limit)break;
    if(tooNear(entry,choices,MIN_GAP))continue;
    choices.push({...entry,overlapsBroadPool:tooNear(entry,exclude,5)});
  }
  return choices;
}
