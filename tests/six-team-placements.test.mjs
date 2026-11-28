import test from 'node:test';
import assert from 'node:assert/strict';
import {usesIndependentFixtures} from '../sposched-fixture-layout.mjs';
import {normalizeSpoSnapshot} from '../sposched-review-core.mjs';
import {prepareIndependentWorkerBatch} from '../sposched-independent-worker-batch.mjs';

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function fixtures(){
 return normalizeSpoSnapshot({event_id:id(10),match_format:'6teams_2pitches',
  matches:[...['5-6','3-4','1-2'].map((rank,i)=>({seq:i+1,match_id:id(i+1),
   title:'#'+(i+1)+' '+rank+'位決定戦',status:'scheduled',
   left_team:'Team'+(i+1),right_team:'Team'+(i+4)})),{seq:null,title:'ゴール集'}]});
}
function plan(snapshot,goal={}){
 const rows=[{seq:2,include:true,goal,team:'Team2',scorer:'A',assistMode:'none'}];
 return prepareIndependentWorkerBatch({snapshot,rows,decisions:[{state:'ready'}],requestId:id(20)});
}
test('only the three official placements receive goals and finishes',()=>{
 const snapshot=fixtures();
 assert.ok(usesIndependentFixtures(snapshot));
 assert.deepEqual(plan(snapshot,{teamA:'5',teamB:'2'}).operations.map(op=>[op.seq,op.action]),
  [[1,'finish'],[2,'create'],[2,'finish'],[3,'finish']]);
 snapshot.matches.push({...snapshot.matches[0],seq:4,title:'予選'});
 assert.equal(usesIndependentFixtures(snapshot),false);
});
test('waiting, duplicate and conflicting pairings block the placement batch',()=>{
 const snapshot=fixtures(),second=snapshot.matches[1];
 assert.throws(()=>plan(snapshot,{teamA:'1',teamB:'4'}),/対戦カード/);
 second.rightTeam='チーム1';
 assert.throws(()=>plan(snapshot),/重複/);
 second.rightTeam='';
 second.status='waiting';
 assert.throws(()=>plan(snapshot),/3-4位決定戦/);
});

import {checkPlacementVideos} from '../sposched-production-inline.mjs';
import {saveVideoMatchup} from '../video-matchup.mjs';
test('all placement videos must agree, including a goalless fixture',()=>{
 const data=new Map();
 const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
 const snapshot=fixtures();
 const sources=snapshot.matches.map(m=>({file:{name:m.seq+'.mov',size:120,lastModified:1},matchNumber:m.seq}));
 sources.forEach((source,i)=>saveVideoMatchup(source,storage,String(i+1),String(i+4)));
 checkPlacementVideos(snapshot,sources,storage);
 assert.throws(()=>checkPlacementVideos(snapshot,sources.slice(1),storage),/3試合/);
 saveVideoMatchup(sources[2],storage,'1','2');
 assert.throws(()=>checkPlacementVideos(snapshot,sources,storage),/1-2位決定戦/);
});
