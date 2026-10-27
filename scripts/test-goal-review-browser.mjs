// Mobile UI regression: unresolved match numbers must be visible, never
// silently omitted from the TEST registration plan. All HTTP is intercepted.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,
 ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const E='11111111-1111-4111-8111-111111111111';
const ids=[1,2,3,4].map(n=>`22222222-2222-4222-8222-22222222222${n}`);
const matches=ids.map((match_id,i)=>({
 match_id,seq:i+1,title:i<2?'準決勝':i===2?'3位決定戦':'決勝',
 status:i<2?'scheduled':'waiting',
 left_team:i<2?'チーム'+(i*2+1):'',
 right_team:i<2?'チーム'+(i*2+2):'',
 left_score:0,right_score:0,goals:[]
}));
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[];const writes=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(u.host==='peakstamp.local'){
  const path=u.pathname==='/'?'sposched-review.html':u.pathname.slice(1);
  try{return await route.fulfill({body:await readFile(new URL('../'+path,import.meta.url)),
   contentType:path.endsWith('.html')?'text/html':'text/javascript'})}
  catch{return route.fulfill({status:404,body:'Not found'})}
 }
 assert.equal(u.host,'shoot-sunday-sync-staging.yomax1979.workers.dev');
 if(route.request().method()==='POST')writes.push(u.pathname);
 if(u.pathname==='/events')
  return route.fulfill({json:{events:[{event_id:E,name:'TEST',date:'2026-10-25'}]},
   headers:{'Access-Control-Allow-Origin':'*'}});
 if(u.pathname==='/snapshot')
  return route.fulfill({json:{event_id:E,matches,roster:{
   'チーム1':['山田'],'チーム2':['西村','徳永'],
   'チーム3':['田中'],'チーム4':['橋本']
  }},headers:{'Access-Control-Allow-Origin':'*'}});
 throw Error('Unexpected TEST API '+u.pathname);
});
await page.addInitScript(()=>{
 const source={name:'IMG_0289.MOV',size:1234,lastModified:1000};
 localStorage.setItem('peakstamp_current_video_project_v1',JSON.stringify({
  version:1,projectId:'test-project',files:[source],updatedAt:1000}));
 const key='peakstamp_confirmed_goals_v1:IMG_0289.MOV::1234::1000';
 if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({
  source,items:[{id:'missing-match',origin:'manual',status:'confirmed',timeSeconds:238,
   goalTimeSeconds:238,scorer:'西村',assist:'徳永',assistStatus:'named'}]}));
});
try{
 async function load(){
  await page.goto('http://peakstamp.local/');
  await page.selectOption('#ssEnvironment','staging');
  await page.fill('#ssBridgeToken','mock-token');
  await page.click('#ssLoadEvents');
  await page.click('#ssLoadSnapshot');
  await page.locator('#autoGoalDetails').waitFor({state:'visible'});
  await page.locator('#quickGoals .quick-goal').waitFor({state:'visible'});
 }
 await load();
 const visible=page.locator('#quickGoals .quick-goal');
 assert.equal(await visible.count(),1);
 assert.match(await visible.first().innerText(),/試合番号：未設定/);
 assert.match(await visible.first().innerText(),/試合番号が未設定/);
 assert.equal(await page.locator('#autoRun').isDisabled(),true);
 assert.match(await page.locator('#autoBeforeRun').innerText(),/試合番号が未設定/);
 const card=await page.locator('#autoGoalDetails').boundingBox();
 const button=await page.locator('#autoPanel').boundingBox();
 assert.ok(card.y<button.y,'corrections must appear ABOVE registration');
 await page.locator('[aria-label="#1 試合"]').selectOption('1');
 assert.match(await page.locator('#quickGoals .quick-goal').innerText(),/試合 #1/);
 assert.equal(await page.locator('#autoRun').isEnabled(),true);

 // A conflicting voice interpretation proposes a video slot but must
 // require explicit human verification; never blank out its proposed number.
 await page.evaluate(()=>{
  const key='peakstamp_confirmed_goals_v1:IMG_0289.MOV::1234::1000';
  const v=JSON.parse(localStorage.getItem(key));
  Object.assign(v.items[0],{matchSeq:1,matchLabel:'チーム3対チーム4',teamA:'3',teamB:'4'});
  localStorage.setItem(key,JSON.stringify(v));
 });
 await page.reload();
 await page.locator('#autoGoalDetails').waitFor({state:'visible'});
 await page.selectOption('#ssEnvironment','staging');
 await page.fill('#ssBridgeToken','mock-token');
 await page.click('#ssLoadEvents');
 await page.click('#ssLoadSnapshot');
 await page.locator('.confirm-candidate').waitFor({state:'visible'});
 assert.equal(await page.locator('[aria-label="#1 試合"]').inputValue(),'1');
 assert.match(await page.locator('.match-proposal').first().innerText(),/動画からの候補：試合 #1/);
 assert.equal(await page.locator('#autoRun').isDisabled(),true);
 await page.click('.confirm-candidate');
 assert.equal(await page.locator('#autoRun').isEnabled(),true);
 assert.deepEqual(writes,[]);
 assert.deepEqual(errors,[]);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('PASS: goal review visible above CTA, no unnamed match silently ignored, proposed video match visible but requires explicit approval, no TEST writes');
}finally{await browser.close()}
