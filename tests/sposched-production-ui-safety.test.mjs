import test from 'node:test';
import assert from 'node:assert/strict';
import {installProductionUI} from '../sposched-production-ui.mjs';

const E='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const T='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const ids=[1,2,3,4].map(n=>'11111111-2222-4111-8111-11111111111'+n);
const snapshot={eventId:E,matches:ids.map((matchId,i)=>({seq:i+1,matchId,
 status:i<2?'scheduled':'waiting'})),playerTeam:new Map(),players:[]};

function createUI(){
 const elements=new Map();
 const get=id=>{
  if(!elements.has(id)){
   const events={};
   elements.set(id,{id,hidden:false,disabled:false,checked:false,value:'',
    textContent:'',options:[],events,
    addEventListener(name,callback){events[name]=callback;}
   });
  }
  return elements.get(id);
 };
 const globals={document:globalThis.document,localStorage:globalThis.localStorage};
 const storage=new Map();
 globalThis.document={getElementById:get};
 globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(k,v)=>storage.set(k,v)};
 const events=[];
 const read=async path=>{
  events.push(path);
  if(path.startsWith('/production/release-state'))return {
   environment:'PRODUCTION',event_id:E,release_ready:false};
  if(path.startsWith('/production/inspect'))return {
   environment:'PRODUCTION',mode:'read-only',team_pinned:true,
   write_allowed:false,release_approved:false,event_id:E,team_id:T,
   matches:ids.map((match_id,i)=>({seq:i+1,match_id,
    status:i<2?'scheduled':'waiting'}))};
  if(path.startsWith('/snapshot'))return {event_id:E,matches:[]};
  throw Error('unexpected read '+path);
 };
 const ui=installProductionUI({current:()=>({active:true,snapshot,rows:[],decisions:[]}),
  read,normalize:x=>x,onComplete:()=>{throw Error('must not complete');}});
 return {get,ui,events,restore:()=>{globalThis.document=globals.document;
  globalThis.localStorage=globals.localStorage;}};
}

test('production panel cannot enable a send with disabled server release',async()=>{
 const x=createUI();
 try{
  x.ui.render();
  assert.equal(x.get('productionPanel').hidden,false);
  assert.equal(x.get('productionStart').disabled,true);
  await x.get('productionCheck').events.click();
  assert.equal(x.get('productionStart').disabled,true);
  assert.match(x.get('productionPlan').textContent,/確認未完了/);
  assert.equal(x.events.length,3);
  assert.ok(x.events.every(q=>q.startsWith('/production/')||q.startsWith('/snapshot')));
 }finally{x.restore();}
});
