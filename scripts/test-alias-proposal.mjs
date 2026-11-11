import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSsAliasProposal as propose} from '../sposched-alias-proposal.mjs';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const roster=[{name:'西村',user_id:A,aliases:['YO']},{name:'山口',user_id:B,aliases:['TOMO']}];
const base={spoken:'よーさん',officialName:'西村',memberId:A,confirmed:true,source:'local-video',candidates:roster};
test('confirmed Japanese nickname proposes alias with verified stable member UUID',()=>{
 assert.deepEqual(propose(base),
  {ready:true,proposal:{alias:'よーさん',person:'西村',user_id:A,source:'local-video'}});
});
test('youtube confirmations use the same safe alias contract',()=>{
 assert.equal(propose({...base,spoken:'ヨーさん',source:'youtube'}).ready,true);
});
test('AI-only inference never proposes a write',()=>{
 assert.equal(propose({...base,confirmed:false}).ready,false);
});
test('existing aliases and collisions are rejected without overriding other member',()=>{
 assert.equal(propose({...base,spoken:'yo'}).ready,false);
 assert.equal(propose({...base,spoken:'TOMO'}).ready,false);
});
test('missing, malformed, wrong or guest member IDs cannot be written',()=>{
 for(const id of [undefined,'', 'not-an-ss-uuid',B]){
  assert.equal(propose({...base,memberId:id}).ready,false);
 }
 assert.equal(propose({...base,candidates:[{name:'西村',user_id:null}]}).ready,false);
});
test('unknown official member and invalid source are rejected',()=>{
 assert.equal(propose({...base,officialName:'不存在'}).ready,false);
 assert.equal(propose({...base,source:'other'}).ready,false);
});
