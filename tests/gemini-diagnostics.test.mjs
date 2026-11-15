import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalysisDiagnostic } from '../gemini-diagnostics.mjs';

test('report captures missed Gemini goals but no media or API credentials',()=>{
 const source={file:{name:'match.mov',size:12345,lastModified:400},duration:450,analysisEngine:'gemini',
  candidates:[{time:107,peakSeconds:111,geminiType:'goal_reaction',score:.86,enabled:false}]};
 const gemini={duration_seconds:450,meta:{segments:7},
  events:[{reaction_time_seconds:111,type:'goal_reaction',confidence:'high',quote:'ゴール！',
   audible_clue:'歓声',suggested_clip_start_seconds:105,suggested_clip_end_seconds:118}]};
 const report=buildAnalysisDiagnostic(source,gemini,{items:[],transcript:null});
 const d=JSON.parse(report);
 assert.equal(d.gemini.byType.goal_reaction,1);
 assert.equal(d.editor.candidateCount,1);
 assert.equal(d.goalReview.draftCount,0);
 for(const key of ['lastModified','accessCode','audioBase64'])assert.equal(report.includes(key),false);
});
test('empty AI responses are correctly reported',()=>{
 const d=JSON.parse(buildAnalysisDiagnostic({file:{name:'quiet.mov',size:1},candidates:[]},{events:[]},{items:[]}));
 assert.equal(d.gemini.stored,true);
 assert.equal(d.gemini.rawEventCount,0);
 assert.equal(d.goalReview.explicitGoalCallCount,0);
});
test('explicit goal call is counted independently of Gemini candidate',()=>{
 const d=JSON.parse(buildAnalysisDiagnostic({file:{name:'match.mov',size:1}},null,{
  items:[{status:'draft',origin:'audio'}],
  transcript:{data:{utterances:[{kind:'goal_call'},{kind:'match_start'}]}}
 }));
 assert.equal(d.gemini.stored,false);
 assert.equal(d.goalReview.explicitGoalCallCount,1);
 assert.equal(d.goalReview.draftCount,1);
});

test('batch diagnostic includes fourth video opening and missing-analysis status',async()=>{
 const {buildBatchAnalysisDiagnostic}=await import('../gemini-diagnostics.mjs');
 const sources=[1,2,3,4].map(n=>({file:{name:'video'+n+'.MOV',size:100*n},duration:90}));
 const result=JSON.parse(buildBatchAnalysisDiagnostic(sources,s=>s===sources[3]
  ?{meta:{segments:2},utterances:[{kind:'match_start',time_seconds:1,quote:'決勝1対3',match_label:'決勝1対3'}]}
  :null,()=>({items:[]})));
 assert.equal(result.videoCount,4);
 assert.equal(result.videos[0].analyzed,false);
 assert.equal(result.videos[3].announcements[0].quote,'決勝1対3');
 assert.equal(result.videos[3].openingAnnouncements,1);
});
