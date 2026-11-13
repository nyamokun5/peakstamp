import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInlineBatchReadiness} from '../sposched-inline-batch-gate.mjs';
const snapshot=()=>({eventId:'event-test',matches:[
 {seq:1,status:'scheduled',leftTeam:'Team1',rightTeam:'Team2'},
 {seq:2,status:'scheduled',leftTeam:'Team3',rightTeam:'Team4'},
 {seq:3,status:'waiting'},{seq:4,status:'waiting'}],
 playerTeam:new Map([['A','Team1'],['B','Team2'],['C','Team3'],['D','Team4']])});
const g=(seq,scorer,id)=>({seq,scorer,assistMode:'none',goal:{id,source:{name:'m'+seq+'.mov'}}});
const goals=()=>[g(1,'A','1'),g(2,'D','2'),g(3,'B','3'),g(4,'A','4')];
test('accepts four unmodified official fixtures',()=>{
 const r=validateInlineBatchReadiness(snapshot(),goals());
 assert.equal(r.complete,true);
});
test('blocks a stale official knockout pairing',()=>{
 const ss=snapshot();ss.matches[3].leftTeam='Team2';ss.matches[3].rightTeam='Team4';
 assert.throws(()=>validateInlineBatchReadiness(ss,goals()),/一致しません/);
});
test('blocks finished fixtures before new writes',()=>{
 const ss=snapshot();ss.matches[0].status='finished';
 assert.throws(()=>validateInlineBatchReadiness(ss,goals()),/状態が変更/);
});
test('blocks tied first round until human decision',()=>{
 assert.throws(()=>validateInlineBatchReadiness(snapshot(),[g(1,'A','1'),g(1,'B','2')]),/第1・第2/);
});
test('blocks tied final until human decision',()=>{
 assert.throws(()=>validateInlineBatchReadiness(snapshot(),[g(1,'A','1'),g(2,'D','2'),g(3,'B','3'),g(4,'A','4'),g(4,'D','5')]),/第3・第4/);
});
