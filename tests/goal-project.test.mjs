import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 CURRENT_GOAL_PROJECT_KEY,projectFileKey,projectFiles,
 saveCurrentGoalProject,readCurrentGoalProject,
 matchSavedGoalsToProject,approximateLegacyDayGroups,defaultGoalCollection
} from '../goal-project.mjs';
import {saveGoalDrafts,confirmedGoalExport,GOAL_STORE_PREFIX} from '../goal-stats.mjs';
import {normalizeSpoSnapshot,prepareGoalRows} from '../sposched-review-core.mjs';
const st=()=>({
 data:new Map(),getItem(k){return this.data.get(k)||null},
 setItem(k,v){this.data.set(k,String(v))},
 key(i){return [...this.data.keys()][i]||null},
 get length(){return this.data.size}
});
const file=(name,lastModified,size=20000)=>({file:{name,lastModified,size}});
const a=file('IMG_0286.MOV',Date.parse('2026-10-25T08:00:00+08:00'));
const b=file('IMG_0287.MOV',Date.parse('2026-10-25T08:10:00+08:00'));
const c=file('IMG_0289.MOV',Date.parse('2026-10-25T08:20:00+08:00'));
const old=file('IMG_5293.MOV',Date.parse('2026-09-22T08:00:00+08:00'));
const entry=(source,count=1)=>({
 key:GOAL_STORE_PREFIX+projectFileKey(source),source:source.file,count
});
test('one loaded project includes all imported videos, never just newest one',()=>{
 const storage=st();
 const manifest=saveCurrentGoalProject(storage,[a,b,c],{newProject:true,now:12345});
 assert.equal(readCurrentGoalProject(storage).files.length,3);
 const chosen=defaultGoalCollection([entry(a,2),entry(b,3),entry(c,1),entry(old,5)],manifest);
 assert.equal(chosen.mode,'project');
 assert.deepEqual(chosen.items.map(x=>x.source.name),
  ['IMG_0286.MOV','IMG_0287.MOV','IMG_0289.MOV']);
 assert.equal(chosen.confirmedGoals,6);
 assert.equal(chosen.projectFileCount,3);
 assert.equal(chosen.matchingSourceCount,3);
 assert.equal(chosen.approximate,false);
});
test('append, reorder, remove and replace never accidentally merge different projects',()=>{
 const storage=st();
 const first=saveCurrentGoalProject(storage,[a,b],{newProject:true,now:100});
 assert.equal(saveCurrentGoalProject(storage,[b,c,a],{now:110}).projectId,first.projectId);
 assert.deepEqual(readCurrentGoalProject(storage).files.map(x=>x.name),
  ['IMG_0287.MOV','IMG_0289.MOV','IMG_0286.MOV']);
 const reduced=saveCurrentGoalProject(storage,[a,c],{now:115});
 assert.equal(reduced.files.length,2);
 assert.equal(defaultGoalCollection([entry(a),entry(b),entry(c)],reduced).items.length,2);
 const replacement=saveCurrentGoalProject(storage,[old],{newProject:true,now:200});
 assert.notEqual(replacement.projectId,first.projectId);
 assert.deepEqual(defaultGoalCollection([entry(a),entry(b),entry(c),entry(old)],replacement)
  .items.map(x=>x.source.name),['IMG_5293.MOV']);
});
test('project manifest is fingerprints only: no video blobs, transcripts, players or tokens',()=>{
 const storage=st();saveCurrentGoalProject(storage,[a,b,c],{newProject:true,now:10});
 const json=storage.getItem(CURRENT_GOAL_PROJECT_KEY);
 assert.deepEqual(Object.keys(JSON.parse(json)).sort(),['files','projectId','updatedAt','version']);
 assert.deepEqual(Object.keys(JSON.parse(json).files[0]).sort(),['lastModified','name','size']);
 assert.doesNotMatch(json,/BRIDGE_TOKEN|audio|objectUrl|transcript|videoBlob|player_id|api_key|confirmedAt/);
});
test('strict fingerprint prevents mixing similarly named videos of different sizes',()=>{
 const storage=st();
 const near=file(a.file.name,a.file.lastModified,a.file.size+1);
 const manifest=saveCurrentGoalProject(storage,[a],{newProject:true,now:100});
 const selection=matchSavedGoalsToProject([entry(near,9),entry(a,2)],manifest);
 assert.equal(selection.confirmedGoals,2);
 assert.equal(selection.selected[0].source.size,a.file.size);
 assert.equal(projectFileKey(a),projectFileKey({file:{...a.file}}));
 assert.notEqual(projectFileKey(a),projectFileKey(near));
});
test('legacy recordings group by modified day as a visible approximation, not across all weeks',()=>{
 const groups=approximateLegacyDayGroups([entry(a,2),entry(b,3),entry(c,1),entry(old,5)]);
 assert.equal(groups.length,2);
 assert.equal(groups[0].confirmedGoals,6);
 assert.equal(groups[1].confirmedGoals,5);
 const choice=defaultGoalCollection([entry(a,2),entry(b,3),entry(old,5)],null);
 assert.equal(choice.mode,'legacy');
 assert.equal(choice.approximate,true);
 assert.equal(choice.items.length,2);
});
test('empty current project does not silently import historic videos',()=>{
 const storage=st();
 const manifest=saveCurrentGoalProject(storage,[file('NEW.MOV',1870000000000)],
  {newProject:true,now:100});
 const result=defaultGoalCollection([entry(old,5)],manifest);
 assert.equal(result.items.length,0);
 assert.equal(result.confirmedGoals,0);
});
test('malformed project JSON is ignored without changing saved goal data',()=>{
 const storage=st();storage.setItem(CURRENT_GOAL_PROJECT_KEY,'{broken-json');
 assert.equal(readCurrentGoalProject(storage),null);
 storage.setItem(CURRENT_GOAL_PROJECT_KEY,JSON.stringify({version:2,projectId:'x',files:[a.file]}));
 assert.equal(readCurrentGoalProject(storage),null);
 assert.deepEqual(projectFiles([a,a,{file:{name:'bad',size:'NaN',lastModified:null}}])
  .map(x=>x.name),[a.file.name]);
});
test('all project files contribute their saved confirmed goals to the one match review',()=>{
 const storage=st(),files=[a,b,c];
 const officialEvent={
  event_id:'5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e',event:'Shoot Sunday TEST',
  roster:{'チーム1':['西村','佐藤','山田']},
  matches:[{seq:1,left_team:'チーム1',right_team:'チーム2',
   match_id:'4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d',goals:[]}]
 };
 for(const [i,src] of files.entries()){
  saveGoalDrafts(src,storage,[{
   id:'detected-goal-'+i,origin:'audio',timeSeconds:100+i*10,
   goalTimeSeconds:90+i*10,scorer:['西村','佐藤','山田'][i],
   assist:'',assistStatus:'none',status:'confirmed',matchSeq:'1',
   quote:'確定済みゴール'
  }]);
 }
 saveGoalDrafts(old,storage,[{
   id:'stale',origin:'manual',timeSeconds:100,scorer:'西村',
   assistStatus:'none',status:'confirmed'
 }]);
 const manifest=saveCurrentGoalProject(storage,files,{newProject:true,now:300});
 const selected=defaultGoalCollection(files.concat([old]).map(entry),manifest).items;
 const exported=confirmedGoalExport(selected.map(item=>({file:item.source})),storage);
 assert.equal(exported.goals.length,3);
 assert.deepEqual(exported.goals.map(x=>x.source.name),files.map(x=>x.file.name));
 assert.equal(prepareGoalRows(exported,normalizeSpoSnapshot(officialEvent)).length,3);
});
test('mobile page uses project-wide aggregation and still allows exceptional manual source selection',()=>{
 const html=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');
 const app=readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
 const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/id="projectSummary"/);
 assert.match(html,/id="sourceAdvanced"/);
 assert.match(html,/id="saveProjectSelection"/);
 assert.match(html,/defaultGoalCollection\(saved,project\)/);
 assert.match(html,/readCurrentGoalProject\(localStorage\)/);
 assert.match(html,/confirmedGoalExport\(files,localStorage\)/);
 assert.match(html,/id="quickPanel"/);
 assert.match(app,/saveCurrentGoalProject\(window\.localStorage,state\.sources,\{newProject\}\)/);
 assert.match(app,/rememberGoalProject\(!append\)/);
 assert.match(index,/sposched-review\.html\?v=project-goals1/);
});
