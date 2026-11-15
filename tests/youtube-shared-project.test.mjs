import {saveVideoMatchup} from '../video-matchup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {hydrateYouTubeSource,storeYouTubeAnalysis,selectedYouTubeClips,confirmedYouTubePair,youtubeDisplayName} from '../youtube-shared-project.mjs';
import {createGoalDrafts,saveGoalDrafts} from '../goal-stats.mjs';
import {videoMatchup} from '../video-matchup.mjs';
import {keepGoalClip} from '../goal-video-clip.mjs';
import {buildMultiClipPlan} from '../multi-plan.mjs';
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
const source=(cache)=>hydrateYouTubeSource({id:'-sEOeqqTyuw',info:{teamA:'チーム1',teamB:'チーム2'},candidates:[]},0,cache);
const parsed={duration_seconds:120,events:[{reaction_time_seconds:40,type:'goal_reaction',confidence:'high',quote:'ゴール',suggested_clip_start_seconds:32,suggested_clip_end_seconds:44}],utterances:[{kind:'goal_call',time_seconds:48,quote:'得点は西村_guest',scorer:'西村_guest',assist_status:'none'}]};
test('YouTube analysis feeds the common goal drafts and clip plan without inventing waveform data',()=>{
 const cache=storage(),s=source(cache);storeYouTubeAnalysis(s,parsed,cache);
 assert.equal(s.bins,undefined);assert.equal(s.candidates.length,1);assert.equal(s.candidates[0].peakSeconds,40);
 const goal=createGoalDrafts(s,cache).items[0];assert.equal(goal.scorer,'西村_guest');assert.notEqual(goal.status,'confirmed');
 // Parsed video titles are not human-confirmed matchup evidence.
 assert.equal(videoMatchup(s,cache).origin,'unknown');
 Object.assign(goal,{status:'confirmed',assistStatus:'none',videoDecision:'kept'});saveGoalDrafts(s,cache,[goal]);keepGoalClip(s,goal);
 const clips=selectedYouTubeClips([s],cache);assert.equal(clips[0].scorer,'西村_guest');assert.equal(clips[0].video,s.id);
 const plan=buildMultiClipPlan([s]);assert.equal(plan.length,1);assert.equal(plan[0].start,clips[0].start);assert.equal(plan[0].end,clips[0].end);
 const restored=hydrateYouTubeSource(JSON.parse(JSON.stringify(s)),0,cache);assert.equal(createGoalDrafts(restored,cache).items[0].videoDecision,'kept');
});
test('legacy YouTube goals migrate once and never overwrite shared edits',()=>{
 const cache=storage(),saved={id:'-sEOeqqTyuw',info:{},candidates:[{goal:{id:'legacy',origin:'manual',timeSeconds:20,scorer:'旧名',status:'draft'}}]};
 const s=hydrateYouTubeSource(saved,0,cache);const goals=createGoalDrafts(s,cache).items;assert.equal(goals[0].scorer,'旧名');goals[0].scorer='編集済';saveGoalDrafts(s,cache,goals);
 assert.equal(createGoalDrafts(hydrateYouTubeSource(saved,0,cache),cache).items[0].scorer,'編集済');
});
test('reanalysis preserves prior decisions and current edited clip bounds',()=>{
 const cache=storage(),s=source(cache);storeYouTubeAnalysis(s,parsed,cache);Object.assign(s.candidates[0],{enabled:true,time:30,manualEnd:45});
 storeYouTubeAnalysis(s,parsed,cache);assert.equal(s.candidates[0].enabled,true);assert.equal(s.candidates[0].time,30);assert.equal(s.candidates[0].manualEnd,45);
});

test('legacy unreviewed goal hints remain draft goal candidates in the shared queue',()=>{const cache=storage(),s=hydrateYouTubeSource({id:'-sEOeqqTyuw',info:{},duration:120,analyzed:true,candidates:[{id:'old',origin:'gemini',time:32,manualEnd:44,peakSeconds:40,goalHint:true}]},0,cache);const goals=createGoalDrafts(s,cache).items;assert.equal(goals.length,1);assert.equal(goals[0].status,'draft');assert.equal(goals[0].goalTimeVerified,false)});

test('shared scorer corrections and goal exclusion override legacy confirmed metadata in shares',()=>{
 const cache=storage(),saved={id:'-sEOeqqTyuw',info:{},duration:120,candidates:[{id:'legacy-clip',time:10,manualEnd:25,peakSeconds:20,enabled:true,goal:{id:'legacy',origin:'manual',timeSeconds:20,scorer:'旧名',status:'confirmed'}}]};
 const s=hydrateYouTubeSource(saved,0,cache);const goals=createGoalDrafts(s,cache).items;goals[0].scorer='修正名';saveGoalDrafts(s,cache,goals);
 assert.equal(selectedYouTubeClips([s],cache)[0].scorer,'修正名');goals[0].status='excluded';saveGoalDrafts(s,cache,goals);assert.equal(selectedYouTubeClips([s],cache)[0].scorer,'');
});

test('human-corrected video pairing overrides title in sharing and video-slot identity',()=>{const cache=storage(),s=source(cache);assert.equal(confirmedYouTubePair(s,cache),null);saveVideoMatchup(s,cache,'チーム3','チーム4');assert.deepEqual(confirmedYouTubePair(s,cache),{teamA:'チーム3',teamB:'チーム4'});assert.match(youtubeDisplayName(s,cache),/チーム3 vs チーム4/);assert.doesNotMatch(youtubeDisplayName(s,cache),/チーム1/)});
