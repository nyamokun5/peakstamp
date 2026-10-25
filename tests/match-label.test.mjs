import test from 'node:test';
import assert from 'node:assert/strict';
import {assignMatchNumber,setMatchNumber,sourceDisplayName,matchStorageKey,validMatchNumber} from '../match-label.mjs';
import {createGoalDrafts,saveGoalDrafts,goalSourceKey,confirmedGoalExport} from '../goal-stats.mjs';
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
 assert.equal(sourceDisplayName(make(),'5'),'動画6'); // no assigned number
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
