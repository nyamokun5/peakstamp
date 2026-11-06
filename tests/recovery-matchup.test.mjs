import test from 'node:test';
import assert from 'node:assert/strict';
import {runGeminiVideoBatch} from '../gemini-video-batch.mjs';
import {createGoalDrafts,saveGoalDrafts,GOAL_STORE_PREFIX} from '../goal-stats.mjs';
test('failed file retains actionable error and retry clears it without changing other files',async()=>{
 const videos=[{file:{name:'a.mov'},error:''},{file:{name:'b.mov'},error:''}];
 await runGeminiVideoBatch({videos,processVideo:async v=>{if(v===videos[1])throw Error('The object can not be found here.')}});
 assert.match(videos[1].error,/object/);assert.equal(videos[0].error,'');
 const result=await runGeminiVideoBatch({videos,isAlreadyAnalyzed:v=>v===videos[0],processVideo:async()=>{}});
 assert.equal(result.skipped,1);assert.equal(result.success,1);assert.equal(videos[1].error,'');
});
test('opening call fills empty manual draft matchup, preserving edits and confirmed records',()=>{
 const source={file:{name:'a.mov',size:10,lastModified:1}};
 const data=new Map();const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
 storage.setItem('peakstamp_callout_pilot_v2:a.mov::10::1::whole',JSON.stringify({utterances:[{kind:'match_start',time_seconds:1,match_label:'3対4',team_a:'3',team_b:'4'}]}));
 saveGoalDrafts(source,storage,[{id:'a',origin:'manual',status:'draft',timeSeconds:20},{id:'b',origin:'manual',status:'confirmed',timeSeconds:30},{id:'c',origin:'manual',status:'draft',timeSeconds:40,matchLabel:'赤対青',userEditedGoalFields:['matchLabel']}]);
 const items=createGoalDrafts(source,storage).items;
 assert.equal(items[0].matchLabel,'3対4');assert.equal(items[1].matchLabel,undefined);assert.equal(items[2].matchLabel,'赤対青');
});
