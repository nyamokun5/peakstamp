import test from 'node:test';
import assert from 'node:assert/strict';
import {
 goalSourceKey,readGoalTranscript,createGoalDrafts,saveGoalDrafts,makeManualGoal,
 validateGoal,confirmedGoalExport,matchContext
} from '../goal-stats.mjs';
const storage=()=>({
 data:new Map(),
 getItem(key){return this.data.get(key)||null;},
 setItem(key,v){this.data.set(key,v);}
});
const source=(name,size,lastModified)=>({file:{name,size,lastModified}});
const a=source('A.mov',123456,1000),b=source('B.mov',234567,2000);
const transcript1=[
 {time_seconds:2,kind:'match_start',quote:'3と4の試合',match_label:'3と4',team_a:'3',team_b:'4'},
 {time_seconds:160.2,kind:'goal_call',quote:'Bさんアシスト、Aさんゴール',scorer:'Aさん',assist:'Bさん'},
 {time_seconds:420,kind:'match_start',quote:'次も3と4で',match_label:'3と4'}
];
const transcript2=[
 {time_seconds:1,kind:'match_start',quote:'3と2、3位決定戦',match_label:'3と2'},
 {time_seconds:87,kind:'goal_call',quote:'Cさんゴール',scorer:'Cさん'}
];
function put(cache,src,rows,scope='whole'){
 cache.setItem('peakstamp_callout_pilot_v2:'+goalSourceKey(src)+'::'+scope,
  JSON.stringify({utterances:rows}));
}
test('read and separate full video transcripts by name-size-modified fingerprint',()=>{
 const cache=storage();put(cache,a,transcript1);put(cache,b,transcript2);
 assert.notEqual(goalSourceKey(a),goalSourceKey(b));
 assert.equal(readGoalTranscript(a,cache).data.utterances.length,3);
 assert.equal(readGoalTranscript(b,cache).data.utterances.length,2);
 assert.equal(createGoalDrafts(a,cache).items[0].scorer,'Aさん');
 assert.equal(createGoalDrafts(b,cache).items[0].scorer,'Cさん');
});
test('associate nearest PRIOR match start, never following announcement or match number',()=>{
 const cache=storage();put(cache,a,transcript1);
 const record=createGoalDrafts(a,cache).items[0];
 assert.equal(record.matchLabel,'3と4');
 assert.equal(record.teamA,'3');
 assert.equal(record.teamB,'4');
 assert.equal(record.matchSeq,'');
 assert.equal(matchContext(transcript1,1),null);
});
test('confirmation persists independent of video Keep/Reject and re-analysis',()=>{
 const cache=storage();put(cache,a,transcript1);
 const records=createGoalDrafts(a,cache).items;
 assert.equal(records[0].status,'draft');
 assert.equal(validateGoal(records[0]),null);
 records[0].status='confirmed';records[0].confirmedAt='2026-10-21T00:00:00.000Z';
 assert.equal(saveGoalDrafts(a,cache,records),true);
 const updated=[...transcript1];
 updated[1]={...updated[1],time_seconds:162.1,quote:'Aさんゴール、Bさんアシスト'};
 put(cache,a,updated);
 const restored=createGoalDrafts(a,cache).items;
 assert.equal(restored.length,1);
 assert.equal(restored[0].status,'confirmed');
 assert.equal(restored[0].assist,'Bさん');
});
test('assist unknown never silently becomes no assist; confirmed export preserves distinction',()=>{
 const cache=storage();put(cache,b,transcript2);
 const record=createGoalDrafts(b,cache).items[0];
 assert.equal(record.assistStatus,'unknown');
 assert.equal(record.assist,'');
 record.status='confirmed';saveGoalDrafts(b,cache,[record]);
 const out=confirmedGoalExport([b],cache);
 assert.equal(out.goals[0].assistStatus,'unknown');
 assert.equal(out.goals[0].assist,null);
 assert.equal(out.goals[0].matchSeq,null);
 assert.equal(out.needsMatchSeq,1);
 assert.equal(out.status,'local-confirmed-not-uploaded');
});
test('invalid identities and invalid sequence cannot be confirmed',()=>{
 const empty={timeSeconds:5,scorer:'',assistStatus:'unknown',matchSeq:''};
 assert.match(validateGoal(empty),/得点者/);
 assert.match(validateGoal({...empty,scorer:'Aさん',assistStatus:'named'}),/アシスト者/);
 assert.match(validateGoal({...empty,scorer:'Aさん',matchSeq:'1対2'}),/試合番号/);
 assert.equal(validateGoal({...empty,scorer:'Aさん',assistStatus:'none'}),null);
});
test('manual additions support missing audio and remain independently editable',()=>{
 const cache=storage();put(cache,a,transcript1);
 const extra=makeManualGoal(199,a,cache);
 assert.equal(extra.origin,'manual');
 assert.equal(extra.matchLabel,'3と4');
 extra.scorer='Dさん';extra.assistStatus='none';
 extra.status='confirmed';extra.matchSeq='4';
 const rows=createGoalDrafts(a,cache).items;
 rows.push(extra);
 saveGoalDrafts(a,cache,rows);
 const output=confirmedGoalExport([a],cache);
 assert.equal(output.goals.length,1);
 assert.equal(output.goals[0].scorer,'Dさん');
 assert.equal(output.goals[0].matchSeq,4);
 assert.equal(output.goals[0].assist,null);
});
test('excluded and unconfirmed candidates are not included in official-export-ready JSON',()=>{
 const cache=storage();put(cache,a,transcript1);
 const rows=createGoalDrafts(a,cache).items;rows[0].status='excluded';
 saveGoalDrafts(a,cache,rows);
 assert.equal(confirmedGoalExport([a],cache).goals.length,0);
});
