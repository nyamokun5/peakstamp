import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioBinCollector } from '../audio-features.mjs';
import { detectHighlights } from '../detector.mjs';

const events=[
  { at:24, length:3, type:'cheer', amplitude:.37 },
  { at:43, length:.25, type:'impact', amplitude:.9 },
  { at:65, length:3, type:'speech', amplitude:.4 },
  { at:87, length:3, type:'machine', amplitude:.36 },
  { at:130, length:3, type:'cheer', amplitude:.32 },
];
function exampleBins(length=160, spec=events) {
  return Array.from({length:length*4},(_,i)=>{
    const time=i*.25;
    let rms=.012,lowRatio=.2,highRatio=.09,crest=2;
    for(const e of spec){
      const offset=time-e.at;
      if(offset<0 || offset>=e.length)continue;
      if(e.type==='cheer'){
        rms=e.amplitude*(.85+.15*Math.sin(time*5)**2);
      }else if(e.type==='impact'){
        rms=e.amplitude;lowRatio=.03;highRatio=.75;crest=8;
      }else if(e.type==='speech'){
        rms=e.amplitude*(Math.floor(offset/.5)%2===0?1:.06);
        lowRatio=.63;highRatio=.05;
      }else if(e.type==='machine'){
        rms=e.amplitude;lowRatio=.90;highRatio=.001;
      }
    }
    return {time,rms,lowRatio,highRatio,crest};
  });
}
const near=(events,time)=>events.some(x=>Math.abs(x.peakSeconds-time)<=3);
test('no-AI detector retains sustained cheers while rejecting impact, speech and rumble',()=>{
  const found=detectHighlights(exampleBins(),{sensitivity:'normal',maxResults:15,minGapSeconds:12});
  assert.ok(near(found,25),JSON.stringify(found));
  assert.ok(near(found,132),JSON.stringify(found));
  assert.equal(near(found,43),false,'single hammer-like impulse should be rejected');
  assert.equal(near(found,66),false,'separated close foreground talk should be rejected');
  assert.equal(near(found,88),false,'low-frequency mechanical rumble should be rejected');
});
test('sensitive scan retains candidates excluded as likely noise for recall',()=>{
  const sensitive=detectHighlights(exampleBins(),{sensitivity:'sensitive',maxResults:15,minGapSeconds:12});
  const normal=detectHighlights(exampleBins(),{sensitivity:'normal',maxResults:15,minGapSeconds:12});
  assert.ok(sensitive.length>normal.length);
  assert.ok(near(sensitive,25)&&near(sensitive,132));
});
test('short synthetic impacts without frequency descriptors are also ignored',()=>{
  const bins=exampleBins(90,[{at:30,length:.25,type:'impact',amplitude:1}])
    .map(({time,rms})=>({time,rms}));
  assert.equal(detectHighlights(bins,{sensitivity:'normal'}).length,0);
});
test('older RMS-only audio bins still detect sustained events',()=>{
  const bins=exampleBins(160,[{at:24,length:3,type:'cheer',amplitude:.26},
    {at:110,length:3,type:'cheer',amplitude:.23}]).map(({time,rms})=>({time,rms}));
  assert.ok(near(detectHighlights(bins,{sensitivity:'normal'}),25));
  assert.ok(near(detectHighlights(bins,{sensitivity:'normal'}),111));
});
test('silence and uniform construction ambience do not generate candidates',()=>{
  const bins=Array.from({length:360},(_,i)=>({time:i*.25,rms:.09,lowRatio:.9,crest:1.6}));
  assert.equal(detectHighlights(bins).length,0);
});
test('acoustic collector keeps original RMS and adds finite spectral descriptors',()=>{
  const acc=createAudioBinCollector(.25);
  const rate=48000;
  for(let i=0;i<rate/2;i+=4){
    const t=i/rate,sample=.4*Math.sin(2*Math.PI*440*t);
    acc.push(t,sample*sample,sample,rate,4);
  }
  const bins=acc.finish(.5);
  assert.equal(bins.length,2);
  assert.ok(bins.every(x=>x.rms>.2 && x.rms<.4));
  assert.ok(bins.every(x=>x.lowRatio>=0 && x.lowRatio<=1));
  assert.ok(bins.every(x=>x.highRatio>=0 && x.highRatio<=1));
  assert.ok(bins.every(x=>x.crest>1 && x.crest<3));
});
test('low-frequency engine-like signal has higher low-band share than treble',()=>{
  const calc=(hz)=>{
    const acc=createAudioBinCollector(.25),rate=48000;
    for(let i=0;i<rate;i+=4){
      const t=i/rate,v=.22*Math.sin(2*Math.PI*hz*t);
      acc.push(t,v*v,v,rate,4);
    }
    return acc.finish(1).slice(1).reduce((a,b)=>a+b.lowRatio,0)/3;
  };
  assert.ok(calc(90)>calc(1800),'low pass should discriminate broad frequency differences');
});
test('collector tolerates empty audio and zero durations',()=>{
  const acc=createAudioBinCollector(.25);
  assert.deepEqual(acc.finish(0),[]);
  assert.equal(acc.finish(1).length,4);
});
