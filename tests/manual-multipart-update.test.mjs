import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {saveGoalDrafts,confirmedGoalExport,makeManualGoal as videoManual} from '../goal-stats.mjs';
import {setMatchNumber,joinPreviousMatch,sourcePartLabel,assignMatchNumber} from '../match-label.mjs';
import {makeManualGoal,prepareManualGoalRegistration,markManualCompleted} from '../sposched-manual-goals.mjs';
import {normalizeSpoSnapshot,prepareGoalRows} from '../sposched-review-core.mjs';
import {quickAIObservation,quickGoalDecisions} from '../sposched-quick-review.mjs';
import {previewIndependentFixtures} from '../sposched-independent-preview.mjs';
import {executeReviewedBatchOnce,TEST_TEAM_ID} from '../sposched-staging-batch.mjs';
const E='11111111-1111-4111-8111-111111111111',M='22222222-2222-4222-8222-222222222222',G='33333333-3333-4333-8333-333333333333';
const storage=()=>({data:new Map(),getItem(k){return this.data.get(k)||null},setItem(k,v){this.data.set(k,v)},removeItem(k){this.data.delete(k)}});
const snapshot=()=>normalizeSpoSnapshot({event_id:E,roster:{Team1:['Alice','Amy'],Team2:['Bob']},matches:[{seq:1,match_id:M,status:'scheduled',left_team:'Team1',right_team:'Team2',goals:[]}]});
const manualRow=s=>Object.assign(prepareGoalRows({goals:[makeManualGoal(G)]},s)[0],{seq:1,scorer:'Alice',assistMode:'none',team:'Team1'});

test('video manual origin survives export and is not presented or planned as AI',()=>{
 const st=storage(),source={file:{name:'part1.mov',size:100,lastModified:1},matchNumber:1};
 const goal={...videoManual(12,source,st),scorer:'Alice',assistStatus:'none',status:'confirmed'};
 saveGoalDrafts(source,st,[goal]);
 const exported=confirmedGoalExport([source],st).goals;
 assert.equal(exported[0].manual,true);assert.equal(exported[0].origin,'manual');
 const s=snapshot(),rows=prepareGoalRows({goals:exported},s),d=quickGoalDecisions(s,rows);
 assert.equal(quickAIObservation(rows[0]).label,'手動入力');
 assert.doesNotMatch(quickAIObservation(rows[0]).assistRaw,/AI/);
 assert.equal(d[0].state,'manual');
 assert.throws(()=>previewIndependentFixtures({snapshot:s,rows,decisions:d}));
});
test('two video parts keep separate source identities and local times but generate one finish',()=>{
 const st=storage(),sources=[1,2].map(n=>({file:{name:'part'+n+'.mov',size:100+n,lastModified:n}}));
 sources.forEach((s,i)=>assignMatchNumber(s,i,st));
 assert.equal(joinPreviousMatch(sources,1,st),true);
 assert.deepEqual(sources.map(s=>s.matchNumber),[1,1]);
 assert.equal(sourcePartLabel(sources[1],sources),'第1試合 · 動画 2/2');
 for(const [i,s] of sources.entries())saveGoalDrafts(s,st,[{id:'same-local-id',origin:'audio',status:'confirmed',timeSeconds:50,goalTimeSeconds:40,scorer:i?'Bob':'Alice',assistStatus:'none',matchSeq:'',sourceMatchSeqAutofill:true}]);
 const restored=sources.map(s=>({file:s.file}));restored.forEach((s,i)=>assignMatchNumber(s,i,st));
 const exported=confirmedGoalExport(restored,st).goals;
 assert.deepEqual(exported.map(g=>g.matchSeq),[1,1]);assert.deepEqual(exported.map(g=>g.goalTimeSeconds),[40,40]);
 const s=snapshot(),rows=prepareGoalRows({goals:exported},s);rows.forEach(r=>r.quickReviewedAll=true);
 assert.equal(new Set(rows.map(r=>r.key)).size,2);
 const plan=previewIndependentFixtures({snapshot:s,rows,decisions:quickGoalDecisions(s,rows)});
 assert.deepEqual(plan.operations.map(o=>o.action),['create','create','finish']);
 assert.equal(joinPreviousMatch(sources,0,st),false);
});
test('manual register click validates one goal without requiring a redundant confirmation checkbox',()=>{
 const s=snapshot(),row=manualRow(s);
 const selected=prepareManualGoalRegistration(s,row);
 assert.equal(row.confirmed,false);assert.equal(selected.length,1);
 assert.equal(selected[0].operation.action,'record_goal');
 assert.throws(()=>prepareManualGoalRegistration(s,{...row,scorer:''}),/得点者/);
 assert.throws(()=>prepareManualGoalRegistration(s,{...row,assistMode:'unknown'}),/アシスト/);
 assert.throws(()=>prepareManualGoalRegistration(s,{...row,fixtureIdentityChanged:true}),/試合ID変更/);
 s.matches[0].status='finished';assert.throws(()=>prepareManualGoalRegistration(s,row),/未終了/);
});
const html=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');
const handler=html.slice(html.indexOf('async function registerManualGoal(row){'),html.indexOf("$('manualAddGoal').addEventListener"));
async function exercise({lost=false,pending=false,warning=false,switchEvent=false,refreshFails=false}={}){
 const s=snapshot(),row=manualRow(s),nodes=new Map(),st=storage(),calls=[];
 let journal=false,sends=0,busy=false;
 const action={action:'create',match_id:M,side:'left',scorer_id:G};
 const ctx={snapshot:s,rows:[row],manualGoals:[row.goal],ssConnectionRevision:1,batchBusy:false,loadedFromStagingDirect:true,
  $:k=>{if(!nodes.has(k))nodes.set(k,{value:k==='ssEnvironment'?'staging':''});return nodes.get(k)},
  setBatchBusy:v=>{ctx.batchBusy=v;busy=v},pendingForEvent:()=>pending?[{}]:[],localStorage:st,
  workerBatchStorageKey:x=>x,prepareManualGoalRegistration,executeReviewedBatchOnce,
  resolveReviewedAction:async()=>action,
  postStaging:async(path,payload)=>{calls.push(path);if(path==='/staging/preview'){
   if(switchEvent)ctx.ssConnectionRevision++;
   return {environment:'STAGING ONLY',team_id:TEST_TEAM_ID,preview_token:'mock',plan:{action:'create',match_id:M,side:'left',warning:warning?'extra check':null}};
  }assert.equal(path,'/staging/execute');assert.equal(journal,true);sends++;if(lost)throw Error('lost reply');return {write_sent:true,readback:{verified:true}};},
  fetchSS:async path=>{calls.push(path);if(path.startsWith('/snapshot')){if(refreshFails)throw Error('snapshot failed');return s}return {};},
  beginAttempt:()=>{journal=true},clearAttempt:()=>{journal=false},goalKeyOfOperation:()=>row.key,
  markManualCompleted,saveManual:()=>{},normalizeSpoSnapshot:x=>x,rebuild:()=>{},renderPendingPanel:()=>{}};
 vm.createContext(ctx);vm.runInContext(handler,ctx);
 await vm.runInContext('registerManualGoal(rows[0])',ctx);
 return {ctx,row,journal,sends,busy,calls,message:nodes.get('manualAddStatus').textContent};
}
test('direct manual handler uses signed preview, durable attempt and readback without ending the match',async()=>{
 const r=await exercise();assert.equal(r.sends,1);assert.equal(r.journal,false);assert.equal(r.row.include,false);assert.equal(r.ctx.manualGoals[0].sent,true);assert.equal(r.busy,false);assert.match(r.message,/1ゴールを登録・照合/);assert.ok(r.calls.every(p=>!p.includes('finish')));
});
for(const scenario of ['pending','warning','switchEvent'])test('manual registration stops before writing on '+scenario,async()=>{
 const r=await exercise({[scenario]:true});assert.equal(r.sends,0);assert.equal(r.journal,false);assert.equal(r.row.include,true);assert.equal(r.busy,false);
});
test('lost reply keeps the journal and never retries or marks the goal sent',async()=>{
 const r=await exercise({lost:true});assert.equal(r.sends,1);assert.equal(r.journal,true);assert.equal(r.ctx.manualGoals[0].sent,false);assert.match(r.message,/再送せず/);
});
test('snapshot failure after verified write still excludes the already registered goal',async()=>{
 const r=await exercise({refreshFails:true});assert.equal(r.sends,1);assert.equal(r.row.include,false);assert.equal(r.ctx.manualGoals[0].sent,true);assert.match(r.message,/登録・照合は成功/);
});
