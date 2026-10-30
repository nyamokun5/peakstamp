import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildStagingReviewHtml,buildStagingSite} from '../scripts/build-staging-site.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const productionHost='https://shoot-sunday-sync.yomax1979.workers.dev';
const stagingHost='https://shoot-sunday-sync-staging.yomax1979.workers.dev';

test('TEST site has one disabled STAGING-only environment with no production API endpoint or write adapter',async()=>{
 const original=await readFile(path.join(root,'sposched-review.html'),'utf8');
 const built=buildStagingReviewHtml(original);
 assert.match(built,/id="stagingBuildBanner"/);
 assert.match(built,/<select id="ssEnvironment"[^>]+disabled>/);
 assert.match(built,/<option value="staging" selected>テストSS<\/option>/);
 assert.doesNotMatch(built,/<option value="production"/);
 assert.ok(built.includes(stagingHost));
 assert.ok(!built.includes(productionHost));
 assert.ok(!built.includes("from './sposched-production-ui.mjs"));
 assert.match(built,/from '\.\/staging-production-disabled\.mjs'/);
 assert.doesNotMatch(built,/production:'https:\/\//);
});

test('TEST build fails closed if the pinned gateway or markup changes',async()=>{
 const original=await readFile(path.join(root,'sposched-review.html'),'utf8');
 assert.throws(()=>buildStagingReviewHtml(original.replace(productionHost,'https://different.example.invalid')),
  /Unsafe TEST build/);
 assert.throws(()=>buildStagingReviewHtml(original.replace('<option value="production">','<option value="changed">')),
  /Unsafe TEST build/);
});

test('TEST deployment produces static assets but excludes production-only writing modules',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'peakstamp-test-site-'));
 try{
  await buildStagingSite(dir);
  const names=await readdir(dir);
  for(const name of ['index.html','sposched-review.html','staging-production-disabled.mjs','app.mjs','_headers'])
   assert.ok(names.includes(name),name+' missing');
  assert.ok(!names.includes('sposched-production-ui.mjs'));
  assert.ok(!names.includes('sposched-production-release.mjs'));
  const disabled=await readFile(path.join(dir,'staging-production-disabled.mjs'),'utf8');
  assert.ok(!disabled.includes(productionHost));
  const page=await readFile(path.join(dir,'sposched-review.html'),'utf8');
  assert.ok(!page.includes(productionHost));
 }finally{await rm(dir,{recursive:true,force:true});}
});
