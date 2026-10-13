/**
 * PeakStamp audio highlight detector.
 * Bin = {time, rms}, default spacing 0.25 seconds.
 * This detects volume surges; it DOES NOT semantically detect goals.
 */
/**
 * Stage 1: generate volume-peak events as before.
 * Stage 2: rank by local multi-bin persistence and broad-band noise signatures.
 * No speech-recognition, AI model, external requests, or audio uploads.
 */
export function detectHighlights(bins, options = {}) {
  const { sensitivity='normal', leadSeconds=7, maxResults=8,
    minGapSeconds=18, binSeconds=0.25 }=options;
  if(!Array.isArray(bins) || !bins.length || maxResults<=0) return [];
  const profile={
    sensitive:{threshold:.34,minDb:-37,minActive:.25},
    normal:{threshold:.48,minDb:-33,minActive:.60},
    strict:{threshold:.65,minDb:-28,minActive:.85}
  }[sensitivity] || {threshold:.48,minDb:-33,minActive:.60};

  const n=bins.length;
  const size=Math.max(1,Math.round(1/binSeconds));
  const raw=bins.map(b=>Math.max(0,Number(b?.rms)||0));
  const prefix=new Float64Array(n+1);
  for(let i=0;i<n;i++)prefix[i+1]=prefix[i]+raw[i]*raw[i];
  const smooth=new Float64Array(n);
  for(let i=0;i<n;i++){
    const first=Math.max(0,i-size+1);
    smooth[i]=Math.sqrt((prefix[i+1]-prefix[first])/(i-first+1));
  }
  const sorted=Array.from(smooth).sort((a,b)=>a-b);
  const median=sorted[Math.floor((n-1)/2)]||0;
  const p95=sorted[Math.floor((n-1)*.95)]||1e-7;
  const scale=Math.max(.0001,p95-median);
  const lookback=Math.max(1,Math.round(10/binSeconds));
  const localWindow=Math.max(1,Math.round(2/binSeconds));
  const candidates=[];

  for(let i=size;i<n-size;i++){
    const value=smooth[i];
    const db=20*Math.log10(Math.max(1e-8,value));
    if(db<profile.minDb)continue;
    const b0=Math.max(0,i-lookback),b1=Math.max(b0+1,i-size);
    const baseline=Math.sqrt((prefix[b1]-prefix[b0])/(b1-b0));
    const contrast=value/Math.max(.003,baseline);
    const prominence=(value-median)/scale;
    let peak=true;
    for(let j=Math.max(0,i-localWindow);j<=Math.min(n-1,i+localWindow);j++){
      if(smooth[j]>value+1e-10 || (j<i && Math.abs(smooth[j]-value)<1e-10)){
        peak=false;break;
      }
    }
    if(!peak)continue;
    const levelScore=Math.min(1.6,Math.max(0,prominence))*.43+
      Math.min(3,Math.max(0,contrast-1))/3*.42+
      Math.min(1,Math.max(0,(db+40)/30))*.15;
    // Preserve more plausible events for the second-stage reranker.
    if(levelScore<profile.threshold-.13)continue;

    // Include the 1 second before and 2.5 seconds after the RMS maximum:
    // 3-second cheers survive; a hammer strike usually lasts 1-2 bins.
    const first=Math.max(0,i-Math.round(1/binSeconds));
    const last=Math.min(n,i+Math.round(2.5/binSeconds)+1);
    const gate=Math.max(.009,baseline*1.6,value*.30);
    let active=0,below=false,bursts=0,weighted=0,lo=0,hi=0,crest=0;
    for(let j=first;j<last;j++){
      const power=raw[j]*raw[j];
      if(raw[j]>=gate){
        active++;
        if(!below)bursts++;
        below=true;
      }else below=false;
      // Weight spectral statistics toward the actual loud event.
      if(Number.isFinite(bins[j]?.lowRatio) && Number.isFinite(bins[j]?.highRatio)){
        weighted+=power;
        lo+=power*Math.max(0,Math.min(1,bins[j].lowRatio));
        hi+=power*Math.max(0,Math.min(1,bins[j].highRatio));
      }
      if(Number.isFinite(bins[j]?.crest))crest=Math.max(crest,bins[j].crest);
    }
    const activeSeconds=active*binSeconds;
    const tailFrom=Math.min(n,i+1),tailTo=Math.min(n,i+1+Math.ceil(1.5/binSeconds));
    let tailSum=0;
    for(let j=tailFrom;j<tailTo;j++)tailSum+=raw[j];
    const after=(tailTo>tailFrom?tailSum/(tailTo-tailFrom):0)/Math.max(.003,value);
    const lowShare=weighted?lo/weighted:null;
    const highShare=weighted?hi/weighted:null;
    const impulse=Math.max(0,Math.min(1,(.85-activeSeconds)/.85));
    // Rumbling machinery and sharp metal/tool clicks. These are penalties,
    // NOT speech/cheer classification: foreground shouts can resemble cheers.
    const rumble=lowShare===null?0:Math.max(0,Math.min(1,(lowShare-.55)/.30));
    const metallic=highShare===null?0:Math.max(0,Math.min(1,(highShare-.62)/.25));
    const spiky=Math.max(0,Math.min(1,(crest-4.2)/5));
    // Repeated, separated syllabic or impact bursts are weak negative evidence.
    const choppy=Math.max(0,Math.min(1,(bursts-2)/3));
    const score=levelScore+
      .20*Math.min(1,activeSeconds/2)+
      .10*Math.min(1,after)-
      .35*impulse-
      .19*rumble-
      .16*metallic*Math.max(.25,impulse)-
      .12*spiky*impulse-
      .10*choppy;

    // Minimum acoustic persistence is the only hard filter; a 'sensitive'
    // scan can still surface short shouts/brief audio events.
    if(activeSeconds<profile.minActive)continue;
    if(sensitivity!=='sensitive'){
      // A highly low-frequency event is usually rumble/engine/construction.
      // Separated rhythmic short bursts are often talk or repeated tool strikes.
      // Relax both rules in "多めに拾う" to recover potentially missed plays.
      const lowLimit=sensitivity==='strict'?.72:.79;
      const burstLimit=sensitivity==='strict'?2.0:1.65;
      if(lowShare!==null && lowShare>lowLimit && activeSeconds<5)continue;
      if(bursts>=3 && activeSeconds<=burstLimit &&
        (after<.85 || (lowShare!==null && lowShare>.54)))continue;
    }
    if(score<profile.threshold)continue;
    candidates.push({
      peakSeconds:Math.max(0,Number(bins[i]?.time)||i*binSeconds),
      score:+score.toFixed(3),db:+db.toFixed(1)
    });
  }

  // Only now limit the number of results; otherwise loud construction could
  // fill the shortlist before real celebrations have been scored.
  candidates.sort((a,b)=>b.score-a.score||a.peakSeconds-b.peakSeconds);
  const picked=[];
  for(const event of candidates){
    if(picked.length>=maxResults)break;
    if(picked.some(s=>Math.abs(s.peakSeconds-event.peakSeconds)<minGapSeconds))continue;
    picked.push({
      ...event,
      time:Math.max(0,Math.floor(event.peakSeconds-leadSeconds)),
      id:'peak-'+Math.round(event.peakSeconds*1000),
      enabled:false,title:'ナイスプレイ！'
    });
  }
  return picked.sort((a,b)=>a.time-b.time);
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const s = total % 60;
  return h ? h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0') : String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

export function makeComment(items, heading = '⚽ Shoot Sunday Highlights') {
  const lines = items.filter(item => item.enabled).sort((a,b)=>a.time-b.time)
    .map(item => formatTime(item.time) + ' ' + (item.title.trim() || 'ナイスプレイ！'));
  return lines.length ? heading + '\n' + lines.join('\n') : '';
}
