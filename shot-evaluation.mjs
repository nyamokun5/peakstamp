/**
 * Human-labeled missed-shot evaluation for PeakStamp.
 * Timestamps and labels are supplied by a person reviewing the actual video.
 * A ±5s match only measures proximity to known shot times, NOT visual detection.
 */
export const SHOT_MATCH_TOLERANCE=5;
export function fileIdentity(file){
  if(!file)return '';
  return [String(file.name||''),Number(file.size)||0,Number(file.lastModified)||0].join('::');
}
export function parseShotTime(text){
  const input=String(text??'').trim();
  if(!input)return null;
  const parts=input.split(':');
  if(parts.length<1||parts.length>3||parts.some(x=>!/^\d+(?:\.\d+)?$/.test(x)))return null;
  if(parts.length>1&&parts.slice(1).some(x=>Number(x)>=60))return null;
  const values=parts.map(Number);
  const seconds=values.reduce((acc,n)=>acc*60+n,0);
  return Number.isFinite(seconds)&&seconds>=0?Math.round(seconds*100)/100:null;
}
export function prettyShotTime(seconds){
  const value=Math.max(0,Number(seconds)||0);
  const minutes=Math.floor(value/60);
  const secs=(value-minutes*60).toFixed(value%1?2:0).padStart(2,'0');
  return String(minutes).padStart(2,'0')+':'+secs;
}
function closest(target, candidates, tolerance){
  let best=null;
  for(const candidate of candidates){
    const t=Number(candidate.peakSeconds);
    if(!Number.isFinite(t))continue;
    const diff=Math.abs(t-target);
    if(diff<=tolerance && (!best||diff<best.distance)){
      best={timeSeconds:t,distance:+diff.toFixed(2),discovery:candidate.discovery||'unknown'};
    }
  }
  return best;
}
export function evaluateManualShots(sources,registered,wide,probes,tolerance=SHOT_MATCH_TOLERANCE){
  const shots=[];
  const allowed=new Set(['number']);
  for(const source of sources||[]){
    if(!source?.file || !(Number(source.duration)>0))continue;
    const id=fileIdentity(source.file);
    const times=Array.isArray(registered?.[id])?registered[id]:[];
    const wideHere=(wide||[]).filter(x=>x.sourceId===source.id);
    const probesHere=(probes||[]).filter(x=>x.sourceId===source.id);
    for(const number of times){
      if(!Number.isFinite(number)||number<0||number>=source.duration)continue;
      const broadMatch=closest(number,wideHere,tolerance);
      const impulseMatch=closest(number,probesHere,tolerance);
      shots.push({
        file:source.file.name,
        sourceKey:id,
        timeSeconds:number,
        wideCandidate:broadMatch,
        impulseCandidate:impulseMatch,
        foundInEither:!!(broadMatch||impulseMatch)
      });
    }
  }
  const summary={
    annotated:shots.length,
    wideFound:shots.filter(x=>x.wideCandidate).length,
    impulseFound:shots.filter(x=>x.impulseCandidate).length,
    eitherFound:shots.filter(x=>x.foundInEither).length,
    missedByBoth:shots.filter(x=>!x.foundInEither).length,
    toleranceSeconds:tolerance
  };
  return {shots,summary};
}
export function shotProbeSummary(probes,labels){
  let yes=0,no=0,unknown=0;
  for(const x of probes||[]){
    const label=labels?.[x.key];
    if(label==='shot')yes++;
    else if(label==='not-shot')no++;
    else unknown++;
  }
  return {
    confirmedShot:yes,
    confirmedNotShot:no,
    notReviewed:unknown,
    reviewed:yes+no,
    precision:yes+no?yes/(yes+no):null
  };
}
