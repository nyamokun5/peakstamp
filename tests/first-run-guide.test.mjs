import test from 'node:test';
import assert from 'node:assert/strict';
import {initFirstRunGuide} from '../first-run-guide.mjs';

function setup(){
 const nodes={};
 function button(){return {hidden:false,dataset:{},events:{},classList:{toggle(){}},
   setAttribute(){},addEventListener(type,fn){this.events[type]=fn},
   click(){this.events.click?.()},focus(){globalThis.document.activeElement=this}}}
 for(const id of ['openGuide','guideNext','guideSkip','guideTitle','guideDescription','guideCounter'])
  nodes[id]=button();
 const steps=Array.from({length:3},(_,i)=>Object.assign(button(),{dataset:{guideStep:String(i)}}));
 const links=Array.from({length:3},(_,i)=>Object.assign(button(),{dataset:{journeyStep:String(i)}}));
 nodes.firstRunOverlay=Object.assign(button(),{hidden:true,querySelectorAll:()=>steps});
 nodes.journeyNav=Object.assign(button(),{querySelectorAll:()=>links});
 for(const id of ['choosePanel','geminiPrimaryPanel','resultsPanel'])
  nodes[id]=Object.assign(button(),{scrollIntoView(){this.scrolled=true}});
 globalThis.document={activeElement:nodes.openGuide,getElementById:id=>nodes[id]};
 const saved=new Map([['gemini-results','never-touch']]);
 const storage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)};
 return {nodes,storage,saved};
}
test('new visitors are guided once and can reopen voluntarily',()=>{
 const {nodes,storage,saved}=setup();
 const guide=initFirstRunGuide({storage});
 assert.equal(nodes.firstRunOverlay.hidden,false);
 assert.equal(nodes.guideTitle.textContent,'動画を選ぶ');
 nodes.guideNext.click();nodes.guideNext.click();
 assert.match(nodes.guideTitle.textContent,/キープ/);
 nodes.guideNext.click();
 assert.equal(nodes.firstRunOverlay.hidden,true);
 assert.equal(nodes.choosePanel.scrolled,true);
 assert.equal(saved.get('gemini-results'),'never-touch');
 nodes.openGuide.click();
 assert.equal(nodes.firstRunOverlay.hidden,false);
 nodes.guideSkip.click();
 assert.equal(nodes.firstRunOverlay.hidden,true);
 guide.update({hasVideo:true});
});
test('existing Gemini users are not interrupted',()=>{
 const {nodes,storage}=setup();
 initFirstRunGuide({storage,hasPriorAnalysis:()=>true});
 assert.equal(nodes.firstRunOverlay.hidden,true);
});
