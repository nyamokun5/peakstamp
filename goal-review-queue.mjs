/** All recognized goal candidates across files in original upload order. */
import {createGoalDrafts,goalSourceKey,actualGoalTime} from './goal-stats.mjs?v=unifiedga1';
export function collectGoalQueue(sources,storage){
 const rows=[];
 for(const [index,source]of (sources||[]).entries()){
  if(!source?.file)continue;
  const base=goalSourceKey(source);
  if(!base)continue;
  for(const item of createGoalDrafts(source,storage).items){
   rows.push({key:base+'::'+item.id,source,item,sourceIndex:index});
  }
 }
 return rows.sort((a,b)=>a.sourceIndex-b.sourceIndex||
  actualGoalTime(a.item)-actualGoalTime(b.item));
}
/** Advance forward to an unconfirmed candidate, wrapping only when necessary. */
export function nextPendingGoal(rows,currentKey){
 const queue=(rows||[]).filter(x=>x?.item?.status==='draft');
 if(!queue.length)return null;
 const position=(rows||[]).findIndex(x=>x.key===currentKey);
 return queue.find(x=>(rows||[]).indexOf(x)>position)||queue[0];
}

/** Video-review queue: only scenes not yet Keep/Rejected are pending.
 * Scorer/assist verification does not substitute for video judgment.
 * Once all video decisions are made, return null (do not wrap forever).
 */
export function goalNeedsVideoReview(item){
 return Boolean(item)&&item.status!=='excluded'&&
   item.videoDecision!=='kept'&&item.videoDecision!=='rejected';
}
export function nextUnreviewedGoalVideo(rows,currentKey){
 const list=rows||[],position=list.findIndex(row=>row.key===currentKey);
 return list.find((row,index)=>index>position&&goalNeedsVideoReview(row.item))||
   list.find((row,index)=>index<=position&&goalNeedsVideoReview(row.item))||null;
}
