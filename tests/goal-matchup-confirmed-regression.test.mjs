import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoalDrafts,goalSourceKey,GOAL_STORE_PREFIX} from '../goal-stats.mjs';
const source={file:{name:'cached.mov',size:100,lastModified:123},matchNumber:2};
const key=goalSourceKey(source);
const goal=(status,extra={})=>({id:status,timeSeconds:60,goalTimeSeconds:55,origin:'audio',status,scorer:'Ashikawa',assistStatus:'none',teamA:'',teamB:'',matchLabel:'',matchSeq:'2',...extra});
const storage=(items)=>{const map=new Map([[GOAL_STORE_PREFIX+key,JSON.stringify({items})],['peakstamp_matchup_v1:'+key,JSON.stringify({origin:'manual',teamA:'3',teamB:'4'})]]);return {getItem:k=>map.get(k)||null};};
test('manual video matchup updates confirmed cached goal',()=>{
 const item=createGoalDrafts(source,storage([goal('confirmed')])).items[0];
 assert.equal(item.teamA,'3');assert.equal(item.teamB,'4');assert.equal(item.matchLabel,'3 vs 4');
});
test('manual video matchup updates manually added goal',()=>{
 const item=createGoalDrafts(source,storage([goal('draft',{origin:'manual'})])).items[0];
 assert.equal(item.teamA,'3');assert.equal(item.teamB,'4');
});
test('manually edited goal card is preserved',()=>{
 const item=createGoalDrafts(source,storage([goal('confirmed',{teamA:'8',teamB:'9',userEditedGoalFields:['teamA','teamB','matchLabel']})])).items[0];
 assert.equal(item.teamA,'8');assert.equal(item.teamB,'9');
});
test('excluded goal is not modified',()=>{
 const item=createGoalDrafts(source,storage([goal('excluded')])).items[0];
 assert.equal(item.teamA,'');assert.equal(item.teamB,'');
});
