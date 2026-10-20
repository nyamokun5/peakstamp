import test from 'node:test';
import assert from 'node:assert/strict';
import {runGeminiVideoBatch} from '../gemini-video-batch.mjs';

const files=Array.from({length:4},(_,i)=>({file:{name:'V'+(i+1)+'.mov'},id:i+1}));
test('batch processes all videos sequentially, not concurrently',async()=>{
 const seen=[],progress=[];
 const report=await runGeminiVideoBatch({
  videos:files,
  processVideo:async src=>{
   seen.push('start'+src.id);
   await Promise.resolve();
   seen.push('end'+src.id);
  },
  onProgress:p=>progress.push(p)
 });
 assert.deepEqual(seen,['start1','end1','start2','end2','start3','end3','start4','end4']);
 assert.equal(report.success,4);
 assert.equal(report.processed,4);
 assert.equal(report.cancelled,false);
 assert.equal(progress.at(-1).processed,4);
});
test('already analyzed videos are skipped and failures do not stop later videos',async()=>{
 const seen=[];
 const report=await runGeminiVideoBatch({
  videos:files,
  isAlreadyAnalyzed:src=>src.id===1,
  processVideo:async src=>{
   seen.push(src.id);
   if(src.id===2)throw Error('API error');
  }
 });
 assert.deepEqual(seen,[2,3,4]);
 assert.equal(report.success,2);
 assert.equal(report.skipped,1);
 assert.equal(report.failures.length,1);
 assert.equal(report.failures[0].name,'V2.mov');
 assert.match(report.failures[0].error,/API error/);
 assert.equal(report.processed,4);
});
test('cancellation prevents the next video from beginning',async()=>{
 const seen=[];let cancelled=false;
 const result=await runGeminiVideoBatch({
  videos:files,
  isCancelled:()=>cancelled,
  processVideo:async src=>{seen.push(src.id);cancelled=true;}
 });
 assert.deepEqual(seen,[1]);
 assert.equal(result.cancelled,true);
 assert.equal(result.success,0);
 assert.equal(result.processed,0);
});
test('empty list resolves without errors',async()=>{
 const result=await runGeminiVideoBatch({videos:[],processVideo:async()=>{}});
 assert.equal(result.total,0);
 assert.equal(result.processed,0);
});
