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

test('existing unnamed Gemini goal is automatically prefilled from unified scorer/assist audio and matchup',()=>{
 const cache=storage(),src={...source('PREFILL.MOV',500000,1782340000),duration:400};
 cache.setItem('peakstamp_gemini_primary_json_v1',JSON.stringify({
  [goalSourceKey(src)]:{duration_seconds:400,events:[{
    reaction_time_seconds:241,type:'goal_reaction',confidence:'high',
    suggested_clip_start_seconds:233,suggested_clip_end_seconds:246
   }],utterances:[
    {kind:'match_start',time_seconds:4,quote:'3と4で開始',match_label:'3と4',team_a:'3',team_b:'4'},
    {kind:'goal_call',time_seconds:243,quote:'山田さんゴール、佐藤さんアシスト',
     scorer:'山田さん',assist:'佐藤さん',confidence:'high'}
   ]}
 }));
 const old={id:'gemini-goal-2410',origin:'gemini',timeSeconds:241,
  goalTimeSeconds:238,clipStartSeconds:233,clipEndSeconds:246,
  scorer:'',assist:'',assistStatus:'unknown',status:'draft',
  goalTimeEdited:true,goalTimeVerified:false,videoDecision:'kept',clipZoom:1.7};
 saveGoalDrafts(src,cache,[old]);
 const items=createGoalDrafts(src,cache).items;
 assert.equal(items.length,1);
 const g=items[0];
 assert.equal(g.scorer,'山田さん');
 assert.equal(g.assist,'佐藤さん');
 assert.equal(g.assistStatus,'named');
 assert.equal(g.matchLabel,'3と4');
 assert.equal(g.teamA,'3');
 assert.equal(g.teamB,'4');
 assert.equal(g.goalTimeSeconds,238);
 assert.equal(g.clipStartSeconds,233);
 assert.equal(g.clipEndSeconds,246);
 assert.equal(g.clipZoom,1.7);
 assert.equal(g.videoDecision,'kept');
 assert.equal(g.status,'draft','AI prefill must NOT automatically confirm a goal');
});
test('AI may fill only blanks, never overwrite corrected or manually cleared names',()=>{
 const cache=storage(),src=source('EDITED.MOV',734500,9090);
 put(cache,src,[{kind:'goal_call',time_seconds:100,quote:'聞き取りゴール、聞き取りアシスト',
  scorer:'誤認識A',assist:'誤認識B',confidence:'high'}]);
 const original={id:'existing-100',origin:'audio',timeSeconds:100,
  goalTimeSeconds:90,status:'draft',scorer:'正しい名前',
  assist:'',assistStatus:'unknown',matchLabel:'手入力マッチ',
  userEditedGoalFields:['scorer','assist','assistStatus','matchLabel']};
 saveGoalDrafts(src,cache,[original]);
 const items=createGoalDrafts(src,cache).items;
 assert.equal(items.length,1);
 assert.equal(items[0].scorer,'正しい名前');
 assert.equal(items[0].assist,'');
 assert.equal(items[0].assistStatus,'unknown');
 assert.equal(items[0].matchLabel,'手入力マッチ');
});
test('confirmed score and manual goal never overwritten by audio reanalysis',()=>{
 const cache=storage(),src=source('CONFIRMED.MOV',493454,19990);
 put(cache,src,[{kind:'goal_call',time_seconds:110,
  quote:'聞き取りAさんゴール、Bさんアシスト',scorer:'Aさん',assist:'Bさん'}]);
 const confirmed={id:'previous',origin:'audio',timeSeconds:110,
  goalTimeSeconds:100,status:'confirmed',scorer:'公式Cさん',
  assist:'公式Dさん',assistStatus:'named',videoDecision:'kept'};
 const manual={id:'manual-1',origin:'manual',timeSeconds:102,
  goalTimeSeconds:102,status:'draft',scorer:'手入力Eさん',
  assist:'',assistStatus:'unknown'};
 saveGoalDrafts(src,cache,[confirmed,manual]);
 const goals=createGoalDrafts(src,cache).items;
 assert.equal(goals.length,2);
 assert.equal(goals.find(x=>x.id==='previous').scorer,'公式Cさん');
 assert.equal(goals.find(x=>x.id==='previous').assist,'公式Dさん');
 assert.equal(goals.find(x=>x.id==='manual-1').scorer,'手入力Eさん');
});
test('uncertain spoken assist and match labels are prefilled, not asserted as confirmed',()=>{
 const cache=storage(),src=source('UNSURE.MOV',7677,9990);
 put(cache,src,[
 {kind:'match_start',time_seconds:2,quote:'2と3',team_a:'2',team_b:'3'},
 {kind:'goal_call',time_seconds:80,quote:'アシスト佐藤さん',scorer:null,
  assist:'佐藤さん',confidence:'low'}]);
 const goals=createGoalDrafts(src,cache).items;
 assert.equal(goals.length,1);
 assert.equal(goals[0].scorer,'');
 assert.equal(goals[0].assist,'佐藤さん');
 assert.equal(goals[0].assistStatus,'named');
 assert.equal(goals[0].teamA,'2');
 assert.equal(goals[0].teamB,'3');
 assert.equal(goals[0].status,'draft');
});
