import test from 'node:test';
import assert from 'node:assert/strict';
import {collectGoalQueue,nextPendingGoal,nextUnreviewedGoalVideo,goalNeedsVideoReview} from '../goal-review-queue.mjs';
import {goalSourceKey,createGoalDrafts,saveGoalDrafts,actualGoalTime} from '../goal-stats.mjs';
const store=()=>({m:new Map(),getItem(k){return this.m.get(k)||null},setItem(k,v){this.m.set(k,v)}});
const mk=(name,size,modified)=>({id:name,objectUrl:'blob:'+name,
 file:{name,size,lastModified:modified},duration:450,bins:[{}],candidates:[]});
const a=mk('IMG_5292.mov',591367587,1792283825000);
const b=mk('IMG_5293.MOV',548875601,1792284336000);
function transcript(s,source,items){
 s.setItem('peakstamp_callout_pilot_v2:'+goalSourceKey(source)+'::whole',JSON.stringify({utterances:items}));
}
test('all videos are listed without source picker, in upload and local time order',()=>{
 const s=store();
 transcript(s,a,[{kind:'match_start',time_seconds:3,match_label:'3と4'},
  {kind:'goal_call',time_seconds:379.2,quote:'若さんゴール',scorer:'若さん'}]);
 transcript(s,b,[{kind:'match_start',time_seconds:1,match_label:'3と2'},
  {kind:'goal_call',time_seconds:117.5,quote:'高崎さんゴール',scorer:'高崎さん'}]);
 const rows=collectGoalQueue([a,b],s);
 assert.equal(rows.length,2);
 assert.equal(rows[0].source.file.name,'IMG_5292.mov');
 assert.equal(rows[1].source.file.name,'IMG_5293.MOV');
 assert.equal(actualGoalTime(rows[0].item),369.2);
 assert.equal(actualGoalTime(rows[1].item),107.5);
 assert.equal(nextPendingGoal(rows,rows[0].key).key,rows[1].key);
 rows[0].item.status='confirmed';
 saveGoalDrafts(a,s,[rows[0].item]);
 assert.equal(nextPendingGoal(collectGoalQueue([a,b],s),rows[0].key).source.file.name,'IMG_5293.MOV');
 rows[1].item.status='confirmed';
 saveGoalDrafts(b,s,[rows[1].item]);
 assert.equal(nextPendingGoal(collectGoalQueue([a,b],s),rows[1].key),null);
});
test('legacy automatic -5s estimates migrate to -10s only if not human verified',()=>{
 const s=store();transcript(s,a,[{kind:'goal_call',time_seconds:379.2,quote:'若さんゴール',scorer:'若さん'}]);
 const prior=createGoalDrafts(a,s).items[0];
 prior.goalTimeSeconds=374.2;prior.goalTimeVerified=false;prior.status='draft';
 saveGoalDrafts(a,s,[prior]);
 assert.equal(createGoalDrafts(a,s).items[0].goalTimeSeconds,369.2);
 prior.goalTimeSeconds=373.9;prior.goalTimeEdited=true;saveGoalDrafts(a,s,[prior]);
 assert.equal(createGoalDrafts(a,s).items[0].goalTimeSeconds,373.9);
 prior.goalTimeSeconds=374.2;prior.goalTimeVerified=true;prior.status='confirmed';
 saveGoalDrafts(a,s,[prior]);
 assert.equal(createGoalDrafts(a,s).items[0].goalTimeSeconds,374.2);
});
test('one denied goal does not block advancing to another source',()=>{
 const s=store();transcript(s,a,[{kind:'goal_call',time_seconds:40,quote:'A',scorer:'A'}]);
 transcript(s,b,[{kind:'goal_call',time_seconds:110,quote:'B',scorer:'B'}]);
 let rows=collectGoalQueue([a,b],s);
 const item=rows[0].item;item.status='excluded';saveGoalDrafts(a,s,[item]);
 rows=collectGoalQueue([a,b],s);
 assert.equal(nextPendingGoal(rows,rows[0].key).source.file.name,b.file.name);
});

test('video-review queue advances after Keep or Reject without depending on scorer confirmation',()=>{
 const rows=[
  {key:'a',item:{status:'confirmed',videoDecision:'kept'}},
  {key:'b',item:{status:'confirmed'}},
  {key:'c',item:{status:'draft',videoDecision:'rejected'}},
  {key:'d',item:{status:'draft'}}
 ];
 assert.equal(goalNeedsVideoReview(rows[0].item),false);
 assert.equal(goalNeedsVideoReview(rows[1].item),true);
 assert.equal(nextUnreviewedGoalVideo(rows,'a').key,'b');
 assert.equal(nextUnreviewedGoalVideo(rows,'b').key,'d');
 rows[1].item.videoDecision='kept';
 rows[3].item.videoDecision='rejected';
 assert.equal(nextUnreviewedGoalVideo(rows,'b'),null);
});
test('video review skips excluded goals, wraps to remaining unjudged, and does not loop after all',()=>{
 const rows=[
  {key:'a',item:{status:'draft'}},
  {key:'b',item:{status:'excluded'}},
  {key:'c',item:{status:'confirmed',videoDecision:'kept'}}
 ];
 assert.equal(nextUnreviewedGoalVideo(rows,'c').key,'a');
 assert.equal(nextUnreviewedGoalVideo(rows,'b').key,'a');
 rows[0].item.videoDecision='rejected';
 assert.equal(nextUnreviewedGoalVideo(rows,'c'),null);
});
