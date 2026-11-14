import test from 'node:test';import assert from 'node:assert/strict';
import {prepareInlineContinuation} from '../sposched-inline-continuation.mjs';
const id=n=>String(n).padStart(8,'0')+'-0000-4000-8000-000000000001';
function data(){
 const snapshot={eventId:id(9),rosterSource:'official-current-event-teams',players:['A','B','C','D'],
 matches:[1,2,3,4].map(seq=>({seq,matchId:id(seq),status:seq<3?'finished':'scheduled',leftScore:seq<3?1:0,rightScore:0,
 leftTeam:seq===1?'Team1':seq===2?'Team3':seq===3?'Team2':'Team1',rightTeam:seq===1?'Team2':seq===2?'Team4':seq===3?'Team4':'Team3',existingGoals:[]})),
 playerTeam:new Map([['A','Team1'],['B','Team2'],['C','Team3'],['D','Team4']]),
 roster:{Team1:['A'],Team2:['B'],Team3:['C'],Team4:['D']},
 memberIds:new Map(['A','B','C','D'].map((n,i)=>[n,id(20+i)])),playerIds:new Map(['A','B','C','D'].map((n,i)=>[n,id(30+i)]))};
 const goals={goals:['B','D'].map((name,i)=>({id:'g'+i,source:{name:'match3.mov'},matchSeq:3,teamA:'Team2',teamB:'Team4',scorer:name,assistStatus:'none',
 ssIdentity:{environment:'staging',eventId:id(9),matchId:id(103),seq:3,scorer:{name,memberId:snapshot.memberIds.get(name),playerId:snapshot.playerIds.get(name),team:snapshot.playerTeam.get(name)}}}))};
 const workerJob={event_id:id(9),request_id:id(10),status:'awaiting_second_round',layout_mode:'four-knockout-staged-v1',cursor:4,total:4,fixture_ids:{1:id(1),2:id(2),3:id(3),4:id(4)}};
 return {snapshot,goals,workerJob};
}
test('recreated fixture: revalidate same players against current official bracket and append only later operations',()=>{
 const d=data(),before=JSON.stringify(d.goals);const p=prepareInlineContinuation(d);
 assert.deepEqual(p.operations.filter(x=>x.action==='create').map(x=>x.scorer),['B','D']);
 assert.deepEqual(p.operations.filter(x=>x.action==='finish').map(x=>x.seq),[3,4]);
 assert.ok(p.operations.every(x=>x.seq>=3));assert.equal(JSON.stringify(d.goals),before);
});
test('identity changes, fixture changes, unfinished semifinals and conflicting video pairing all stop',()=>{
 for(const mutate of [d=>d.snapshot.memberIds.set('B',id(99)),d=>d.snapshot.playerIds.set('B',id(99)),d=>d.snapshot.playerTeam.set('B','Team1'),d=>d.workerJob.fixture_ids[3]=id(99),d=>d.snapshot.matches[0].status='scheduled',d=>d.goals.goals[0].teamA='Team1',d=>d.goals.goals[0].ssIdentity.eventId=id(99),d=>d.goals.goals[0].matchSeq=null]){
 const d=data();mutate(d);assert.throws(()=>prepareInlineContinuation(d));
 }
});
test('unresolved official later pairing is not bypassed',()=>{
 const d=data();d.snapshot.matches[2]={...d.snapshot.matches[2],status:'waiting',leftTeam:'',rightTeam:''};
 assert.throws(()=>prepareInlineContinuation(d));
});
