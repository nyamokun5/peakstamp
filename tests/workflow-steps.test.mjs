import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initWorkflowSteps} from '../workflow-steps.mjs';

function setup(){
 const handlers={};
 const mkNode=(id,{hidden=false,step='',jump=''}={})=>{
  const classes=new Set();
  return {
   id,hidden,disabled:false,attrs:{},scrollCount:0,textContent:'',
   classList:{
    toggle(name,on){if(on)classes.add(name);else classes.delete(name)},
    contains(name){return classes.has(name)}
   },
   setAttribute(name,value){this.attrs[name]=value},
   getAttribute(name){return name==='data-editor-jump'?jump:null},
   addEventListener(name,fn){handlers[id+':'+name]=fn},
   click(){handlers[id+':click']?.()},
   scrollIntoView(){this.scrollCount++}
  };
 };
 const tabs=[0,1,2].map(i=>mkNode('tab'+i,{step:String(i)}));
 const quick=[mkNode('jumpGoal',{jump:'goalStatsPanel'}),mkNode('jumpResults',{jump:'resultsPanel'})];
 const ids={
  journeyNav:mkNode('journeyNav'),workflowStageNotice:mkNode('workflowStageNotice'),
  choosePanel:mkNode('choosePanel'),
  goalStatsPanel:mkNode('goalStatsPanel',{hidden:true}),
  resultsPanel:mkNode('resultsPanel',{hidden:true}),
  montagePanel:mkNode('montagePanel',{hidden:true}),
  workflowToExport:mkNode('workflowToExport'),workflowBackToEdit:mkNode('workflowBackToEdit')
 };
 ids.journeyNav.querySelectorAll=()=>tabs;
 const document={
  body:{dataset:{}},
  getElementById:id=>ids[id]||null,
  querySelectorAll:selector=>selector==='[data-editor-jump]'?quick:[]
 };
 const data={files:[],review:false,kept:false},changes=[];
 const nav=initWorkflowSteps({document,
  hasMedia:()=>data.files.length>0,hasReview:()=>data.review,
  hasExport:()=>data.kept,
  onChange:(to,from)=>changes.push({to,from})
 });
 return{nav,document,data,ids,tabs,quick,changes};
}
test('three clear stages; uploading MOV and switching panels does not reset sources',()=>{
 const {nav,document,data,ids,tabs,changes}=setup();
 assert.equal(nav.current(),'analysis');
 assert.equal(document.body.dataset.psStage,'analysis');
 assert.equal(tabs[1].disabled,true);
 assert.equal(tabs[2].disabled,true);
 const movie={name:'IMG_5292.MOV',file:{size:510000000},
  objectUrl:'blob:do-not-reset',duration:366,clipStartSeconds:31,clipZoom:1.8};
 data.files.push(movie);
 data.review=true;ids.goalStatsPanel.hidden=false;ids.resultsPanel.hidden=false;
 nav.autoAdvance({busy:false});
 assert.equal(nav.current(),'edit');
 assert.equal(document.body.dataset.psStage,'edit');
 assert.equal(tabs[1].disabled,false);
 assert.equal(tabs[2].disabled,true,'Export unavailable until a scene is kept');
 assert.equal(data.files[0],movie);
 assert.equal(movie.objectUrl,'blob:do-not-reset');
 data.kept=true;ids.montagePanel.hidden=false;nav.refresh();
 tabs[2].click();
 assert.equal(nav.current(),'export');
 assert.equal(data.files[0],movie);
 ids.workflowBackToEdit.click();
 assert.equal(nav.current(),'edit');
 assert.equal(movie.clipStartSeconds,31);
 assert.equal(movie.clipZoom,1.8);
 assert.deepEqual(changes.map(x=>x.to),['edit','export','edit']);
});
test('Gemini batch does not switch to editing before analysis finishes',()=>{
 const {nav,data,ids}=setup();
 data.files.push({name:'large.mov'});data.review=true;ids.goalStatsPanel.hidden=false;
 nav.autoAdvance({busy:true});
 assert.equal(nav.current(),'analysis');
 nav.autoAdvance({busy:false});
 assert.equal(nav.current(),'edit');
});
test('editing quick-nav jumps straight to goal library and standard highlight without losing editor',()=>{
 const {nav,data,ids,quick}=setup();
 data.files.push({name:'A.MOV'});data.review=true;
 ids.goalStatsPanel.hidden=false;ids.resultsPanel.hidden=false;
 nav.autoAdvance({busy:false});
 quick[0].click();quick[1].click();
 assert.equal(ids.goalStatsPanel.scrollCount,1);
 assert.equal(ids.resultsPanel.scrollCount,1);
 assert.equal(nav.current(),'edit');
});
test('UI groups primary workflow stages, goal library and advanced diagnostic panels',()=>{
 const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const style=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
 const app=readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
 assert.match(index,/id="journeyNav"/);
 assert.match(index,/data-journey-step="0"[^>]*>1 <span>解析<\/span>/);
 assert.match(index,/data-journey-step="1"[^>]*>2 <span>編集<\/span>/);
 assert.match(index,/data-journey-step="2"[^>]*>3 <span>書き出し<\/span>/);
 assert.match(index,/id="editorQuickNav"/);
 assert.match(index,/id="goalQueuePending"/);
 assert.match(index,/id="goalQueueKept"/);
 assert.match(index,/id="goalQueueAll"/);
 assert.match(index,/id="goalStatsList"/);
 assert.match(index,/id="geminiAdvancedTools"/);
 assert.match(index,/id="advancedTools"/);
 assert.match(app,/initWorkflowSteps/);
 assert.match(app,/advancedTools\.append/);
 assert.match(style,/body\[data-ps-stage="analysis"\]/);
 assert.match(style,/\.goal-review-library-tabs/);
 assert.match(style,/\.goal-score-details/);
});
