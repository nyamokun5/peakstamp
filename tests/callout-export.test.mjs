import test from 'node:test';
import assert from 'node:assert/strict';
import {calloutExportText,calloutExportFilename,shareCalloutJson,copyCalloutJson} from '../callout-export.mjs';

const state={
 utterances:[{kind:'goal_call',quote:'山田さんゴール',time_seconds:12.5,scorer:'山田さん'}],
 scope:'first',ratings:{0:'correct'},missed:'',createdAt:'2026-10-21T00:00:00.000Z'
};
const source={file:{name:'IMG_3330.MOV',size:123456,lastModified:12}};
class FakeFile{
 constructor(chunks,name,options){this.chunks=chunks;this.name=name;this.type=options.type;}
}
test('export serializes source, utterances, judgment and missed note without media bytes',()=>{
 const out=JSON.parse(calloutExportText(state,source,'14:00 追加のゴール音声'));
 assert.equal(out.source.name,'IMG_3330.MOV');
 assert.equal(out.utterances[0].scorer,'山田さん');
 assert.equal(out.ratings[0],'correct');
 assert.equal(out.missed,'14:00 追加のゴール音声');
 assert.equal(out.source.size,123456);
 assert.equal(out.video,undefined);
 assert.equal(calloutExportFilename(new Date('2026-10-21T09:00:00Z')),'PeakStamp_Callout_Test_2026-10-21.json');
});
test('native iOS-style share carries a real .json File object',async()=>{
 let received;
 const nav={canShare:({files})=>files[0].type==='application/json',share:async v=>{received=v}};
 const outcome=await shareCalloutJson('{"ok":true}','PeakStamp_Callout_Test.json',{nav,FileType:FakeFile});
 assert.equal(outcome,'completed');
 assert.equal(received.files[0].name,'PeakStamp_Callout_Test.json');
 assert.equal(received.files[0].chunks[0],'{"ok":true}');
});
test('cancelled share is not misreported as saved, and unsupported sharing is harmless',async()=>{
 const aborted={name:'AbortError'};
 assert.equal(await shareCalloutJson('x','x.json',{nav:{canShare:()=>true,share:async()=>{throw aborted}},FileType:FakeFile}),'cancelled');
 assert.equal(await shareCalloutJson('x','x.json',{nav:{canShare:()=>false,share:()=>{}},FileType:FakeFile}),'unsupported');
 assert.equal(await shareCalloutJson('x','x.json',{nav:{},FileType:FakeFile}),'unsupported');
});
test('copy prefers the clipboard and can fall back to a selected textarea',async()=>{
 const messages=[];
 assert.equal(await copyCalloutJson('payload',{nav:{clipboard:{writeText:async t=>messages.push(t)}}}),true);
 assert.deepEqual(messages,['payload']);
 const textarea={value:'',focus(){},select(){this.selected=true},setSelectionRange(a,b){this.start=a;this.end=b}};
 assert.equal(await copyCalloutJson('fallback',{nav:{clipboard:{writeText:async()=>{throw Error('denied')}}},
  documentObj:{execCommand:cmd=>cmd==='copy'},textarea}),true);
 assert.equal(textarea.value,'fallback');
 assert.equal(textarea.selected,true);
 assert.equal(textarea.end,8);
 assert.equal(await copyCalloutJson('x',{nav:{},documentObj:{},textarea}),false);
});
test('empty source or result cannot create fictitious export',()=>{
 assert.throws(()=>calloutExportText(null,source,''),/解析結果/);
 assert.throws(()=>calloutExportText(state,null,''),/解析結果/);
});
