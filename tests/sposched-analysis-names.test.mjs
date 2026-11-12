import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSpoSnapshot,prepareGoalRows} from '../sposched-review-core.mjs';
import {resolveAnalysisGoal,fixturePeople} from '../sposched-analysis-identity.mjs';
import {readAnalysisContext} from '../sposched-analysis-names.mjs';
import {createGoalDrafts,saveGoalDrafts,confirmedGoalExport} from '../goal-stats.mjs';
import {aliasIntentsForCommittedGoal,persistCommittedGoalAliases} from '../sposched-goal-commit-alias.mjs';
const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const names=['濱直','やまだじょ','Ashikawa','達夫','SUZUKI','橋本 泰成','Yohei Tyler Takasaki','別チーム'];
export const rawSnapshot={event_id:id(100),roster_source:'official-current-event-teams',
 matches:[{seq:1,match_id:id(101),status:'scheduled',left_team:'チーム1',right_team:'チーム2',goals:[]}],
 roster:{'チーム1':names.slice(0,7),'チーム3':[names[7]]},
 roster_players:names.map((name,i)=>({name,team:i===7?'チーム3':'チーム1',player_id:id(i+20),user_id:id(i+1)}))};
const snapshot=normalizeSpoSnapshot(rawSnapshot);
const raw=['ハマさん','ジョージさん','芦川さん','達夫','つーちゃん','ハッシー','高崎','高崎','たけざき'];
const expected=[...names.slice(0,7),names[6],names[6]];
const aliases=raw.filter(n=>n!=='達夫').map(n=>({alias:n,member_id:id(names.indexOf(expected[raw.indexOf(n)])+1)}));
const ctx={snapshot,aliases};
const goal=(scorer='ハマさん',assist='')=>({id:'g',origin:'audio',status:'draft',scorer,assist,
 assistStatus:assist?'named':'none',matchSeq:'1',timeSeconds:30,videoDecision:'kept'});
test('nine supplied observations resolve with official member/player IDs and raw retained',()=>{
 for(let i=0;i<raw.length;i++){
  const g=resolveAnalysisGoal(goal(raw[i]),ctx);
  assert.equal(g.scorer,expected[i]);assert.equal(g.rawScorer,raw[i]);
  assert.equal(g.ssIdentity.scorer.memberId,snapshot.memberIds.get(expected[i]));
  assert.equal(g.status,'confirmed');
 }
});
test('direct official name wins over aliases, empty list and kana variants',()=>{
 assert.equal(resolveAnalysisGoal(goal('達夫'),{snapshot,aliases:[]}).scorer,'達夫');
 assert.equal(resolveAnalysisGoal(goal('はまさん'),ctx).scorer,'濱直');
 assert.equal(resolveAnalysisGoal(goal('達夫'),{snapshot,aliases:[{alias:'達夫',member_id:id(1)}]}).scorer,'達夫');
});
test('ambiguous aliases including outside fixture, invalid member and missing match stay unresolved',()=>{
 for(const member_id of [id(2),id(8)]){
  const g=resolveAnalysisGoal(goal(),{snapshot,aliases:[...aliases,{alias:'ハマさん',member_id}]});
  assert.equal(g.ssIdentity.scorer,null);assert.equal(g.status,'draft');
 }
 assert.equal(resolveAnalysisGoal(goal('別チーム'),ctx).ssIdentity.scorer,null);
 assert.equal(resolveAnalysisGoal({...goal(),matchSeq:'2'},ctx).ssIdentity.scorer,null);
 assert.ok(!fixturePeople(snapshot,1).includes('別チーム'));
});
test('no assist, named assist, self assist and opposing team',()=>{
 assert.equal(resolveAnalysisGoal(goal(),ctx).ssIdentity.assist,null);
 assert.equal(resolveAnalysisGoal(goal('ハマさん','ジョージさん'),ctx).assist,'やまだじょ');
 assert.equal(resolveAnalysisGoal(goal('ハマさん','ハマさん'),ctx).status,'draft');
 const other={...snapshot,playerTeam:new Map(snapshot.playerTeam).set('やまだじょ','チーム2')};
 assert.equal(resolveAnalysisGoal(goal('ハマさん','ジョージさん'),{snapshot:other,aliases}).ssIdentity.assist,null);
});
test('manual choice preserves raw, validates roster and survives repeat resolution',()=>{
 const g=resolveAnalysisGoal({...goal('未知'),scorer:'濱直',rawScorer:'未知',userEditedGoalFields:['scorer']},ctx);
 assert.equal(g.rawScorer,'未知');assert.equal(g.ssIdentity.scorer.manual,true);
 assert.deepEqual(resolveAnalysisGoal(g,ctx),g);
 assert.equal(resolveAnalysisGoal({...g,scorer:'別チーム'},ctx).ssIdentity.scorer,null);
});
test('context error clears automatic name/confirmation; event and fixture drift reject transfer',()=>{
 const g=resolveAnalysisGoal(goal(),ctx);
 const cleared=resolveAnalysisGoal(g,null);
 assert.equal(cleared.scorer,'ハマさん');assert.equal(cleared.status,'draft');
 for(const changed of [{...snapshot,eventId:id(999)}, {...snapshot,matches:[{...snapshot.matches[0],matchId:id(999)}]},
 {...snapshot,memberIds:new Map(snapshot.memberIds).set('濱直',id(999))}]){
  const row=prepareGoalRows({goals:[g]},changed)[0];assert.equal(row.scorer,'');
 }
});
test('read-only context handles alias outage, empty aliases, roster errors and wrong event',async()=>{
 const read=async path=>path.startsWith('/snapshot')?rawSnapshot:{aliases:[]};
 assert.deepEqual((await readAnalysisContext({eventId:id(100),read})).aliases,[]);
 const failed=await readAnalysisContext({eventId:id(100),read:async p=>{if(p.includes('alias'))throw Error('offline');return rawSnapshot}});
 assert.equal(failed.aliasError,true);
 assert.equal(resolveAnalysisGoal(goal('達夫'),failed).ssIdentity.scorer.name,'達夫');
 await assert.rejects(readAnalysisContext({eventId:id(100),read:async()=>{throw Error()}}));
 await assert.rejects(readAnalysisContext({eventId:id(999),read}));
});
test('draft -> JSON -> fresh SS review preserves identities and learning occurs after verified goal only',async()=>{
 const data=new Map(),store={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
 const source={file:{name:'test.mov',size:10,lastModified:1},matchNumber:1,duration:60};
 const g=resolveAnalysisGoal({...goal('未知'),scorer:'濱直',rawScorer:'未知',userEditedGoalFields:['scorer']},ctx);
 saveGoalDrafts(source,store,[g]);
 const exported=confirmedGoalExport([source],store);
 assert.equal(exported.goals[0].rawScorer,'未知');
 const row=prepareGoalRows(exported,snapshot)[0];
 assert.equal(row.scorer,'濱直');assert.equal(row.scorerGuess.confidence,'high');
 assert.deepEqual(aliasIntentsForCommittedGoal({row,snapshot}),[]);
 const intents=aliasIntentsForCommittedGoal({row,snapshot,goalVerified:true});
 assert.equal(intents[0].alias,'未知');
 let writes=0;
 const outcome=await persistCommittedGoalAliases({intents,save:async()=>{writes++;throw Error('lost')}});
 assert.equal(writes,1);assert.equal(outcome[0].saved,false);assert.equal(exported.goals[0].scorer,'濱直');
});
test('reanalysis does not duplicate a renamed goal or overwrite raw',()=>{
 const data=new Map(),store={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
 const source={file:{name:'x',size:1,lastModified:1},matchNumber:1,duration:60};
 const g=resolveAnalysisGoal({...goal(),videoDecision:undefined},ctx);saveGoalDrafts(source,store,[g]);
 store.setItem('peakstamp_gemini_primary_json_v1',JSON.stringify({'x::1::1':{utterances:[{kind:'goal_call',time_seconds:31,scorer:'ハマさん',quote:'new'}]}}));
 const rows=createGoalDrafts(source,store).items;assert.equal(rows.length,1);assert.equal(rows[0].rawScorer,'ハマさん');
});

test('spoken team conflict and out-of-fixture official-name alias cannot auto-resolve',()=>{
 assert.equal(resolveAnalysisGoal({...goal(),teamA:'3',teamB:'4'},ctx).ssIdentity.scorer,null);
 assert.equal(resolveAnalysisGoal({...goal(),matchLabel:'3 vs 4'},ctx).ssIdentity.scorer,null);
 assert.equal(resolveAnalysisGoal({...goal(),teamA:'1',teamB:'2'},ctx).scorer,'濱直');
 assert.equal(resolveAnalysisGoal(goal('別チーム'),{snapshot,aliases:[{alias:'別チーム',member_id:id(1)}]}).ssIdentity.scorer,null);
});

test('observed 足川 speech variant resolves only through unique verified 芦川 alias',()=>{
 const g=resolveAnalysisGoal(goal('足川'),ctx);
 assert.equal(g.scorer,'Ashikawa');
 assert.equal(g.rawScorer,'足川');
 assert.equal(g.ssIdentity.scorer.memberId,snapshot.memberIds.get('Ashikawa'));
 assert.equal(resolveAnalysisGoal(goal('足川'),{snapshot,aliases:[]}).scorer,'Ashikawa');
 const ambiguous=[...aliases,{alias:'芦川さん',member_id:id(1)}];
 assert.equal(resolveAnalysisGoal(goal('足川'),{snapshot,aliases:ambiguous}).ssIdentity.scorer,null);
 const absent={...snapshot,players:snapshot.players.filter(name=>name!=='Ashikawa')};
 assert.equal(resolveAnalysisGoal(goal('足川'),{snapshot:absent,aliases:[]}).ssIdentity.scorer,null);
});

test('phonetic hiragana scorer matches unique official romanized name without alias',()=>{
 const result=resolveAnalysisGoal(goal('あしかわ'),{snapshot,aliases:[]});
 assert.equal(result.scorer,'Ashikawa');
 assert.equal(result.rawScorer,'あしかわ');
 assert.equal(result.ssIdentity.scorer.memberId,snapshot.memberIds.get('Ashikawa'));
 const duplicate={...snapshot,players:[...snapshot.players,'ashikawa'],memberIds:new Map(snapshot.memberIds).set('ashikawa',id(50)),playerTeam:new Map(snapshot.playerTeam).set('ashikawa','チーム1')};
 assert.equal(resolveAnalysisGoal(goal('あしかわ'),{snapshot:duplicate,aliases:[]}).ssIdentity.scorer,null);
 assert.equal(resolveAnalysisGoal(goal('あしかわ'),{snapshot,aliases:[{alias:'あしかわ',member_id:id(1)}]}).ssIdentity.scorer.name,'濱直');
});
