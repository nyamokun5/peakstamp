import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,
 ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const E='11111111-1111-4111-8111-111111111111';
const ids=[1,2,3,4].map(n=>'22222222-2222-4222-8222-22222222222'+n);
const matches=ids.map((match_id,i)=>({
 match_id,seq:i+1,title:i<2?'準決勝':i===2?'3位決定戦':'決勝',
 status:i<2?'scheduled':'waiting',
 left_team:i<2?'チーム'+(i*2+1):'',right_team:i<2?'チーム'+(i*2+2):'',
 left_score:0,right_score:0,winner:null,goals:[]
}));
let starts=0,unexpected=0,body=null;const errors=[],dialogs=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('dialog',d=>{dialogs.push(d.message());d.dismiss()});
await page.route('**/*',async route=>{
 const u=new URL(route.request().url()),method=route.request().method();
 if(u.hostname==='peakstamp.local'){
  const path=u.pathname==='/'?'sposched-review.html':u.pathname.slice(1);
  try{return route.fulfill({body:await readFile(new URL('../'+path,import.meta.url)),
    contentType:path.endsWith('.html')?'text/html':'text/javascript'})}
  catch{return route.fulfill({status:404,body:'No test source'})}
 }
 assert.equal(u.hostname,'shoot-sunday-sync-staging.yomax1979.workers.dev',
  'any PROD or unknown network access is forbidden');
 let data;
 if(u.pathname==='/events'){
  assert.equal(method,'GET');
  data={events:[{event_id:E,name:'TEST',date:'2026-10-25'}]};
 }else if(u.pathname==='/snapshot'){
  assert.equal(method,'GET');
  data={event_id:E,matches,roster:{
   チーム1:['橋本 泰成','T1'],チーム2:['T2'],
   チーム3:['Hiroyuki Kawata','T3'],チーム4:['T4']
  }};
 }else if(u.pathname==='/staging/batch/start'){
  assert.equal(method,'POST');starts++;
  body=route.request().postDataJSON();
  assert.equal(body.confirm,'TEST-ONLY BATCH WRITE');
  assert.deepEqual(body.operations.map(x=>[x.seq,x.action]),[
   [1,'finish'],[2,'helper'],[2,'create'],[2,'finish'],
   [3,'finish'],[4,'finish']
  ]);
  assert.equal(body.operations.find(o=>o.action==='helper').name,'橋本 泰成');
  assert.equal(body.operations.find(o=>o.action==='helper').team,'チーム3');
  assert.equal(body.operations.find(o=>o.action==='create').assist,'橋本 泰成');
  data={environment:'STAGING ONLY',event_id:E,request_id:body.request_id,
   status:'blocked',phase:'preparing',cursor:0,completed:0,total:6,
   blocked_reason:'mock browser stops before any real write'};
 }else if(u.pathname==='/staging/batch/status'){
  data={environment:'STAGING ONLY',event_id:E,
   request_id:body?.request_id||'33333333-3333-4333-8333-333333333333',
   status:'blocked',phase:'preparing',cursor:0,completed:0,total:6,
   blocked_reason:'mock browser stops before any real write'};
 }else{unexpected++;throw Error('Unexpected endpoint '+method+' '+u.pathname)}
 await route.fulfill({json:data,headers:{'Access-Control-Allow-Origin':'*'}});
});
await page.addInitScript(()=>{
 const file={name:'IMG_0289.MOV',size:1234,lastModified:1000};
 localStorage.setItem('peakstamp_current_video_project_v1',JSON.stringify({
  version:1,projectId:'helper-browser-test',files:[file],updatedAt:1000
 }));
 localStorage.setItem('peakstamp_confirmed_goals_v1:IMG_0289.MOV::1234::1000',
  JSON.stringify({source:file,items:[{
   id:'helper-assist-goal',origin:'manual',status:'confirmed',
   timeSeconds:238,goalTimeSeconds:238,scorer:'Hiroyuki Kawata',
   assist:'橋本 泰成',assistStatus:'named',matchSeq:2
  }]}));
});
try{
 await page.goto('https://peakstamp.local/');
 await page.selectOption('#ssEnvironment','staging');
 await page.fill('#ssBridgeToken','mock-only');
 await page.click('#ssLoadEvents');
 await page.locator('#ssEventSelect option').last().waitFor();
 await page.click('#ssLoadSnapshot');
 await page.locator('#quickGoals .quick-goal').first().waitFor();
 const text=await page.locator('#quickGoals').innerText();
 assert.match(text,/助っ人/);
 assert.match(text,/橋本 泰成/);
 assert.match(text,/Hiroyuki Kawata/);
 assert.match(text,/チーム3/);
 assert.equal(await page.locator('#workerBatchRun').isEnabled(),true);
 await page.click('#workerBatchRun');
 await page.waitForFunction(()=>document.querySelector('#workerBatchStatus')
   ?.textContent.includes('mock browser'));
 assert.equal(starts,1);
 assert.equal(unexpected,0);
 assert.deepEqual(dialogs,[],'reviewed single-click needs no second dialog');
 assert.deepEqual(errors,[]);
 console.log('PASS: mocked iPhone one-click assistant helper enrollment precedes goal; correct score team; no PROD traffic');
}finally{await browser.close()}
