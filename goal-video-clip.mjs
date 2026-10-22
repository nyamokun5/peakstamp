import {goalSceneBounds,goalSceneZoom} from './goal-scene-edit.mjs?v=goal53';
/** Connect a confirmed-or-draft PS goal to the normal video Keep workflow.
 * This is an explicit action; recording a goal never automatically keeps a clip.
 * The regular PeakStamp / HS edit data formats stay unchanged.
 */
import {actualGoalTime} from './goal-stats.mjs?v=40';
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
export function keepGoalClip(source,goal){
 if(!source?.bins||!(Number(source.duration)>0)||!Array.isArray(source.candidates)||!goal)return null;
 const duration=Number(source.duration);
 const goalTime=clamp(actualGoalTime(goal),0,duration);
 const {start,end}=goalSceneBounds(goal,duration);
 const crop=goalSceneZoom(goal);
 const proximity=c=>Math.min(
   Math.abs(Number(c.peakSeconds)-goalTime),
   goal.origin==='audio'?Math.abs(Number(c.peakSeconds)-Number(goal.timeSeconds)):Infinity);
 const match=(source.candidates||[]).find(c=>c.goalRecordId===goal.id)||
  source.candidates.filter(c=>Math.abs(Number(c.peakSeconds)-goalTime)<=6||
    (goal.origin==='audio'&&Math.abs(Number(c.peakSeconds)-Number(goal.timeSeconds))<=4))
   .sort((a,b)=>proximity(a)-proximity(b))[0];
 if(match){
  // Do not override intentionally edited already-kept scenes, just mark as kept.
  if(match.enabled!==true){
   // An explicitly adjusted goal preview must use exactly its chosen trim.
   // Otherwise retain any wider manually edited pre-existing highlight.
   match.time=Number.isFinite(goal.clipStartSeconds)
    ?start:Math.min(Number(match.time)||0,start);
   match.manualEnd=Number.isFinite(goal.clipEndSeconds)
    ?end:Math.min(duration,Math.max(Number(match.manualEnd)||0,end));
   if(crop.zoom>1){
    match.zoom=crop.zoom;match.zoomX=crop.zoomX;match.zoomY=crop.zoomY;
   }
  }
  match.enabled=true;match.rejected=false;match.goalRecordId=goal.id;
  return match;
 }
 const item={
  id:'goal-clip-'+goal.id,goalRecordId:goal.id,
  sourceId:source.id,origin:'goal-commentary',peakSeconds:goalTime,
  time:start,manualEnd:Math.max(start+.3,end),score:1,db:null,
  title:'ゴール',enabled:true,rejected:false,
  zoom:crop.zoom,zoomX:crop.zoomX,zoomY:crop.zoomY
 };
 source.candidates.push(item);
 source.candidates.sort((a,b)=>Number(a.peakSeconds)-Number(b.peakSeconds));
 return item;
}
