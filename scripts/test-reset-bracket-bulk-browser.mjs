import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,
 ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const E='11111111-1111-4111-8111-111111111111';
const old=[1,2,3,4].map(n=>'22222222-2222-4222-8222-22222222222'+n);
const current=[1,2,3,4].map(n=>'33333333-3333-4333-8333-33333333333'+n);
let reset=false,officialReads=0,otherRequests=0,dialogs=0;
const cancel=process.env.TEST_RESET_BULK_CANCEL==='1';
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('dialog',d=>{dialogs++;if(cancel)d.dismiss();else d.accept()});
await page.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.host==='peakstamp.local'){
  const path=url.pathname==='/'?'sposched-review.html':url.pathname.slice(1);
  try{return await route.fulfill({body:await readFile(new URL('../'+path,import.meta.url)),
   contentType:path.endsWith('.html')?'text/html':'text/javascript'})}
  catch{return route.fulfill({status:404,body:'Missing local asset'})}
 }
 assert.equal(url.host,'shoot-sunday-sync-staging.yomax1979.workers.dev');
 assert.equal(route.request().method(),'GET','review cannot submit any POST');
 let data;
 if(url.pathname==='/events')data={events:[{event_id:E,name:'TEST',date:'2026-10-25'}]};
 else if(url.pathname==='/snapshot'){
  officialReads++;
  const ids=reset?current:old;
  data={event_id:E,matches:ids.map((match_id,i)=>({
   seq:i+1,match_id,title:i<2?'準決勝':'決勝',
   status:i<2?'scheduled':'waiting',
   left_team:i<2?'チーム'+(i*2+1):'',
   right_team:i<2?'チーム'+(i*2+2):'',
   left_score:0,right_score:0,goals:[]
  })),roster:{チーム1:['山田'],チーム2:['西村'],チーム3:['田中'],チーム4:['橋本']}};
 }else{otherRequests++;throw Error('unexpected API request '+url.pathname)}
 await route.fulfill({json:data,headers:{'Access-Control-Allow-Origin':'*'}});
});
await page.addInitScript(()=>{
 const file={name:'IMG_0286.MOV',size:1234,lastModified:1000};
 localStorage.setItem('peakstamp_current_video_project_v1',JSON.stringify({
  version:1,projectId:'reset-goal-test',files:[file],updatedAt:1000
 }));
 localStorage.setItem('peakstamp_confirmed_goals_v1:IMG_0286.MOV::1234::1000',
  JSON.stringify({source:file,items:[1,2,3].map(n=>({
   id:'goal-'+n,origin:'manual',status:'confirmed',
   timeSeconds:n*90,goalTimeSeconds:n*90,
   scorer:'山田',assistStatus:'none',matchSeq:n
  }))}));
});
try{
 await page.goto('https://peakstamp.local/');
 await page.selectOption('#ssEnvironment','staging');
 await page.fill('#ssBridgeToken','mock-bridge-token');
 await page.click('#ssLoadEvents');
 await page.click('#ssLoadSnapshot');
 await page.waitForFunction(()=>document.querySelectorAll('#quickGoals .quick-goal').length===3);
 assert.equal(await page.locator('#quickGoals .quick-goal').count(),3);
 assert.equal(await page.locator('#quickResetBulkReview').isVisible(),false);
 reset=true;
 await page.click('#ssLoadSnapshot');
 await page.locator('#quickResetBulkReview').waitFor({state:'visible'});
 assert.match(await page.locator('#quickResetBulkReview').innerText(),/3件/);
 assert.equal(await page.getByRole('button',{name:'この試合番号・新しい試合IDを確認する'}).count(),3);
 const priorReads=officialReads;
 await page.click('#quickResetBulkReview');
 await page.waitForFunction(isCancel=>{
  const text=document.getElementById('quickResetBulkStatus')?.textContent||'';
  return isCancel?text.includes('キャンセル'):text.includes('3件の新しい試合番号');
 },cancel);
 assert.equal(officialReads,priorReads+2,'reset review must read two official fresh snapshots');
 assert.equal(dialogs,1,'reset needs only one explicit approval');
 if(cancel){
  assert.equal(await page.locator('#quickResetBulkReview').isVisible(),true);
  assert.equal(await page.getByRole('button',{name:'この試合番号・新しい試合IDを確認する'}).count(),3);
 }else{
  await page.waitForFunction(()=>document.getElementById('quickResetBulkStatus').textContent.includes('3件の新しい試合番号'));
  assert.equal(await page.locator('#quickResetBulkReview').isVisible(),false);
  assert.equal(await page.getByRole('button',{name:'この試合番号・新しい試合IDを確認する'}).count(),0);
 }
 assert.equal(otherRequests,0);
 assert.deepEqual(errors,[]);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('PASS: iPhone 4-fixture reset requires one optional safe approval, two official GET reads, zero writes');
}finally{await browser.close()}
