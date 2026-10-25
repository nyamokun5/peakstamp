import {goalSceneBounds,goalSceneZoom} from './goal-scene-edit.mjs?v=unifiedga1';
/** Goal video judgment uses the same candidate collection as other highlights,
 * but its acceptance/rejection happens directly inside the goal review UI.
 * Goal score confirmation remains a distinct operation.
 */
import {actualGoalTime} from './goal-stats.mjs?v=unifiedga1';
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
function matchGoalCandidate(source,goal){
 const goalTime=clamp(actualGoalTime(goal),0,Number(source.duration)||0);
 const proximity=c=>Math.min(
   Math.abs(Number(c.peakSeconds)-goalTime),
   goal.origin==='audio'?Math.abs(Number(c.peakSeconds)-Number(goal.timeSeconds)):Infinity);
 return (source.candidates||[]).find(c=>c.goalRecordId===goal.id)||
  source.candidates.filter(c=>
    !c.goalRecordId&&
    (Math.abs(Number(c.peakSeconds)-goalTime)<=6||
    (goal.origin==='audio'&&Math.abs(Number(c.peakSeconds)-Number(goal.timeSeconds))<=4)))
   .sort((a,b)=>proximity(a)-proximity(b))[0]||null;
}
export function keepGoalClip(source,goal){
 if(!(Number(source?.duration)>0)||!Array.isArray(source?.candidates)||!goal)return null;
 const duration=Number(source.duration),goalTime=clamp(actualGoalTime(goal),0,duration);
 const {start,end}=goalSceneBounds(goal,duration),crop=goalSceneZoom(goal);
 const match=matchGoalCandidate(source,goal);
 if(match){
  // An explicit Goal Keep means the Goal timeline IS the export timeline.
  // Before, independently kept highlight proposals were linked to this goal
  // but kept their old trim, silently ignoring the edited goal start/end.
  // Preserve the prior highlight settings if Goal Reject is chosen later.
  if(match.enabled===true&&match.goalVideoOwned!==true){
   match.goalPriorHighlight={
    time:match.time,manualEnd:match.manualEnd,peakSeconds:match.peakSeconds,
    zoom:match.zoom,zoomX:match.zoomX,zoomY:match.zoomY,
    enabled:match.enabled,rejected:match.rejected
   };
  }
  match.time=start;match.manualEnd=end;match.peakSeconds=goalTime;
  match.zoom=crop.zoom;match.zoomX=crop.zoomX;match.zoomY=crop.zoomY;
  match.goalVideoOwned=true;
  match.enabled=true;match.rejected=false;match.goalRecordId=goal.id;
  return match;
 }
 const item={
  id:'goal-clip-'+goal.id,goalRecordId:goal.id,goalVideoOwned:true,
  sourceId:source.id,origin:'goal-commentary',peakSeconds:goalTime,
  time:start,manualEnd:end,score:1,db:null,
  title:'ゴール',enabled:true,rejected:false,
  zoom:crop.zoom,zoomX:crop.zoomX,zoomY:crop.zoomY
 };
 source.candidates.push(item);
 source.candidates.sort((a,b)=>Number(a.time)-Number(b.time));
 return item;
}
/** An explicit video rejection from the goal editor should not delete a
 * previously kept, unrelated highlight that happens to overlap this goal.
 * Otherwise suppress matching undecided proposals to avoid second judgment.
 */
export function rejectGoalClip(source,goal){
 if(!source||!Array.isArray(source.candidates)||!goal)return false;
 const match=matchGoalCandidate(source,goal);
 if(!match)return true; // No offline candidate yet; persisted goal decision wins later.
 if(match.enabled===true && match.goalVideoOwned!==true)return true;
 if(match.goalRecordId===goal.id&&match.goalPriorHighlight){
  // Reject only the goal video, not the pre-existing kept highlight.
  Object.assign(match,match.goalPriorHighlight);
  delete match.goalPriorHighlight;
  delete match.goalRecordId;
  delete match.goalVideoOwned;
  return true;
 }
 match.enabled=false;match.rejected=true;
 match.goalRecordId=goal.id;match.goalVideoOwned=true;
 return true;
}
/** Rehydrate per-goal decisions from local storage after reanalysis or file
 * re-selection. Decisions are independent of whether audio bins exist.
 */
export function syncGoalClipDecisions(source,goals){
 if(!source||!Array.isArray(source.candidates)||!(Number(source.duration)>0))return;
 for(const goal of goals||[]){
  if(goal.videoDecision==='kept')keepGoalClip(source,goal);
  else if(goal.videoDecision==='rejected')rejectGoalClip(source,goal);
 }
}
