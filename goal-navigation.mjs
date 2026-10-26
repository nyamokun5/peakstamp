/** Navigate every goal, including those already marked video-kept or confirmed.
 * Unlike nextUnreviewedGoalVideo, explicit Previous/Next never skips a goal.
 */
export function adjacentGoal(rows,currentKey,direction){
 if(!Array.isArray(rows)||!['previous','next'].includes(direction))return null;
 const i=rows.findIndex(x=>x.key===currentKey);
 const next=i+(direction==='next'?1:-1);
 return i>=0&&next>=0&&next<rows.length?rows[next]:null;
}
export function goalNavState(rows,currentKey){
 const entries=Array.isArray(rows)?rows:[];
 const current=entries.findIndex(x=>x.key===currentKey);
 return {previous:current>0,next:current>=0&&current<entries.length-1,
  index:current,total:entries.length};
}
