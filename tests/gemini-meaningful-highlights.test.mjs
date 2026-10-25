import test from 'node:test';
import assert from 'node:assert/strict';
import {isReactionOnlyInterjection,geminiEventsToCandidates} from '../gemini-candidates.mjs';
import {prompt} from '../api/gemini-audio.js';
const reaction=(quote,timeSeconds=20,type='excited_reaction',audibleClue='')=>({
 quote,timeSeconds,type,confidence:'high',audibleClue,
 clipStartSeconds:Math.max(0,timeSeconds-5),clipEndSeconds:timeSeconds+3
});
test('isolated あー, うわー, わー, surprise-only oh/wow must not become a highlight',()=>{
 for(const s of ['あー','うわー！','うわぁぁ','わー！','あー、うわー！','あああ！','OH!','wow!!','おおー！']){
  assert.equal(isReactionOnlyInterjection(reaction(s)),true,s);
 }
 const scenes=geminiEventsToCandidates([
  reaction('あー',10),reaction('うわー！',20,'goal_reaction'),
  reaction('wow!',30),reaction('惜しい！',40,'shot_reaction'),
  reaction('ナイスキー！',60,'save_reaction')
 ],'video1',100);
 assert.equal(scenes.items.length,2);
 assert.deepEqual(scenes.items.map(x=>x.geminiQuote),['惜しい！','ナイスキー！']);
});
test('do not lose meaningful football words or edited/kept goal scenes on rescan',()=>{
 for(const phrase of ['うわー惜しい！','あー、ナイシュー！','ゴール！','ナイスセーブ','nice shot!']){
  assert.equal(isReactionOnlyInterjection(reaction(phrase)),false,phrase);
 }
 const old={id:'manual-old',origin:'gemini',peakSeconds:20,time:15,
  manualEnd:29,enabled:true,rejected:false,zoom:1.8,goalRecordId:'g1',goalVideoOwned:true};
 const out=geminiEventsToCandidates([reaction('うわー！',20,'goal_reaction'),
   reaction('ゴール！',25,'goal_reaction')],'v1',100,[old]);
 assert.equal(out.items.length,1,'only meaningful new event is emitted');
});
test('server AI instructions exclude non-informative shouts, but retain independent goal calls',()=>{
 const p=prompt(120);
 assert.match(p,/DO NOT create highlight events from isolated/);
 assert.match(p,/「あー」「うわー」/);
 assert.match(p,/goal_call/);
 assert.match(p,/scorer/);
});
