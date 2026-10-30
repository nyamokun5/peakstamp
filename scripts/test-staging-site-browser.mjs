// TEST Pages browser acceptance: only mocked traffic; never touch live SpoSched.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {buildStagingSite} from './build-staging-site.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const folder=await mkdtemp(path.join(tmpdir(),'peakstamp-pages-browser-'));
const browser=await chromium.launch({headless:true,
 ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[];
const eventId='11111111-1111-4111-8111-111111111111';
let productionRequests=0,stagingReads=0,unexpectedRequests=0;
page.on('pageerror',e=>errors.push(e.message));
try{
 await buildStagingSite(folder);
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='peakstamp-stage.local'){
   const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
   try{
    const data=await readFile(path.join(folder,name));
    return route.fulfill({body:data,contentType:name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript'});
   }catch{return route.fulfill({status:404,body:'TEST asset missing: '+name});}
  }
  if(url.hostname==='shoot-sunday-sync.yomax1979.workers.dev'){
   productionRequests++;
   return route.fulfill({status:503,body:'Production is forbidden in TEST'});
  }
  if(url.hostname!=='shoot-sunday-sync-staging.yomax1979.workers.dev'){
   unexpectedRequests++;
   return route.fulfill({status:503,body:'Unknown external host in TEST'});
  }
  stagingReads++;
  assert.equal(route.request().method(),'GET');
  const data=url.pathname==='/events'?{events:[{event_id:eventId,date:'2026-11-01',name:'TEST',status:'target'}]}:{error:{message:'mock path'}};
  return route.fulfill({status:url.pathname==='/events'?200:404,json:data,
   headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'X-SS-Bridge-Token, Content-Type'}});
 });
 await page.goto('https://peakstamp-stage.local/sposched-review.html');
 await page.locator('#stagingBuildBanner').waitFor({state:'visible'});
 assert.match(await page.locator('#stagingBuildBanner').innerText(),/本番SSには送信できません/);
 assert.equal(await page.locator('#ssEnvironment').inputValue(),'staging');
 assert.equal(await page.locator('#ssEnvironment').isDisabled(),true);
 assert.equal(await page.locator('#ssEnvironment option').count(),1);
 assert.equal(await page.locator('#productionPanel').isVisible(),false);
 await page.fill('#ssBridgeToken','fake-test-token-only');
 await page.click('#ssLoadEvents');
 await page.locator('#ssLoadSnapshot').waitFor({state:'visible'});
 assert.equal(stagingReads,1);
 assert.equal(productionRequests,0);
 // Even if a script maliciously adds a production option, no production URL exists.
 await page.evaluate(()=>{
  const e=document.getElementById('ssEnvironment');
  e.disabled=false;
  e.append(new Option('本番SS','production'));
  e.value='production';
 });
 await page.click('#ssLoadEvents');
 await page.getByText(/SSの接続先が不正です/).waitFor({state:'visible'});
 assert.equal(productionRequests,0);
 assert.equal(unexpectedRequests,0);
 assert.deepEqual(errors,[]);
 console.log('PASS: generated TEST Pages opens on mobile, reaches mocked staging only; production cannot be called');
}finally{
 await browser.close();
 await rm(folder,{recursive:true,force:true});
}
