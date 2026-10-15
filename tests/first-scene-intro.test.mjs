import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareIntroPlan,introOverlayOpacity,FIRST_SCENE_LEAD_SECONDS } from '../intro-layout.mjs';
import { montageSeconds } from '../exporter.mjs';
import { montageChapters } from '../multi-plan.mjs';

const plan=[
 {sourceId:'A',sourceName:'game.mov',start:15,end:25,zoom:1.7},
 {sourceId:'B',sourceName:'drone.mov',start:40,end:49}
];
const overlay={presentation:'overlay'};
const card={presentation:'card',mode:'video'};

test('first highlight starts three seconds before user-selected marker',()=>{
 const prepared=prepareIntroPlan(plan,overlay);
 assert.equal(FIRST_SCENE_LEAD_SECONDS,3);
 assert.equal(prepared.introSeconds,0);
 assert.equal(prepared.prerollSeconds,3);
 assert.equal(prepared.overlaySeconds,3);
 assert.deepEqual(prepared.clips,[{...plan[0],start:12},{...plan[1]}]);
 assert.deepEqual(plan[0],{sourceId:'A',sourceName:'game.mov',start:15,end:25,zoom:1.7});
});
test('no artificial five-second card; duration includes only earlier source footage',()=>{
 // 10+9+5-(0.5 video dissolve)=23.5 in legacy card mode.
 assert.equal(montageSeconds(plan,card),23.5);
 // 13+9-0.5=21.5 in overlay mode.
 assert.equal(montageSeconds(plan,overlay),21.5);
 assert.equal(montageSeconds(plan),23.5);
});
test('clip near the start is capped at zero without negative timestamps',()=>{
 const original=[{sourceId:'A',start:1.2,end:10}];
 const prepared=prepareIntroPlan(original,overlay);
 assert.equal(prepared.clips[0].start,0);
 assert.equal(prepared.prerollSeconds,1.2);
 assert.equal(prepared.overlaySeconds,3);
 assert.equal(montageSeconds(original,overlay),10);
 assert.equal(original[0].start,1.2);
});
test('clip already at zero overlays the first three seconds with no length change',()=>{
 const original=[{start:0,end:12}];
 const p=prepareIntroPlan(original,overlay);
 assert.equal(p.prerollSeconds,0);
 assert.equal(p.overlaySeconds,3);
 assert.equal(montageSeconds(original,overlay),12);
});
test('very short clip fades its title within available first clip',()=>{
 const p=prepareIntroPlan([{start:.4,end:1.2}],overlay);
 assert.equal(p.clips[0].start,0);
 assert.equal(p.overlaySeconds,1.2);
 assert.equal(introOverlayOpacity(.7,p.overlaySeconds)>0,true);
 assert.equal(introOverlayOpacity(1.2,p.overlaySeconds),0);
});
test('empty plans never create a standalone title clip',()=>{
 assert.deepEqual(prepareIntroPlan([],overlay),
  {clips:[],introSeconds:0,overlaySeconds:0,prerollSeconds:0});
 assert.equal(montageSeconds([],overlay),0);
 assert.equal(prepareIntroPlan([],card).introSeconds,0);
});
test('old image and video intros retain original five-second length and positions',()=>{
 const image=prepareIntroPlan(plan,{presentation:'card',mode:'image'});
 assert.equal(image.introSeconds,5);
 assert.equal(image.clips[0].start,15);
 assert.equal(image.overlaySeconds,0);
});
test('title starts transparent, fades in, holds, then disappears by three seconds',()=>{
 assert.equal(introOverlayOpacity(0),0);
 assert.ok(introOverlayOpacity(.15)>.45);
 assert.equal(introOverlayOpacity(.5),1);
 assert.equal(introOverlayOpacity(2.4),1);
 assert.ok(introOverlayOpacity(2.8)<.5);
 assert.equal(introOverlayOpacity(3),0);
 assert.equal(introOverlayOpacity(10),0);
});
test('video chapters reflect actual first-source media time, with no phantom intro',()=>{
 const c=montageChapters(plan,'GOALS!',30,overlay);
 assert.ok(c.startsWith('0:00 Highlight 1 — game.mov'),c);
 assert.ok(c.includes('0:12 Highlight 2 — drone.mov'),c);
 assert.ok(!c.includes('0:00 GOALS!'),c);
 const old=montageChapters(plan,'GOALS!',30,card);
 assert.ok(old.includes('0:00 GOALS!'),old);
 assert.ok(old.includes('0:05 Highlight 1 — game.mov'),old);
});
