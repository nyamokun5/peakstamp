import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');

test('YouTube timestamp export section is hidden but preserved for future reactivation',()=>{
  assert.match(html, /<div class="comment-section" hidden aria-hidden="true">/);
  assert.match(css,/\.comment-section\s*,[\s\S]*?display:\s*none\s*!important/);
  assert.match(html,/id="commentText"/);
  assert.match(html,/id="copyButton"/);
});

test('per-source YouTube copy button is not shown',()=>{
  assert.match(app,/copy\.hidden\s*=\s*true/);
  assert.match(css,/\.source-copy\s*\{\s*display:\s*none\s*!important/);
});

test('play-content selector is not visible in any candidate card',()=>{
  assert.match(app,/titleGroup\.hidden\s*=\s*true/);
  assert.match(css,/\.play-label-group\s*,[\s\S]*?display:\s*none\s*!important/);
  assert.match(app,/titleGroup\.append\(titleLabel,titleSelect,title\)/);
});

test('kept scene summary no longer exposes play name',()=>{
  assert.match(app,/formatTime\(item\.time\)\)\);/);
  assert.doesNotMatch(app,/formatTime\(item\.time\)\s*\+\s*' '\s*\+\s*\(item\.title/);
});

test('source start and end editors and Keep/Reject controls remain enabled',()=>{
  assert.match(app,/const rangeEditor=make\('div','range-editor'\)/);
  assert.match(app,/startBox\.append\(time\)/);
  assert.match(app,/endBox\.append\(endInput,resetEnd\)/);
  assert.match(app,/actions\.append\(play,keep,reject\)/);
});

test('obsolete YouTube messaging is absent from visible introduction and storage help',()=>{
  assert.doesNotMatch(html,/<meta name="description" content="[^"]*YouTube/);
  const hero=html.split('<section class="hero">')[1].split('</section>')[0];
  assert.doesNotMatch(hero,/YouTube/);
  const storage=html.split('<details class="storage-tips">')[1].split('</details>')[0];
  assert.doesNotMatch(storage,/YouTube/);
});
