import test from 'node:test';
import assert from 'node:assert/strict';
import {updateGeminiScreenNotice} from '../gemini-screen-notice.mjs';

function fixture(){
 const classes=new Set();
 return {panel:{hidden:false},warning:{hidden:true,classList:{toggle:(x,on)=>on?classes.add(x):classes.delete(x)}},title:{textContent:''},description:{textContent:''},classes};
}
test('no video hides the Gemini input panel and its warning',()=>{
 const parts=fixture();
 updateGeminiScreenNotice({...parts,hasSource:false,processing:false});
 assert.equal(parts.panel.hidden,true);
 assert.equal(parts.warning.hidden,true);
});
test('video selected exposes the Safari warning before requesting Google audio API',()=>{
 const parts=fixture();
 updateGeminiScreenNotice({...parts,hasSource:true,processing:false});
 assert.equal(parts.panel.hidden,false);
 assert.equal(parts.warning.hidden,false);
 assert.match(parts.title.textContent,/この画面を開いたまま/);
 assert.match(parts.description.textContent,/LINE/);
 assert.equal(parts.classes.has('is-processing'),false);
});
test('running analysis prominently warns without disrupting other state',()=>{
 const parts=fixture();
 updateGeminiScreenNotice({...parts,hasSource:true,processing:true});
 assert.match(parts.title.textContent,/解析中/);
 assert.match(parts.description.textContent,/画面ロック/);
 assert.equal(parts.classes.has('is-processing'),true);
 updateGeminiScreenNotice({...parts,hasSource:true,processing:false});
 assert.equal(parts.classes.has('is-processing'),false);
});
