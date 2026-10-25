import test from 'node:test';
import assert from 'node:assert/strict';
import {initSettingsNavigation} from '../settings-navigation.mjs';

function fixture(){
 const callbacks=new Map();
 function element({href='',hidden=false}={}){
  const listeners=new Map();
  return {
   hidden,href,src:'',title:'',textContent:'',focusCount:0,
   addEventListener(name,fn){listeners.set(name,fn)},
   dispatch(name,props={}){return listeners.get(name)?.(props)},
   getAttribute(name){return name==='href'?href:null},
   removeAttribute(name){if(name==='src')this.src=''},
   focus(){this.focusCount++}
  };
 }
 const reset=element({href:'./reset-goals.html?v=reset59&returnTab=1'});
 const roster=element({href:'./sposched-review.html?v=external65&returnTab=1'});
 const other=element({href:'https://google.com/'});
 const overlay=element({hidden:true}),frame=element(),close=element(),title=element();
 const doc={
  getElementById(id){return ({
   settingsOverlay:overlay,settingsOverlayFrame:frame,
   settingsOverlayClose:close,settingsOverlayTitle:title
  })[id]},
  querySelectorAll(){return [reset,roster,other]}
 };
 const video={file:{name:'IMG_0289.MOV',size:410181435},duration:366.697,
  objectUrl:'blob:original-video-file',clipStart:233,clipEnd:246,zoom:1.9};
 const state={sources:[video]};
 const location={href:'https://nyamokun5.github.io/peakstamp/',origin:'https://nyamokun5.github.io'};
 const win={
  location,
  history:{
   state:null,entries:[null],index:0,backs:0,
   pushState(state,_,url){
    assert.equal(url,location.href);
    this.index++;
    this.entries=this.entries.slice(0,this.index);
    this.entries.push(state);this.state=state;
   },
   back(){
    this.backs++;
    if(this.index===0)throw Error('BACK WOULD LEAVE EDITOR');
    this.index--;this.state=this.entries[this.index];
    (callbacks.get('popstate')||(()=>{}))({state:this.state});
   },
   forward(){
    if(this.index+1>=this.entries.length)return;
    this.index++;this.state=this.entries[this.index];
    (callbacks.get('popstate')||(()=>{}))({state:this.state});
   }
  },
  addEventListener(name,fn){callbacks.set(name,fn)},
  dispatch(name,event){callbacks.get(name)?.(event)}
 };
 let opened=[],closed=[];
 const navigation=initSettingsNavigation({
  document:doc,window:win,
  onOpen:name=>opened.push(name),onClose:name=>closed.push(name)
 });
 function click(node,extras={}){
  let prevented=false;
  node.dispatch('click',{
   button:0,metaKey:false,ctrlKey:false,altKey:false,shiftKey:false,
   preventDefault(){prevented=true},...extras
  });
  return prevented;
 }
 return {video,state,doc,win,navigation,overlay,frame,close,title,
  reset,roster,other,click,opened,closed};
}
test('settings open IN PLACE: media File, object URL, candidate edits and editor state remain identical',()=>{
 const f=fixture(),original=f.state.sources[0];
 assert.equal(f.click(f.reset),true);
 assert.equal(f.navigation.isOpen(),true);
 assert.equal(f.title.textContent,'ゴールデータ管理');
 assert.equal(f.overlay.hidden,false);
 assert.match(f.frame.src,/reset-goals\.html\?v=reset59/);
 assert.match(f.frame.src,/embedded=1/);
 assert.equal(f.win.history.index,1);
 assert.equal(f.state.sources[0],original);
 assert.equal(original.objectUrl,'blob:original-video-file');
 assert.equal(original.zoom,1.9);
 f.click(f.close);
 assert.equal(f.overlay.hidden,true);
 assert.equal(f.win.history.index,0);
 assert.equal(f.win.history.backs,1);
 assert.equal(f.state.sources[0],original);
 assert.equal(f.state.sources[0].clipStart,233);
 assert.equal(f.frame.src,'');
 assert.equal(f.reset.focusCount,1);
 assert.deepEqual(f.closed,['reset-goals.html']);
});
test('iPhone Safari browser Back closes settings rather than leaving video editor',()=>{
 const f=fixture(),original=f.state.sources[0];
 f.click(f.roster);
 assert.equal(f.win.history.index,1);
 f.win.history.back();
 assert.equal(f.navigation.isOpen(),false);
 assert.equal(f.state.sources[0],original);
 assert.equal(f.win.history.index,0);
 assert.deepEqual(f.closed,['sposched-review.html']);
 f.win.history.forward();
 assert.equal(f.navigation.isOpen(),true);
 assert.equal(f.state.sources[0],original);
});
test('Escape and backdrop clicks close in-place settings and preserve editor',()=>{
 const f=fixture();
 f.click(f.reset);
 f.win.dispatch('keydown',{key:'Escape',preventDefault(){}});
 assert.equal(f.navigation.isOpen(),false);
 f.click(f.reset);
 f.overlay.dispatch('click',{target:f.overlay});
 assert.equal(f.navigation.isOpen(),false);
 assert.equal(f.state.sources.length,1);
});
test('browser secondary-tab escape hatch is allowed for modified click, external URLs are ignored',()=>{
 const f=fixture();
 assert.equal(f.click(f.reset,{metaKey:true}),false);
 assert.equal(f.navigation.isOpen(),false);
 assert.equal(f.click(f.other),false);
 assert.equal(f.navigation.isOpen(),false);
 assert.equal(f.win.history.index,0);
});
test('setting viewer swaps between reset and match tools without replacing main document',()=>{
 const f=fixture(),original=f.state.sources[0];
 f.click(f.reset);
 const first=f.frame.src;
 f.click(f.roster);
 assert.notEqual(f.frame.src,first);
 assert.match(f.frame.src,/sposched-review\.html/);
 assert.equal(f.state.sources[0],original);
 assert.equal(f.navigation.activePage(),'sposched-review.html');
});
