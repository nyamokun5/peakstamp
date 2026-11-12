/**
 * Conservative one-to-one proof for alias learning after a completed batch.
 * Never infer a goal from scorer alone: repeated goals must remain distinct.
 * Pure read-only validation; no writes or retries.
 */
const txt=x=>typeof x==='string'?x.trim():'';
const int=x=>Number.isSafeInteger(Number(x))?Number(x):null;
export function verifiedBatchAliasIntents({reviewed=[],official=[],eventVerified=false}={}){
 if(!eventVerified||!Array.isArray(reviewed)||!Array.isArray(official))return [];
 const result=[];
 const used=new Set();
 const seenSource=new Set();
 for(const source of reviewed){
  if(!source||!Array.isArray(source.intents)||!source.intents.length)continue;
  const seq=int(source.seq);
  const goalId=txt(source.officialGoalId);
  const sourceKey=txt(source.sourceName)+'::'+txt(source.sourceGoalId);
  if(seq===null||!goalId||!txt(source.sourceName)||!txt(source.sourceGoalId)||
     seenSource.has(sourceKey))continue;
  seenSource.add(sourceKey);
  const matches=official.filter(goal=>txt(goal.id)===goalId&&
   int(goal.seq)===seq&&txt(goal.scorer)===txt(source.scorer)&&
   txt(goal.team)===txt(source.team)&&
   txt(goal.assist||'')===txt(source.assist||''));
  if(matches.length!==1||used.has(goalId))continue;
  used.add(goalId);
  result.push(...source.intents.map(intent=>({...intent,officialGoalId:goalId})));
 }
 return result;
}
