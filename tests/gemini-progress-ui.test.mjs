import test from 'node:test';
import assert from 'node:assert/strict';
import {geminiProgressValue,createGeminiProgressUI} from '../gemini-progress-ui.mjs';

test('progress is chunk-based, reserves completion for review preparation',()=>{
 assert.equal(geminiProgressValue({done:3,total:9}),30);
 assert.equal(geminiProgressValue({done:9,total:9}),90);
 assert.equal(geminiProgressValue({phase:'waveform',waveform:0}),90);
 assert.equal(geminiProgressValue({phase:'waveform',waveform:60}),95);
 assert.equal(geminiProgressValue({phase:'complete'}),100);
 assert.equal(geminiProgressValue({done:9,total:0}),0);
});
test('ARIA progress is monotonic, failed status does not claim completion',()=>{
 const classes=new Set();
 const root={hidden:true,attrs:{},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},setAttribute(k,v){this.attrs[k]=v}};
 const label={textContent:''},percent={textContent:''},bar={style:{width:''}},detail={textContent:''};
 const ui=createGeminiProgressUI({root,label,percent,bar,detail});
 ui.start();ui.segments(2,8,1);
 assert.equal(percent.textContent,'23%');
 ui.segments(1,8,1);
 assert.equal(percent.textContent,'23%');
 ui.fail();
 assert.equal(percent.textContent,'23%');
 assert.equal(root.attrs['aria-valuenow'],'23');
 assert.equal(classes.has('progress-error'),true);
 ui.start();ui.segments(8,8);ui.waveform(100);ui.finalizing();ui.complete();
 assert.equal(percent.textContent,'100%');
 assert.equal(bar.style.width,'100%');
 assert.equal(root.hidden,false);
});
