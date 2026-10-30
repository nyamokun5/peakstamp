// Build an isolated PeakStamp TEST website; never publish a production SS writer here.
// The source HTML remains unchanged so existing browser/unit regression tests can
// run against the same application source that was tested in production.
import {readFile,readdir,mkdir,writeFile,rm,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const prodHost='https://shoot-sunday-sync.yomax1979.workers.dev';
const stagingHost='https://shoot-sunday-sync-staging.yomax1979.workers.dev';
const requireOnce=(source,before,after,label)=>{
 const found=source.split(before).length-1;
 if(found!==1)throw Error('Unsafe TEST build: expected exactly one '+label+', got '+found);
 return source.replace(before,after);
};
export function buildStagingReviewHtml(html){
 let out=html;
 out=requireOnce(out,'<body><main>',
  '<body><main><div id="stagingBuildBanner" role="status" style="background:#174d43;color:#fff;padding:12px;border:2px solid #55c5a0;border-radius:10px;font-weight:700;margin-bottom:14px">🧪 PeakStamp TEST — テスト用SSだけに接続します。本番SSには送信できません。</div>',
  'TEST banner placement');
 out=requireOnce(out,'id="ssModeBadge" class="step">本番SS','id="ssModeBadge" class="step">テストSS','TEST header');
 out=requireOnce(out,'<select id="ssEnvironment" aria-label="SpoSched接続先">',
  '<select id="ssEnvironment" aria-label="SpoSched接続先" disabled>', 'environment control');
 out=requireOnce(out,'     <option value="production">本番SS</option>\n','', 'production dropdown option');
 out=requireOnce(out,'<option value="staging">テストSS</option>',
  '<option value="staging" selected>テストSS</option>','staging dropdown option');
 out=requireOnce(out,"production:'"+prodHost+"',\n  ",'','production gateway');
 out=requireOnce(out,"import {installProductionUI} from './sposched-production-ui.mjs?v=production-ui1';",
  "import {installProductionUI} from './staging-production-disabled.mjs';",'production UI module');
 out=requireOnce(out,'<p id="ssEnvironmentNote" class="small">ターゲットに設定されたイベントだけ登録できます。</p>',
  '<p id="ssEnvironmentNote" class="small">STAGING専用。SSのテスト団体にのみ接続します。</p>',
  'environment note');
 if(out.includes(prodHost) || out.includes("from './sposched-production-ui.mjs"))
  throw Error('Unsafe TEST build: production connection remains reachable');
 if(!out.includes("staging:'"+stagingHost+"'"))
  throw Error('Unsafe TEST build: STAGING endpoint missing');
 return out;
}
export async function buildStagingSite(destination=path.join(root,'dist')){
 // The deployment output is recreated from scratch to avoid shipping stale files.
 await rm(destination,{recursive:true,force:true});
 await mkdir(destination,{recursive:true});
 const files=await readdir(root,{withFileTypes:true});
 for(const entry of files){
  if(!entry.isFile()||!/(?:\.mjs|\.html|\.css)$/.test(entry.name))continue;
  // TEST output does not include the production-only request adapter or policy.
  if(['sposched-production-ui.mjs','sposched-production-release.mjs'].includes(entry.name))continue;
  const source=path.join(root,entry.name);
  const target=path.join(destination,entry.name);
  if(entry.name==='sposched-review.html'){
   await writeFile(target,buildStagingReviewHtml(await readFile(source,'utf8')));
  }else await copyFile(source,target);
 }
 await writeFile(path.join(destination,'staging-production-disabled.mjs'),
  "// TEST-only replacement: it has no production URL, API calls or write handler.\n"+
  "export function installProductionUI(){return {render(){const p=document.getElementById('productionPanel');if(p)p.hidden=true;},refresh(){}};}\n");
 await writeFile(path.join(destination,'_headers'),
  '/*\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n');
 const built=await readFile(path.join(destination,'sposched-review.html'),'utf8');
 if(built.includes(prodHost))throw Error('Unsafe TEST build: production URL leaked');
 return destination;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 await buildStagingSite();
 console.log('STAGING TEST site assembled in dist/; production SS endpoint excluded.');
}
