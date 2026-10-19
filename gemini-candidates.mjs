/** Pure converter from Gemini's AUDIO-REACTION suggestions into PeakStamp editor scenes. */
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const kinds={
  goal_reaction:{title:'ゴール',rank:5},
  save_reaction:{title:'ナイスキーパー',rank:4},
  shot_reaction:{title:'惜しい！',rank:3},
  excited_reaction:{title:'ナイスプレイ！',rank:2},
  other:{title:'ナイスプレイ！',rank:1},
  uncertain:{title:'ナイスプレイ！',rank:0}
};
const confidenceValue={high:0.86,medium:0.65,low:0.44};
function normalize(event,duration){
 const time=Number(event?.timeSeconds);
 if(!Number.isFinite(time)||time<0||time>duration+2)return null;
 const kind=kinds[event.type]?event.type:'uncertain';
 const a=Number(event?.clipStartSeconds),b=Number(event?.clipEndSeconds);
 const start=clamp(Number.isFinite(a)?a:time-8,0,duration);
 const end=clamp(Number.isFinite(b)?b:time+5,0,duration);
 const clipEnd=Math.max(start+.25,Math.min(duration,end));
 return {time:clamp(time,0,duration),start,clipEnd,
  type:kind,confidence:event.confidence,quote:String(event.quote||'').slice(0,120),
  clue:String(event.audibleClue||'').slice(0,300)};
}
export function geminiEventsToCandidates(events,sourceId,duration,prior=[]){
 const videoLength=Number(duration);
 if(!(videoLength>0))throw Error('動画の長さが不正です。');
 const ordered=(events||[]).map(event=>normalize(event,videoLength)).filter(Boolean)
  .sort((a,b)=>a.time-b.time);
 const groups=[];
 for(const event of ordered){
  const priorGroup=groups.at(-1);
  if(priorGroup && event.time-priorGroup.latestTime<=6 &&
     event.type===priorGroup.type && event.start<=priorGroup.end){
    priorGroup.latestTime=Math.max(priorGroup.latestTime,event.time);
    priorGroup.end=Math.max(priorGroup.end,event.clipEnd);
    priorGroup.merged.push(event);
    if((kinds[event.type]?.rank||0)>(kinds[priorGroup.type]?.rank||0))priorGroup.type=event.type;
    if((confidenceValue[event.confidence]||0)>(confidenceValue[priorGroup.confidence]||0))
      priorGroup.confidence=event.confidence;
  }else{
    groups.push({start:event.start,end:event.clipEnd,latestTime:event.time,
      time:event.time,type:event.type,confidence:event.confidence,merged:[event]});
  }
 }
 const items=groups.map(group=>{
   const old=(prior||[]).find(p=>p.origin==='gemini'&&Math.abs(p.peakSeconds-group.time)<1.5);
   const quote=[...new Set(group.merged.map(e=>e.quote).filter(Boolean))].join(' / ').slice(0,240);
   const kind=kinds[group.type];
   const end=clamp(group.end,Math.min(videoLength,group.start+.25),videoLength);
   return {
     id:'gemini-'+Math.round(group.time*10)+'-'+group.type,
     sourceId,origin:'gemini',peakSeconds:+group.time.toFixed(1),
     time:+group.start.toFixed(1),manualEnd:+end.toFixed(1),
     score:confidenceValue[group.confidence]||0.44,
     db:null,title:kind.title,geminiType:group.type,geminiConfidence:group.confidence,
     geminiQuote:quote,geminiReason:group.merged.map(e=>e.clue).filter(Boolean).join(' / ').slice(0,600),
     mergedReactions:group.merged.length,enabled:old?.enabled===true,rejected:old?.rejected===true,
     zoom:old?.zoom??1,zoomX:old?.zoomX??.5,zoomY:old?.zoomY??.5
   };
 });
 return {items,mergedCount:ordered.length-items.length,sourceEvents:ordered.length};
}
