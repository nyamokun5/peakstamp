import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analysisCounts,initJourneyCoach} from '../journey-coach.mjs';

function setup(values={goals:3,highlights:5}){
 const events={};
 const el=id=>({
  id,hidden:id==='journeyDialog',textContent:'',listeners:{},clickCount:0,
  addEventListener(name,fn){this.listeners[name]=fn},
  click(){this.clickCount++;this.onclick?.()||this.listeners.click?.()},
  focus(){this.focused=true}
 });
 const ids=Object.fromEntries(['journeyDialog','journeyDialogTitle',
 'journeyDialogBody','journeyDialogPrimary','journeyDialogSecondary',
 'journeyDialogDismiss'].map(id=>[id,el(id)]));
 const doc={
  activeElement:{focus(){}},getElementById:id=>ids[id],
  addEventListener(name,fn){events[name]=fn}
 };
 const called=[];
 const callbacks=Object.fromEntries([
  'goAnalysis','goGoals','showGoalList','goHighlights','reviewAllHighlights',
  'goExport','showExportPreview','saveHSJson'
 ].map(name=>[name,()=>called.push(name)]));
 const coach=initJourneyCoach({document:doc,counts:()=>values,actions:callbacks});
 return {coach,ids,called,doc};
}
test('analysis success tells actual goal/highlight counts and goes through first goal guide',()=>{
 const x=setup();
 x.coach.analysisFinished({success:true});
 assert.equal(x.ids.journeyDialog.hidden,false);
 assert.match(x.ids.journeyDialogBody.textContent,/ゴール 3件 ／ ハイライト 5件/);
 assert.match(x.ids.journeyDialogPrimary.textContent,/ゴール一覧/);
 x.ids.journeyDialogPrimary.click();
 assert.deepEqual(x.called,['goGoals']);
 assert.match(x.ids.journeyDialogTitle.textContent,/ゴールを確認/);
 assert.match(x.ids.journeyDialogBody.textContent,/画角と切り取り秒数/);
 assert.match(x.ids.journeyDialogBody.textContent,/得点者・アシスト/);
 assert.match(x.ids.journeyDialogBody.textContent,/得点情報を確定/);
 x.ids.journeyDialogPrimary.click();
 assert.deepEqual(x.called,['goGoals','showGoalList']);
 assert.equal(x.coach.showGoalIntro(),false,'only the first goal visit shows instructions');
});
test('failed and partial Gemini scans show actionable alternatives',()=>{
 const x=setup({goals:2,highlights:1});
 x.coach.analysisFinished({success:false,error:'動画を読み取れません'});
 assert.match(x.ids.journeyDialogTitle.textContent,/解析できません/);
 assert.match(x.ids.journeyDialogBody.textContent,/動画を読み取れません/);
 x.ids.journeyDialogPrimary.click();
 assert.deepEqual(x.called,['goAnalysis']);
 x.coach.analysisFinished({success:true,failures:1});
 assert.match(x.ids.journeyDialogTitle.textContent,/一部失敗/);
 assert.match(x.ids.journeyDialogBody.textContent,/ゴール 2件/);
 x.ids.journeyDialogSecondary.click();
 assert.equal(x.called.at(-1),'goAnalysis');
});
test('zero goals guides user to ordinary highlight review',()=>{
 const x=setup({goals:0,highlights:4});
 x.coach.analysisFinished({success:true});
 x.ids.journeyDialogPrimary.click();
 assert.deepEqual(x.called,['goHighlights']);
});
test('last goal decision opens branching next action and does not silently navigate',()=>{
 const x=setup();
 x.coach.goalReviewFinished({total:3,unconfirmed:1});
 assert.match(x.ids.journeyDialogBody.textContent,/未確定が1件/);
 assert.deepEqual(x.called,[]);
 x.ids.journeyDialogSecondary.click();
 assert.deepEqual(x.called,['goGoals','showGoalList']);
 x.coach.goalReviewFinished({total:3,unconfirmed:0});
 x.ids.journeyDialogPrimary.click();
 assert.equal(x.called.at(-1),'goHighlights');
});
test('completed highlights offer review-all or export while keeping undo/rejected view',()=>{
 const x=setup();
 x.coach.highlightReviewFinished({total:8,kept:5});
 assert.match(x.ids.journeyDialogBody.textContent,/8件を確認/);
 x.ids.journeyDialogSecondary.click();
 assert.equal(x.called.at(-1),'reviewAllHighlights');
 x.coach.highlightReviewFinished({total:8,kept:5});
 x.ids.journeyDialogPrimary.click();
 assert.equal(x.called.at(-1),'goExport');
});
test('zero kept highlights are not offered an impossible export',()=>{
 const x=setup();
 x.coach.highlightReviewFinished({total:4,kept:0});
 assert.doesNotMatch(x.ids.journeyDialogPrimary.textContent,/書き出し/);
 x.ids.journeyDialogPrimary.click();
 assert.equal(x.called.at(-1),'reviewAllHighlights');
});
test('after MP4 export tell user to preview, save and share HS JSON to organizers',()=>{
 const x=setup();
 x.coach.exportFinished();
 assert.match(x.ids.journeyDialogBody.textContent,/MP4/);
 assert.match(x.ids.journeyDialogBody.textContent,/iPhoneに保存/);
 assert.match(x.ids.journeyDialogBody.textContent,/HS向けJSON/);
 x.ids.journeyDialogSecondary.click();
 assert.equal(x.called.at(-1),'saveHSJson');
 x.coach.exportFinished();
 x.ids.journeyDialogPrimary.click();
 assert.equal(x.called.at(-1),'showExportPreview');
});
test('actual app wires analysis callbacks, missed-goal registration and final save button',()=>{
 const app=readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
 const goal=readFileSync(new URL('../goal-stats-ui.mjs',import.meta.url),'utf8');
 const gemini=readFileSync(new URL('../gemini-primary.mjs',import.meta.url),'utf8');
 const montage=readFileSync(new URL('../montage-ui.mjs',import.meta.url),'utf8');
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 for(const id of ['journeyDialog','journeyDialogPrimary','journeyDialogSecondary',
 'goalReviewFirstGuide','tabReviewed','hsJsonReminder','hsJsonShareFinal'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(app,/coaching\.analysisFinished/);
 assert.match(app,/coaching\.highlightReviewFinished/);
 assert.match(app,/goalReview\.addFromScene/);
 assert.match(app,/HS向け編集データ/);
 assert.match(goal,/onVideoReviewCompleted/);
 assert.match(goal,/makeManualGoal/);
 assert.match(gemini,/onComplete\(outcome\)/);
 assert.match(montage,/onComplete\(\)/);
 assert.match(montage,/hsJsonReminder/);
});
test('goal review places scoring confirmation ahead of clip Keep and keeps automatic next',()=>{
 const goal=readFileSync(new URL('../goal-stats-ui.mjs',import.meta.url),'utf8');
 assert.match(goal,/editor\.append\(scoreDetails,actions,videoStatus,videoActions\)/);
 assert.match(goal,/動画をキープ（次のゴールへ）/);
 assert.match(goal,/nextUnreviewedGoalVideo\(queue\(\),entry\.key\)/);
});

test('highlight completion is offered again only after re-judging the last fully-reviewed scene',()=>{
 const app=readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
 const after=app.split('function nextSceneAfter(current,{wasUnjudged=false}={}) {')[1]
  ?.split('function decideReview(')[0];
 assert.ok(after,'review completion flow must exist');
 assert.match(after,/if\(wasUnjudged\|\|ordinary\.at\(-1\)===current\)/);
 assert.match(after,/coaching\.highlightReviewFinished/);
 assert.match(app,/nextSceneAfter\(item,\{wasUnjudged:!previous\.enabled&&!previous\.rejected\}\)/);
 // Without this fix, the 'すべて' tab silently switched to '未判断',
 // making it impossible to reach the final already-reviewed candidate.
 assert.match(app,/\['all','kept','reviewed'\]\.includes\(button\.dataset\.reviewTab\)/);
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/id="tabReviewed"/);
});
test('review completion and visible interface consistently say ハイライトを確認',()=>{
 const dialog=readFileSync(new URL('../journey-coach.mjs',import.meta.url),'utf8');
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.doesNotMatch(dialog,/通常ハイライトを確認/);
 assert.doesNotMatch(html,/通常の見どころを確認/);
 assert.match(dialog,/ハイライトを確認しますか/);
 assert.match(html,/id="goalStatsDoneToRegular"[^>]+>ハイライトを確認/);
 assert.match(html,/data-editor-jump="resultsPanel">🎞 ハイライト/);
});
