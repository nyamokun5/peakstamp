// Production UI acceptance with intercepted HTTP only: no live SpoSched writes.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,
 ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const E='11111111-1111-4111-8111-111111111111';
const T='22222222-2222-4222-8222-222222222222';
const ids=[1,2,3,4].map(n=>'33333333-3333-4333-8333-33333333333'+n);
const snapshot={event_id:E,
 event:{date:'2026-11-01',name:'Sunday',status:'target'},
 matches:ids.map((match_id,i)=>({seq:i+1,match_id,
  status:i<2?'scheduled':'waiting',left_team:i<2?'Team '+(i*2+1):'',
  right_team:i<2?'Team '+(i*2+2):'',
  left_score:0,right_score:0,goals:[]})),
 roster:{'Team 1':['A'],'Team 2':['B'],'Team 3':['C'],'Team 4':['D']}
};
let releaseReady=false,productionWrites=0,checks=0,otherReads=0;
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.host==='peakstamp.local'){
  const path=url.pathname==='/'?'sposched-review.html':url.pathname.slice(1);
  try{return route.fulfill({body:await readFile(new URL('../'+path,import.meta.url)),
   contentType:path.endsWith('.html')?'text/html':'text/javascript'})}
  catch{return route.fulfill({status:404,body:'Missing local asset '+path})}
 }
 assert.equal(url.host,'shoot-sunday-sync.yomax1979.workers.dev');
 if(route.request().method()!=='GET'){productionWrites++;throw Error('Unexpected production mutation');}
 let response;
 if(url.pathname==='/events')response={events:[{event_id:E,date:'2026-11-01',name:'Sunday',status:'target'}]};
 else if(url.pathname==='/snapshot')response=snapshot;
 else if(url.pathname==='/production/release-state'){
  checks++;response={environment:'PRODUCTION',event_id:E,release_ready:releaseReady};
 }else if(url.pathname==='/production/inspect'){
  response={environment:'PRODUCTION',mode:'read-only',event_id:E,
   team_pinned:true,team_id:T,event_date:'2026-11-01',write_allowed:false,
   release_approved:false,matches:ids.map((match_id,i)=>({
    seq:i+1,match_id,status:i<2?'scheduled':'waiting'}))};
 }else{otherReads++;throw Error('Unexpected read '+url.pathname);}
 return route.fulfill({json:response,headers:{'Access-Control-Allow-Origin':'*'}});
});
try{
 await page.goto('https://peakstamp.local/');
 await page.fill('#ssBridgeToken','production-bridge-mock-only');
 await page.click('#ssLoadEvents');
 await page.locator('#ssLoadSnapshot').waitFor({state:'visible'});
 await page.click('#ssLoadSnapshot');
 await page.locator('#productionPanel').waitFor({state:'visible'});
 assert.equal(await page.locator('#productionStart').isDisabled(),true);
 assert.equal(await page.locator('#workerBatchRun').isVisible(),false);
 await page.click('#productionCheck');
 await page.waitForFunction(()=>document.getElementById('productionPlan').textContent.includes('確認未完了'));
 assert.equal(await page.locator('#productionStart').isDisabled(),true);
 assert.equal(await page.locator('#productionApproveWrap').isVisible(),false);
 releaseReady=true;
 await page.click('#productionCheck');
 await page.locator('#productionApproveWrap').waitFor({state:'visible'});
 assert.equal(await page.locator('#productionStart').isDisabled(),true,
  'production release cannot start without direct operator confirmation');
 assert.ok(checks>=2);
 assert.equal(productionWrites,0);
 assert.equal(otherReads,0);
 assert.deepEqual(errors,[]);
 console.log('PASS: mobile production gate stays closed when disabled, requires fresh official GET and explicit approval; zero writes');
}finally{await browser.close()}
