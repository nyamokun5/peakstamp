import test from 'node:test';
import assert from 'node:assert/strict';
import {goalSourceKey,createGoalDrafts,saveGoalDrafts,estimateGoalTime,
 actualGoalTime,confirmedGoalExport} from '../goal-stats.mjs';
import {keepGoalClip} from '../goal-video-clip.mjs';

const src=()=>({id:'video-1',file:{name:'IMG_5292.mov',size:591367587,lastModified:1792283825000},
 duration:450.752,bins:[{rms:.01}],candidates:[]});
const makeStore=()=>({data:new Map(),getItem(k){return this.data.get(k)||null},
 setItem(k,v){this.data.set(k,v);}});
const transcript=[{kind:'match_start',time_seconds:3.8,quote:'3と4',match_label:'3と4'},
 {kind:'goal_call',time_seconds:379.2,quote:'野田さんアシスト、若さんゴール',
  scorer:'若さん',assist:'野田さん'}];
const put=(source,store)=>store.setItem('peakstamp_callout_pilot_v2:'+
 goalSourceKey(source)+'::whole',JSON.stringify({utterances:transcript}));

test('commentary is estimated 10sec after goal, clamped to zero near beginning',()=>{
 assert.equal(estimateGoalTime(379.2),369.2);
 assert.equal(estimateGoalTime(3.4),0);
});
test('existing v38 confirmed data preserves voice time and human confirmation when upgraded',()=>{
 const source=src(),store=makeStore();put(source,store);
 const old=createGoalDrafts(source,store).items[0];
 delete old.goalTimeSeconds;
 old.status='confirmed';old.confirmedAt='2026-10-20T23:14:33Z';
 saveGoalDrafts(source,store,[old]);
 const upgraded=createGoalDrafts(source,store).items[0];
 assert.equal(upgraded.status,'confirmed');
 assert.equal(upgraded.timeSeconds,379.2);
 assert.equal(actualGoalTime(upgraded),369.2);
 assert.equal(upgraded.scorer,'若さん');
 assert.equal(upgraded.assist,'野田さん');
});
test('human-adjusted goal time survives reload and exports actual play and spoken reaction separately',()=>{
 const source=src(),store=makeStore();put(source,store);
 const draft=createGoalDrafts(source,store).items[0];
 draft.goalTimeSeconds=373.6;draft.goalTimeVerified=true;draft.status='confirmed';
 saveGoalDrafts(source,store,[draft]);
 const restored=createGoalDrafts(source,store).items[0];
 assert.equal(restored.goalTimeSeconds,373.6);
 const output=confirmedGoalExport([source],store);
 assert.equal(output.version,3);
 assert.equal(output.goals.length,1);
 assert.equal(output.goals[0].timeSeconds,373.6);
 assert.equal(output.goals[0].goalTimeSeconds,373.6);
 assert.equal(output.goals[0].reactionTimeSeconds,379.2);
 assert.equal(output.goals[0].timingMethod,'video-reviewed');
});
test('manual goal has no commentary delay or fake reaction timestamp',()=>{
 const source=src(),store=makeStore();put(source,store);
 const goal={id:'manual-abc',origin:'manual',timeSeconds:117.5,scorer:'高崎さん',
 assist:'たいせい',assistStatus:'named',matchSeq:'',matchLabel:'3と2',teamA:'3',teamB:'2',
 status:'confirmed'};
 saveGoalDrafts(source,store,[goal]);
 const record=confirmedGoalExport([source],store).goals[0];
 assert.equal(record.timeSeconds,117.5);
 assert.equal(record.reactionTimeSeconds,null);
 assert.equal(record.timingMethod,'manual');
});
test('one click keeps the goal in video from 4 seconds before to 2 seconds after',()=>{
 const source=src(),store=makeStore();put(source,store);
 const goal=createGoalDrafts(source,store).items[0];
 const candidate=keepGoalClip(source,goal);
 assert.equal(candidate.time,365.2);
 assert.equal(candidate.peakSeconds,369.2);
 assert.equal(candidate.manualEnd,371.2);
 assert.equal(candidate.enabled,true);
 assert.equal(source.candidates.length,1);
 assert.equal(keepGoalClip(source,goal),candidate);
 assert.equal(source.candidates.length,1);
});
test('normal scene matching goal is reused instead of duplicating clip',()=>{
 const source=src(),store=makeStore();put(source,store);
 source.candidates.push({id:'gemini-1',sourceId:source.id,time:371,peakSeconds:379.2,
 manualEnd:382,enabled:false,rejected:false});
 const candidate=keepGoalClip(source,createGoalDrafts(source,store).items[0]);
 assert.equal(source.candidates.length,1);
 assert.equal(candidate.id,'gemini-1');
 assert.equal(candidate.enabled,true);
 assert.equal(candidate.rejected,false);
 assert.equal(candidate.time,365.2);
 // Reused scene already extends 2.8 seconds beyond the new target; do not trim it.
 assert.equal(candidate.manualEnd,382);
});
test('no waveform never adds empty clips; goal review still exists',()=>{
 const source=src(),store=makeStore();put(source,store);
 source.bins=null;
 assert.equal(keepGoalClip(source,createGoalDrafts(source,store).items[0]),null);
 assert.equal(source.candidates.length,0);
});

test('per-goal trim and pinch zoom are saved when adding the goal to MP4 highlights',()=>{
 const source=src();
 const goal={id:'manual-test',origin:'manual',timeSeconds:60,goalTimeSeconds:60,
  clipStartSeconds:53.7,clipEndSeconds:64.2,
  clipZoom:2.15,clipZoomX:.31,clipZoomY:.67};
 const c=keepGoalClip(source,goal);
 assert.equal(c.time,53.7);
 assert.equal(c.manualEnd,64.2);
 assert.equal(c.zoom,2.15);
 assert.equal(c.zoomX,.31);
 assert.equal(c.zoomY,.67);
 assert.equal(c.goalRecordId,goal.id);
 // Revisiting the same goal can apply an edited framing/trim.
 goal.clipEndSeconds=62.5;goal.clipZoom=1.4;
 const updated=keepGoalClip(source,goal);
 assert.equal(updated,c);
 assert.equal(updated.manualEnd,62.5);
 assert.equal(updated.zoom,1.4);
 assert.equal(source.candidates.length,1);
});
test('already-kept unrelated highlight does not have its trim overwritten by goal edit',()=>{
 const source=src();
 const existing={id:'audio-scene',time:56,peakSeconds:60,manualEnd:73,
  enabled:true,zoom:1.5,zoomX:.3,zoomY:.5};
 source.candidates.push(existing);
 const goal={id:'g',origin:'manual',goalTimeSeconds:60,timeSeconds:60,
  clipStartSeconds:58,clipEndSeconds:62,clipZoom:2};
 assert.equal(keepGoalClip(source,goal),existing);
 assert.equal(existing.time,56);
 assert.equal(existing.manualEnd,73);
 assert.equal(existing.zoom,1.5);
});
