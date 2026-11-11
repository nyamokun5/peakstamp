import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSsAliasProposal as propose} from '../sposched-alias-proposal.mjs';
const roster=[{name:'西村',aliases:['YO']},{name:'山口',aliases:['TOMO']}];
test('confirmed Japanese nickname proposes SS official member alias',()=>{
 assert.deepEqual(propose({spoken:'よーさん',officialName:'西村',confirmed:true,source:'local-video',candidates:roster}),
  {ready:true,proposal:{alias:'よーさん',person:'西村',source:'local-video'}});
});
test('youtube confirmations use the same safe alias contract',()=>{
 assert.equal(propose({spoken:'ヨーさん',officialName:'西村',confirmed:true,source:'youtube',candidates:roster}).ready,true);
});
test('AI-only inference never proposes a write',()=>{
 assert.equal(propose({spoken:'じょーじさん',officialName:'山口',source:'youtube',candidates:roster}).ready,false);
});
test('existing aliases and collisions are rejected',()=>{
 assert.equal(propose({spoken:'yo',officialName:'西村',confirmed:true,source:'youtube',candidates:roster}).ready,false);
 assert.equal(propose({spoken:'TOMO',officialName:'西村',confirmed:true,source:'youtube',candidates:roster}).ready,false);
});
test('unknown official member and invalid source are rejected',()=>{
 assert.equal(propose({spoken:'たろー',officialName:'不存在',confirmed:true,source:'youtube',candidates:roster}).ready,false);
 assert.equal(propose({spoken:'たろー',officialName:'西村',confirmed:true,source:'other',candidates:roster}).ready,false);
});
