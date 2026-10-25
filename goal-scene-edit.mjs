/** Pure goal scene trim/zoom state, compatible with regular highlight clips. */
import {normalizeSceneZoom,normalizeSceneFocus} from './editing-rules.mjs?v=peak52';
import {actualGoalTime} from './goal-stats.mjs?v=unifiedga1';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const round=n=>Math.round(n*10)/10;
export const GOAL_COMMENTARY_LEAD_SECONDS=5;
export const GOAL_COMMENTARY_TAIL_SECONDS=2;
/** Audio-derived goal scenes are centered on the ORIGINAL spoken commentary
 * timestamp, not estimated play/goal time (often commentary -10 seconds).
 * Manually added goals do not have a commentary timestamp; use goal time.
 */
export function goalSceneReferenceTime(item){
 if((item?.origin==='audio'||item?.origin==='gemini')&&finite(item.timeSeconds)&&item.timeSeconds>=0)
  return item.timeSeconds;
 return Number(actualGoalTime(item))||0;
}
export function goalSceneBounds(item,duration){
 const max=Math.max(0,Number(duration)||0);
 const voiceTime=clamp(goalSceneReferenceTime(item),0,max);
 const defaults={start:Math.max(0,voiceTime-(item?.origin==='gemini'?8:GOAL_COMMENTARY_LEAD_SECONDS)),
  end:Math.min(max,voiceTime+(item?.origin==='gemini'?5:GOAL_COMMENTARY_TAIL_SECONDS))};
 let start=finite(item?.clipStartSeconds)?clamp(item.clipStartSeconds,0,max):defaults.start;
 let end=finite(item?.clipEndSeconds)?clamp(item.clipEndSeconds,0,max):defaults.end;
 if(max>0){
   start=Math.min(start,Math.max(0,max-.3));
   end=clamp(Math.max(start+.3,end),0,max);
 }
 return {start:round(start),end:round(end)};
}
export function goalSceneZoom(item){
 return {
  zoom:normalizeSceneZoom(item?.clipZoom),
  zoomX:normalizeSceneFocus(item?.clipZoomX),
  zoomY:normalizeSceneFocus(item?.clipZoomY)
 };
}
export function setGoalSceneEdge(item,edge,time,duration){
 const bounds=goalSceneBounds(item,duration);
 if(!Number.isFinite(Number(time)))return false;
 const value=round(clamp(Number(time),0,Math.max(0,Number(duration)||0)));
 if(edge==='start'){
  if(value>=bounds.end-.29)return false;
  item.clipStartSeconds=value;
 }else if(edge==='end'){
  if(value<=bounds.start+.29)return false;
  item.clipEndSeconds=value;
 }else throw new Error('Invalid goal trim edge');
 return true;
}
