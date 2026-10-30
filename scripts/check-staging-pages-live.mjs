// STAGING ONLY: prove the real Cloudflare Pages deployment after staging merge.
// Unauthenticated GET and CORS OPTIONS only. No tokens, cookies, POST or SS writes.
import assert from 'node:assert/strict';
const SITE='https://peakstamp-ss-stage-nyamokun5.pages.dev';
const WORKER='https://shoot-sunday-sync-staging.yomax1979.workers.dev';
const MUST_HAVE=[
 ['sposched-review.html','id="stagingBuildBanner"'],
 ['sposched-review.html','SS公式の試合一覧'],
 ['sposched-review.html',"from './sposched-fixture-layout.mjs'"],
 ['sposched-fixture-layout.mjs','function describeOfficialFixtures'],
 ['sposched-fixture-layout.mjs','function drawOptionForFixture']
];
const pause=ms=>new Promise(done=>setTimeout(done,ms));
async function once(){
 const payload={};
 for(const [file,expected] of MUST_HAVE){
  if(!payload[file]){
   const r=await fetch(SITE+'/'+file,{redirect:'error',cache:'no-store',
    signal:AbortSignal.timeout(12000)});
   if(r.status!==200)throw Error('Pages /'+file+' HTTP '+r.status);
   payload[file]=await r.text();
  }
  assert.ok(payload[file].includes(expected),'Pages /'+file+' missing release marker '+expected);
 }
 const page=payload['sposched-review.html'];
 assert.ok(page.includes('<select id="ssEnvironment" aria-label="SpoSched接続先" disabled>'),
  'environment must remain STAGING-locked');
 assert.ok(!page.includes('<option value="production">') &&
  !page.includes('https://shoot-sunday-sync.yomax1979.workers.dev'),
  'production SS is forbidden in the TEST build');
 assert.ok(!page.includes("from './sposched-production-ui.mjs"),
  'production UI writer must not be shipped');
 const health=await fetch(WORKER+'/health',{redirect:'error',
  signal:AbortSignal.timeout(12000)});
 assert.equal(health.status,200);
 const status=await health.json();
 assert.equal(status.service,'shoot-sunday-sync-staging');
 assert.equal(status.write_mode,'test-only');
 const preflight=await fetch(WORKER+'/events',{method:'OPTIONS',redirect:'error',
  headers:{Origin:SITE,'Access-Control-Request-Method':'GET',
   'Access-Control-Request-Headers':'x-ss-bridge-token'},
  signal:AbortSignal.timeout(12000)});
 assert.equal(preflight.status,204);
 assert.equal(preflight.headers.get('access-control-allow-origin'),SITE);
 return true;
}
// Pages Builds may finish after GitHub Actions starts on the same commit.
for(let attempt=1;attempt<=15;attempt++){
 try{
  await once();
  console.log('PASS: live STAGING Pages has variable-fixture UI; production writer stripped; Worker CORS and health verified. GET/OPTIONS only.');
  process.exit(0);
 }catch(e){
  if(attempt===15)throw e;
  console.log('Pages/Worker release not yet ready (attempt '+attempt+'/15): '+e.message);
  await pause(8000);
 }
}
