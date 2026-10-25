import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {assignMatchNumber,setMatchNumber,sourceDisplayName,matchStorageKey,validMatchNumber,sortFilesByFilename,sortSourcesByFilename,resetMatchNumbersToFilenameOrder} from '../match-label.mjs';
import {createGoalDrafts,saveGoalDrafts,goalSourceKey,confirmedGoalExport} from '../goal-stats.mjs';
import {buildMultiClipPlan,sourceTimestampComments} from '../multi-plan.mjs';
const make=(name='IMG_0287.MOV')=>({
 id:'video1',file:{name,size:45230011,lastModified:1792900000000},duration:420,
 objectUrl:'blob:original',candidates:[],bins:[{time:0,rms:.1}]
});
const store=()=>({map:new Map(),getItem(k){return this.map.get(k)||null},setItem(k,v){this.map.set(k,String(v))}});
test('per-file match number is chosen on import, edit persists, file identity and MOV URL remain unchanged',()=>{
 const src=make(),storage=store(),identity=goalSourceKey(src),media=src.objectUrl;
 assert.equal(assignMatchNumber(src,0,storage),1);
 assert.equal(sourceDisplayName(src),'第1試合');
 assert.equal(setMatchNumber(src,3,storage),true);
 assert.equal(sourceDisplayName(src),'第3試合');
 assert.equal(storage.getItem(matchStorageKey(src)),'3');
 assert.equal(assignMatchNumber(src,0,storage),3);
 assert.equal(goalSourceKey(src),identity);
 assert.equal(src.objectUrl,media);
 assert.equal(src.file.name,'IMG_0287.MOV','never rename real File or cached Gemini identity');
});
test('invalid match numbers rejected and plain filename stays hidden in common display',()=>{
 const src=make(),storage=store();
 assignMatchNumber(src,2,storage);
 assert.equal(sourceDisplayName(src),'第3試合');
 for(const val of ['','0','1000','3.2','abc','-1']){
  assert.equal(validMatchNumber(val),false);
  assert.equal(setMatchNumber(src,val,storage),false);
 }
 assert.equal(src.matchNumber,3);
 assert.equal(sourceDisplayName(make(),5),'動画6'); // no assigned number
});
test('a single video match number pre-fills every goal but preserves historical manual match values',()=>{
 const storage=store(),src=make();
 assignMatchNumber(src,0,storage);
 const goals=[
  {id:'existing1',origin:'audio',timeSeconds:30,goalTimeSeconds:25,
   scorer:'A',assist:'',assistStatus:'none',status:'confirmed',matchSeq:'',confirmedAt:'2026-10-25'},
  {id:'existing2',origin:'manual',timeSeconds:60,goalTimeSeconds:60,
   scorer:'B',assist:'',assistStatus:'none',status:'confirmed',matchSeq:'8',confirmedAt:'2026-10-25'}
 ];
 assert.equal(saveGoalDrafts(src,storage,goals),true);
 const first=createGoalDrafts(src,storage).items;
 assert.equal(first[0].matchSeq,'1');
 assert.equal(first[1].matchSeq,'8','existing hand-entered value must not change');
 saveGoalDrafts(src,storage,first);
 setMatchNumber(src,4,storage);
 const second=createGoalDrafts(src,storage).items;
 assert.equal(second[0].matchSeq,'4');
 assert.equal(second[1].matchSeq,'8');
 assert.deepEqual(confirmedGoalExport([src],storage).goals.map(g=>g.matchSeq),[4,8]);
});

test('chapters and timestamp comments say 第N試合, while actual file remains unchanged',()=>{
 const src=make();src.matchNumber=7;src.candidates=[{
  id:'v1',enabled:true,time:60,peakSeconds:64,manualEnd:70,zoom:1
 }];
 const plan=buildMultiClipPlan([src]);
 assert.equal(plan.length,1);
 assert.equal(plan[0].sourceName,'第7試合');
 assert.equal(sourceTimestampComments([src])[0].name,'第7試合');
 assert.match(sourceTimestampComments([src])[0].text,/第7試合/);
 assert.equal(src.file.name,'IMG_0287.MOV');
});

test('initial multi-select is naturally sorted by numbered MOV filename before default 1-4 match assignments',()=>{
 const incoming=[
  {name:'IMG_0301.MOV',size:22,lastModified:3},
  {name:'IMG_0289.MOV',size:22,lastModified:3},
  {name:'IMG_0299.mov',size:22,lastModified:3},
  {name:'IMG_0287.MOV',size:22,lastModified:3}
 ];
 const sorted=sortFilesByFilename(incoming);
 assert.deepEqual(sorted.map(f=>f.name),['IMG_0287.MOV','IMG_0289.MOV','IMG_0299.mov','IMG_0301.MOV']);
 assert.deepEqual(incoming.map(f=>f.name),['IMG_0301.MOV','IMG_0289.MOV','IMG_0299.mov','IMG_0287.MOV'],
  'sorting must never mutate browser-owned input list');
 const sources=sorted.map((file,index)=>({id:'video-'+(index+1),file,
  objectUrl:'blob:'+(index+1),candidates:[]}));
 const storage=store();
 sources.forEach((src,index)=>assignMatchNumber(src,index,storage));
 assert.deepEqual(sources.map(src=>sourceDisplayName(src)),
  ['第1試合','第2試合','第3試合','第4試合']);
 assert.deepEqual(sources.map(src=>src.file.name),sorted.map(f=>f.name));
});
test('numeric-aware sorting handles IMG_9 before IMG_10 and keeps manual data attached',()=>{
 const one=make('IMG_10.MOV');one.id='ten';one.objectUrl='blob:ten';one.candidates=[{id:'edited-goal',time:101}];
 const two=make('IMG_9.MOV');two.id='nine';two.objectUrl='blob:nine';
 const list=[one,two];sortSourcesByFilename(list);
 assert.deepEqual(list.map(s=>s.id),['nine','ten']);
 assert.equal(list[1],one,'sort must keep the edited source object intact');
 assert.equal(list[1].candidates[0].id,'edited-goal');
 assert.equal(list[1].objectUrl,'blob:ten');
});
test('explicit reset fixes prior saved 1,3,1,2 mappings without touching original MOVs',()=>{
 const storage=store();
 storage.removeItem=key=>storage.map.delete(key);
 const list=['IMG_0400.MOV','IMG_0100.MOV','IMG_0300.MOV','IMG_0200.MOV'].map(make);
 const originalFileRefs=list.map(s=>s.file);
 const originalUrls=list.map(s=>s.objectUrl);
 for(const [i,s] of list.entries()){
  assignMatchNumber(s,i,storage);
  setMatchNumber(s,[1,3,1,2][i],storage);
 }
 resetMatchNumbersToFilenameOrder(list,storage);
 assert.deepEqual(list.map(s=>s.file.name),
  ['IMG_0100.MOV','IMG_0200.MOV','IMG_0300.MOV','IMG_0400.MOV']);
 assert.deepEqual(list.map(s=>s.matchNumber),[1,2,3,4]);
 assert.ok(list.every(s=>originalFileRefs.includes(s.file)));
 assert.ok(list.every(s=>originalUrls.includes(s.objectUrl)));
 assert.ok(list.every(s=>storage.getItem(matchStorageKey(s))===null),
  'old manual match overrides are intentionally removed only by explicit reset');
});
test('upload list visibly includes raw filename and filename sort is wired without resetting reviewed clips',()=>{
 const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const app=readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
 const styles=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
 assert.match(index,/id="sortFilesByName"/);
 assert.match(app,/make\('small','source-original-filename',source\.file\.name\)/);
 assert.match(app,/sortFilesByFilename\(Array\.from\(files\)/);
 assert.match(app,/sortSourcesByFilename\(state\.sources\)/);
 assert.match(app,/sourceOrderWasManuallyChanged=true/);
 assert.match(styles,/\.source-original-filename/);
 assert.match(styles,/grid-template-areas:"ordinal details match" "\. buttons buttons"/);
});
