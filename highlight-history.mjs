import {goalSourceKey} from './goal-stats.mjs';
import {editedHighlight} from './highlight-priority.mjs';
const prefix='peakstamp_highlight_history_v1:';
const fields=['id','origin','peakSeconds','time','manualEnd','enabled','rejected','title','zoom','zoomX','zoomY','geminiType','geminiQuote','geminiReason','highlightUserEdited','geminiConfidence','score','db'];
function read(source,storage){try{const x=JSON.parse(storage.getItem(prefix+goalSourceKey(source))||'null');return x?.version===1&&Array.isArray(x.items)?x:null}catch{return null}}
const ordinary=c=>c&&!c.goalRecordId&&!c.goalVideoOwned;
const valid=c=>typeof c?.id==='string'&&Number.isFinite(c.peakSeconds)&&c.peakSeconds>=0&&Number.isFinite(c.time)&&c.time>=0&&(c.manualEnd==null||Number.isFinite(c.manualEnd)&&c.manualEnd>c.time);
const reviewed=c=>c.enabled===true||c.rejected===true||editedHighlight(c);
export function saveHighlightHistory(source,storage){
 const key=goalSourceKey(source);if(!key||!source.candidates?.length)return;
 const items=source.candidates.filter(ordinary).filter(valid).map(c=>Object.fromEntries(fields.filter(k=>c[k]!==undefined).map(k=>[k,c[k]])));
 try{storage.setItem(prefix+key,JSON.stringify({version:1,duration:source.duration,analysisEngine:source.analysisEngine,items}));return true}catch{return false}
}
export function restoreHighlightHistory(source,incoming,storage){
 const saved=read(source,storage)?.items.filter(valid)||[],used=new Set();
 const result=incoming.map(c=>{
  if(!ordinary(c))return c;
  const matches=saved.map((old,i)=>({old,i,d:Math.abs(old.peakSeconds-c.peakSeconds)}))
   .filter(x=>!used.has(x.i)&&x.d<=1.5)
   .sort((a,b)=>a.d-b.d);
  if(!matches.length||matches.length>1&&Math.abs(matches[0].d-matches[1].d)<.01)return c;
  const {old,i}=matches[0];used.add(i);
  return {...c,...Object.fromEntries(['highlightUserEdited','time','manualEnd','enabled','rejected','title','zoom','zoomX','zoomY'].filter(k=>old[k]!==undefined).map(k=>[k,old[k]]))};
 });
 for(const [i,old] of saved.entries())if(!used.has(i)&&reviewed(old))result.push({...old,sourceId:source.id});
 return result.sort((a,b)=>a.peakSeconds-b.peakSeconds);
}
export function hydrateHighlightHistory(source,storage){
 const saved=read(source,storage);if(!saved||!(saved.duration>0))return false;
 const items=saved.items.filter(valid);if(!items.length)return false;
 source.duration=saved.duration;source.analysisEngine=saved.analysisEngine;
 source.candidates=items.map(c=>({...c,sourceId:source.id}));source.highlightHistoryLoaded=true;return true;
}
