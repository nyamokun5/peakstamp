import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSpoSnapshot} from '../sposched-review-core.mjs';
import {describeOfficialFixtures} from '../sposched-fixture-layout.mjs';
import {validateIndependentProductionEvidence} from '../sposched-production-independent.mjs';
import {validateProductionReleaseEvidence} from '../sposched-production-release.mjs';

const eventId='11111111-1111-4111-8111-111111111111';
const titles=['準決勝 #1','準決勝 #2','3位決定戦','決勝'];
const raw=()=>({event_id:eventId,matches:titles.map((title,i)=>({
 seq:i+1,match_id:'33333333-3333-4333-8333-33333333333'+(i+1),title,
 status:i<2?'scheduled':'waiting',left_team:i<2?'Team '+(i*2+1):'',
 right_team:i<2?'Team '+(i*2+2):'',left_score:0,right_score:0,goals:[]
}))});
const evidence=input=>({environment:'PRODUCTION',mode:'read-only',event_id:eventId,
 team_pinned:true,team_id:'22222222-2222-4222-8222-222222222222',
 write_allowed:false,release_approved:false,matches:input.matches.map(m=>({
 seq:m.seq,match_id:m.match_id,status:m.status
}))});
const release={environment:'PRODUCTION',release_ready:true,scope:'current-target',
 target_event_id:eventId,event_id:eventId};

test('normalized official semifinal/placement titles preserve legacy production gate',()=>{
 const input=raw(),snapshot=normalizeSpoSnapshot(input);
 assert.equal(describeOfficialFixtures(snapshot).automaticFourMatch,true);
 assert.equal(validateProductionReleaseEvidence(snapshot,evidence(input),release).fixture_ids.length,4);
});

test('unlabelled waiting slots cannot become an eligible independent batch from count alone',()=>{
 const input=raw();
 for(const m of input.matches)delete m.title;
 const snapshot=normalizeSpoSnapshot(input),layout=describeOfficialFixtures(snapshot);
 assert.equal(layout.automaticFourMatch,false);
 assert.equal(layout.waiting,2);
 assert.throws(()=>validateIndependentProductionEvidence(snapshot,evidence(input),release),/独立試合形式/);
});
