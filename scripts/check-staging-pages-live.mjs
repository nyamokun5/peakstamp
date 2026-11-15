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
async function checkedFetch(url,options={}){
 const original=new URL(url);
 let next=original;
 for(let step=0;step<3;step++){
  const response=await fetch(next,{...options,redirect:'manual'});
  if(response.status<300||response.status>=400)return response;
  const destHeader=response.headers.get('location');
  let dest;
  try{dest=new URL(destHeader,next);}
  catch{throw Object.assign(Error('Malformed redirect from '+next.hostname),{permanent_redirect:true});}
  // Cloudflare Pages canonicalizes only .html GET files to extensionless
  // paths with 308. Allow exactly that one transformation, nothing else.
  const pagesHtmlGet=(original.origin===SITE&&(!options.method||options.method==='GET')&&
   original.pathname.endsWith('.html')&&next.pathname===original.pathname&&
   dest.pathname===original.pathname.slice(0,-5)&&!dest.search&&!dest.hash);
  if(response.status!==308||dest.protocol!=='https:'||
     dest.origin!==original.origin||!pagesHtmlGet)
   throw Object.assign(Error(original.hostname+' HTTP '+response.status+
    ' unsafe redirect to '+dest.origin+dest.pathname),{permanent_redirect:true});
  next=dest;
 }
 throw Object.assign(Error('Too many same-origin redirects from '+original.pathname),{permanent_redirect:true});
}
async function once(){
 const manifestResponse=await checkedFetch(SITE+'/staging-build.json',{
  cache:'no-store',signal:AbortSignal.timeout(12000)});
 if(manifestResponse.status!==200)
  throw Error('Cloudflare Pages STAGING is outdated: staging-build.json HTTP '+manifestResponse.status);
 const manifestType=manifestResponse.headers.get('content-type')||'';
 const manifestRaw=await manifestResponse.text();
 if(!manifestType.includes('application/json')||!manifestRaw.trimStart().startsWith('{'))
  throw Error('Cloudflare Pages has NOT published this STAGING build: /staging-build.json is '+manifestType+
   ' (old site or HTML fallback). Check Cloudflare Pages → Deployments and branch staging.');
 let manifest;
 try{manifest=JSON.parse(manifestRaw)}
 catch{throw Error('Cloudflare Pages /staging-build.json is not valid build metadata')}
 assert.equal(manifest.environment,'STAGING ONLY');
 const expected=process.env.GITHUB_SHA||'';
 if(manifest.commit_sha && expected && manifest.commit_sha!==expected)
  throw Error('Cloudflare Pages STAGING is outdated: published '+manifest.commit_sha+
   ' but GitHub staging is '+expected);
 const payload={};
 for(const [file,expected] of MUST_HAVE){
  if(!payload[file]){
   const r=await checkedFetch(SITE+'/'+file,{redirect:'manual',cache:'no-store',
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
 const health=await checkedFetch(WORKER+'/health',{redirect:'manual',
  signal:AbortSignal.timeout(12000)});
 assert.equal(health.status,200);
 const status=await health.json();
 assert.equal(status.service,'shoot-sunday-sync-staging');
 assert.equal(status.write_mode,'test-only');
 const preflight=await checkedFetch(WORKER+'/events',{method:'OPTIONS',redirect:'manual',
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
  if(attempt===15||e.permanent_redirect)throw e;
  console.log('Pages/Worker release not yet ready (attempt '+attempt+'/15): '+e.message);
  await pause(8000);
 }
}
