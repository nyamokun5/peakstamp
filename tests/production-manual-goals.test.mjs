import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {manualDraftEnvironment,makeManualGoal,manualStoreKey,storeManualGoals,restoreManualGoals,applyManualRowEdits} from '../sposched-manual-goals.mjs';
const E='11111111-1111-4111-8111-111111111111';
const G='22222222-2222-4222-8222-222222222222';
const M='33333333-3333-4333-8333-333333333333';
test('manual editing requires a direct snapshot for the selected environment',()=>{
 assert.equal(manualDraftEnvironment({environment:'production',eventId:E,productionLoaded:true}),'production');
 assert.equal(manualDraftEnvironment({environment:'staging',eventId:E,stagingLoaded:true}),'staging');
 for(const args of [
  {environment:'production',eventId:E,stagingLoaded:true},
  {environment:'production',eventId:E},
  {environment:'production',eventId:E,stagingLoaded:true,productionLoaded:true},
  {environment:'production',eventId:'invalid',productionLoaded:true},
 ])assert.equal(manualDraftEnvironment(args),null);
});
test('production draft restoration remains isolated and requires fresh confirmation',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};
 const goal=makeManualGoal(G);
 goal.review={seq:1,scorer:'A',assist:'',assistMode:'none',team:'Blue',include:true};
 storeManualGoals(storage,'production',E,[goal]);
 assert.deepEqual(restoreManualGoals(storage,'staging',E),[]);
 const restored=restoreManualGoals(storage,'production',E);
 assert.equal(restored[0].review.scorer,'A');
 const row=applyManualRowEdits([{goal:restored[0],confirmed:true}],restored,
  {matches:[{seq:1,leftTeam:'Blue',rightTeam:'Red'}],players:['A']})[0];
 assert.equal(row.confirmed,false);
 assert.equal(row.scorer,'A');
 storeManualGoals(storage,'production',E,[]);
 assert.deepEqual(restoreManualGoals(storage,'production',E),[]);
});
test('production manual add, restore, delete perform no upstream writes',
 {skip:!process.env.PLAYWRIGHT_MODULE},async()=>{
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 let writes=0;
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.host==='peakstamp.local'){
    const path=u.pathname==='/'?'sposched-review.html':u.pathname.slice(1);
    return route.fulfill({body:await readFile(new URL('../'+path,import.meta.url)),contentType:path.endsWith('.html')?'text/html':'text/javascript'});
   }
   if(route.request().method()!=='GET'){writes++;return route.abort();}
   assert.equal(u.host,'shoot-sunday-sync.yomax1979.workers.dev');
   let json;
   if(u.pathname==='/events')json={events:[{event_id:E,name:'Mock',date:'2026-11-01',status:'target'}]};
   else if(u.pathname==='/snapshot')json={event_id:E,event:{name:'Mock',date:'2026-11-01',status:'target'},roster:{Blue:['A'],Red:['B']},matches:[{seq:1,match_id:M,status:'scheduled',left_team:'Blue',right_team:'Red',left_score:0,right_score:0,goals:[]}]};
   else throw Error('Unexpected read '+u.pathname);
   return route.fulfill({json,headers:{'Access-Control-Allow-Origin':'*'}});
  });
  async function load(){
   await page.goto('https://peakstamp.local/');
   await page.fill('#ssBridgeToken','mock-only');
   await page.click('#ssLoadEvents');
   await page.locator('#ssLoadSnapshot').waitFor({state:'visible'});
   await page.click('#ssLoadSnapshot');
   await page.locator('#productionPanel').waitFor({state:'visible'});
   await page.click('#quickEdit');
   await page.locator('#manualAddGoal').waitFor({state:'visible'});
  }
  await load();
  await page.click('#manualAddGoal');
  assert.equal(await page.locator('#goalRows article').count(),1);
  const fields=page.locator('#goalRows article .fields').first().locator('select');
  await fields.nth(0).selectOption('1');
  await fields.nth(1).selectOption('A');
  await fields.nth(2).selectOption('none');
  await fields.nth(4).selectOption('Blue');
  let stored=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),manualStoreKey('production',E));
  assert.equal(stored.length,1);assert.equal(stored[0].sent,false);
  assert.equal(stored[0].review.scorer,'A');assert.equal(stored[0].review.assistMode,'none');
  assert.equal(await page.evaluate(k=>localStorage.getItem(k),manualStoreKey('staging',E)),null);
  await load();
  assert.equal(await page.locator('#goalRows article').count(),1);
  assert.equal(await page.locator('#goalRows article .fields').first().locator('select').nth(1).inputValue(),'A');
  await page.locator('#goalRows article button').filter({hasText:'削除'}).first().click();
  assert.equal(await page.locator('#goalRows article').count(),0);
  stored=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),manualStoreKey('production',E));
  assert.deepEqual(stored,[]);assert.equal(writes,0);
 }finally{await browser.close();}
});
