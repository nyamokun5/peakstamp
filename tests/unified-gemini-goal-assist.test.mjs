import test from 'node:test';
import assert from 'node:assert/strict';
import {prompt,normalizeUnifiedUtterances} from '../api/gemini-audio.js';
import {mergeWavSegmentEvents,WAV_SEGMENT_VERSION} from '../gemini-wav-chunks.mjs';
import {goalSourceKey,readGoalTranscript,createGoalDrafts,saveGoalDrafts,
 confirmedGoalExport,makeManualGoal} from '../goal-stats.mjs';
import {goalSceneBounds} from '../goal-scene-edit.mjs';
import {keepGoalClip} from '../goal-video-clip.mjs';

const store=()=>({
 data:new Map(),
 getItem(key){return this.data.get(key)||null;},
 setItem(key,value){this.data.set(key,value);}
});
const source=(name='IMG_0289.MOV')=>({
 id:'video-1',file:{name,size:410181435,lastModified:1792900000000},
 duration:366.69733333333335,bins:[{rms:.02}],analysisEngine:'gemini',
 candidates:[{id:'gemini-241',sourceId:'video-1',origin:'gemini',
  geminiType:'goal_reaction',geminiConfidence:'high',peakSeconds:241,
  time:237,enabled:false,rejected:false}]
});
function put(store,video,result){
 store.setItem('peakstamp_gemini_primary_json_v1',JSON.stringify({
  [goalSourceKey(video)]:result
 }));
}
test('single model prompt asks for independent highlight and scorer/assist transcript',()=>{
 const p=prompt(70);
 assert.match(p,/ONE INTEGRATED AUDIO ANALYSIS/);
 assert.match(p,/utterances/);
 assert.match(p,/scorer/);
 assert.match(p,/assist/);
 assert.match(p,/ナイシュー/);
 assert.match(p,/Do not mistake a miss/);
 assert.match(p,/guess or fabricate/);
});
test('sanitizer keeps uncertain speaker fields empty, not guessed',()=>{
 const rows=normalizeUnifiedUtterances([
  {time_seconds:65.3,kind:'goal_call',quote:'〇〇さんゴール',
   scorer:null,assist:'斎藤さん',confidence:'low'},
  {time_seconds:65.3,kind:'goal_call',quote:'〇〇さんゴール',
   scorer:null,assist:'斎藤さん',confidence:'low'},
  {time_seconds:180,kind:'goal_call',quote:'時間外',scorer:'X'},
  {time_seconds:15,kind:'goal_call',quote:'',scorer:'X'}
 ],70);
 assert.equal(rows.length,1);
 assert.equal(rows[0].scorer,null);
 assert.equal(rows[0].assist,'斎藤さん');
 assert.equal(rows[0].confidence,'low');
});
test('overlapped segments merge same call, preserve scorer/assist, no duplicated score',()=>{
 const r=mergeWavSegmentEvents([
  {startSeconds:0,meta:{unifiedGoalCalls:true},events:[{reaction_time_seconds:62,type:'goal_reaction',
    confidence:'high',quote:'ナイシュー',
    suggested_clip_start_seconds:54,suggested_clip_end_seconds:67}],
   utterances:[{time_seconds:67,kind:'goal_call',quote:'山田さんゴール',
    scorer:'山田さん',assist:null,confidence:'medium'}]},
  {startSeconds:65,meta:{unifiedGoalCalls:true},events:[],
   utterances:[{time_seconds:2.4,kind:'goal_call',quote:'山田さんゴール、佐藤さんアシスト',
    scorer:'山田さん',assist:'佐藤さん',confidence:'high'}]}
 ],130);
 assert.equal(r.events.length,1);
 assert.equal(r.utterances.length,1);
 assert.equal(r.utterances[0].time_seconds,67);
 assert.equal(r.utterances[0].scorer,'山田さん');
 assert.equal(r.utterances[0].assist,'佐藤さん');
 assert.equal(r.meta.goalCallCount,1);
 assert.equal(r.meta.unifiedGoalCalls,true);
 assert.match(WAV_SEGMENT_VERSION,/goalassist/);
});
test('one analysis displays announced scorer and assist in priority goal review',()=>{
 const c=store(),v=source();
 put(c,v,{duration_seconds:v.duration,events:[
  {reaction_time_seconds:74.5,type:'shot_reaction',confidence:'high'},
  {reaction_time_seconds:241,type:'goal_reaction',confidence:'high',
   quote:'おー、ナイシュー',suggested_clip_start_seconds:233,
   suggested_clip_end_seconds:246}
 ],utterances:[
  {time_seconds:5,kind:'match_start',quote:'3と4',match_label:'3と4',team_a:'3',team_b:'4'},
  {time_seconds:243,kind:'goal_call',quote:'山田さんゴール、佐藤さんアシスト',
   scorer:'山田さん',assist:'佐藤さん',confidence:'high'}
 ]});
 const transcript=readGoalTranscript(v,c);
 assert.equal(transcript.scope,'unified');
 const goals=createGoalDrafts(v,c).items;
 assert.equal(goals.length,1);
 assert.equal(goals[0].origin,'audio');
 assert.equal(goals[0].scorer,'山田さん');
 assert.equal(goals[0].assist,'佐藤さん');
 assert.equal(goals[0].assistStatus,'named');
 assert.equal(goals[0].matchLabel,'3と4');
 assert.equal(goals[0].status,'draft');
 assert.equal(confirmedGoalExport([v],c).goals.length,0);
});
test('old scan goal reaction still appears as tentative video candidate',()=>{
 const c=store(),v=source();
 put(c,v,{duration_seconds:v.duration,events:[
  {reaction_time_seconds:241,type:'goal_reaction',confidence:'high',
   quote:'ナイシュー',suggested_clip_start_seconds:233,suggested_clip_end_seconds:246}
 ]});
 const goals=createGoalDrafts(v,c).items;
 assert.equal(goals.length,1);
 assert.equal(goals[0].origin,'gemini');
 assert.equal(goals[0].scorer,'');
 assert.equal(goals[0].clipStartSeconds,233);
 assert.deepEqual(goalSceneBounds(goals[0],v.duration),{start:233,end:246});
 const linked=keepGoalClip(v,goals[0]);
 assert.equal(linked.enabled,true);
 assert.equal(linked.time,233);
 assert.equal(linked.manualEnd,246);
});
test('spoken assist without intelligible scorer stays a review item',()=>{
 const c=store(),v=source('assist.mov');
 put(c,v,{events:[],utterances:[
  {time_seconds:100,kind:'goal_call',quote:'アシスト佐藤さん',
   scorer:null,assist:'佐藤さん',confidence:'low'}
 ]});
 const item=createGoalDrafts(v,c).items[0];
 assert.equal(item.scorer,'');
 assert.equal(item.assistStatus,'named');
 assert.equal(item.assist,'佐藤さん');
 assert.equal(item.status,'draft');
});
test('manual decision persists after integrated reanalysis; different source is isolated',()=>{
 const c=store(),v=source();
 const m=makeManualGoal(241,v,c);m.status='excluded';m.videoDecision='rejected';
 saveGoalDrafts(v,c,[m]);
 put(c,v,{events:[{reaction_time_seconds:241,type:'goal_reaction',confidence:'high'}],
  utterances:[{time_seconds:243,kind:'goal_call',quote:'Xさんゴール',
   scorer:'Xさん',assist:null}]});
 const goals=createGoalDrafts(v,c).items;
 assert.equal(goals.length,1);
 assert.equal(goals[0].status,'excluded');
 assert.equal(goals[0].videoDecision,'rejected');
 const other=source('different.mov');other.candidates=[];
 assert.equal(createGoalDrafts(other,c).items.length,0);
});
test('legacy separate explicit goal-call coexists without duplication',()=>{
 const c=store(),v=source();
 c.setItem('peakstamp_callout_pilot_v2:'+goalSourceKey(v)+'::whole',
  JSON.stringify({utterances:[{time_seconds:241,kind:'goal_call',
   quote:'Aさんゴール',scorer:'Aさん',assist:'Bさん'}]}));
 put(c,v,{events:[],utterances:[{time_seconds:242,kind:'goal_call',
  quote:'Aさんゴール',scorer:'Aさん',assist:null}]});
 const goals=createGoalDrafts(v,c).items;
 assert.equal(goals.length,1);
 assert.equal(goals[0].scorer,'Aさん');
 assert.equal(goals[0].assist,'Bさん');
});
