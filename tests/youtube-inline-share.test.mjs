import test from 'node:test';import assert from 'node:assert/strict';
import {inlineShareUrl,inlineShareClips} from '../youtube-inline-share.mjs';
const clips=Array.from({length:7},(_,i)=>({video:'-sEOeqqTyuw',match:'第'+(i+1)+'試合',start:10.3+i*10,end:16.3+i*10,label:'ハイライト ⚽',scorer:'',assist:''}));
test('self-contained link preserves UTF-8 labels, order and exact fractional times without server ID',()=>{const u=new URL(inlineShareUrl(clips,'https://example.com/peakstamp/'));assert.equal(u.search,'');assert.equal(u.pathname,'/peakstamp/youtube-watch.html');assert.deepEqual(inlineShareClips(u.hash),clips)});
test('legacy server links are left to existing loader; malformed or oversized inline links fail closed',()=>{assert.equal(inlineShareClips(''),null);for(const h of ['#clips=wrong','#clips=',' #clips='+ 'a'.repeat(12001)])assert.throws(()=>inlineShareClips(h.trim()));assert.throws(()=>inlineShareUrl([{...clips[0],video:'bad'}],'https://example.com/'))});
