import test from 'node:test';
import assert from 'node:assert/strict';
import {scorerRosterError} from '../sposched-inline-scorer-diagnostic.mjs';
const eventId='event-a',matchId='match-a';
const snapshot={eventId,playerTeam:new Map([['正式名','Team1']]),matches:[{seq:3,matchId}]};
test('unknown scorer reports source name',()=>{
 assert.match(scorerRosterError({scorer:'',goal:{rawScorer:'山田'}},snapshot,2),/ゴール3：得点者「山田」を正式名簿に照合できません/);
});
test('missing fixture ID is not misreported as missing roster member',()=>{
 const snap={...snapshot,matches:[{seq:3,matchId:''}]};
 const row={seq:3,scorer:'',goal:{ssIdentity:{scorer:{name:'正式名'},eventId,matchId,seq:3}}};
 assert.match(scorerRosterError(row,snap,2),/SS試合IDが未確定/);
});
test('changed event is distinguished',()=>{
 const row={seq:3,scorer:'',goal:{ssIdentity:{scorer:{name:'正式名'},eventId:'old',matchId,seq:3}}};
 assert.match(scorerRosterError(row,snapshot,2),/照合先イベントが異なります/);
});
test('valid scorer has no error',()=>{
 assert.equal(scorerRosterError({scorer:'正式名'},snapshot,2),null);
});
