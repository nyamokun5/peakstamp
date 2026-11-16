import test from 'node:test';
import assert from 'node:assert/strict';
import {primaryHighlight,sceneInReviewTab} from '../highlight-priority.mjs';
import {nextUndecided} from '../review-flow.mjs';
import {saveHighlightHistory,hydrateHighlightHistory,restoreHighlightHistory} from '../highlight-history.mjs';
const ai=(quote='',extra={})=>({id:'g',origin:'gemini',geminiType:'excited_reaction',title:'ナイスプレイ！',geminiQuote:quote,peakSeconds:20,time:16,manualEnd:null,enabled:false,rejected:false,...extra});
test('spoken shot, save and near-miss equivalents qualify; generic praise and generated labels do not',()=>{
 for(const phrase of ['ナイシュー！','ないしゅー','ナイスシュート','ナイスキー','ナイスキーパー！','ナイスセーブ','惜しい！','おしい','nice shot!','NICE SAVE','near miss','so close'])assert.equal(primaryHighlight(ai(phrase)),true,phrase);
 for(const phrase of ['ナイス','うまい','いいボール','あー','うわー','great play',''])assert.equal(primaryHighlight(ai(phrase)),false,phrase);
 assert.equal(primaryHighlight(ai('',{geminiType:'shot_reaction',title:'惜しい！',geminiReason:'ナイシュー'})),false);
 assert.equal(primaryHighlight(ai('',{geminiType:'save_reaction',title:'ナイスキーパー'})),false);
});
test('goals, kept, edited and manual scenes are protected; rejecting does not upgrade a low candidate',()=>{
 for(const extra of [{geminiType:'goal_reaction'},{goalRecordId:'goal1'},{goalVideoOwned:true},{enabled:true},{highlightUserEdited:true},{manualEnd:30},{zoom:2},{origin:'manual',geminiType:undefined}])assert.equal(primaryHighlight(ai('うまい',extra)),true);
 assert.equal(primaryHighlight(ai('うまい',{rejected:true})),false);
});
test('primary/other queues, counts and next scene agree, while all and kept preserve access',()=>{
 const high=ai('惜しい',{id:'high'}),low=ai('うまい',{id:'low'}),last=ai('ナイスキー',{id:'last'});
 const sources=[{bins:[1],candidates:[high,low,last]}];
 assert.equal(nextUndecided(sources,high).item,last);
 assert.equal(nextUndecided(sources,high,'other').item,low);
 assert.equal(sceneInReviewTab(low),false);assert.equal(sceneInReviewTab(low,'other'),true);assert.equal(sceneInReviewTab(low,'reviewed'),true);
 low.enabled=true;assert.equal(sceneInReviewTab(low,'other'),false);assert.equal(sceneInReviewTab(low,'kept'),true);
});
test('local history reload keeps spoken evidence and unmatched edited scenes without reanalysis',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
 const source={file:{name:'match.mov',size:12,lastModified:1},duration:100,candidates:[ai('ナイシュー'),ai('いいボール',{id:'edited',peakSeconds:60,time:56,highlightUserEdited:true})]};
 saveHighlightHistory(source,storage);
 const restored={...source,candidates:[]};assert.equal(hydrateHighlightHistory(restored,storage),true);
 assert.equal(restored.candidates[0].geminiQuote,'ナイシュー');assert.ok(restored.candidates.every(primaryHighlight));
 const rescanned=restoreHighlightHistory(source,[ai('ナイスシュート',{id:'new',peakSeconds:20.5})],storage);
 assert.ok(rescanned.some(c=>c.id==='edited'&&c.highlightUserEdited));
});
