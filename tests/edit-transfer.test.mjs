import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditTransfer } from '../edit-transfer.mjs';

test('exports resolved times and identifies original files, not ephemeral IDs', () => {
  const sources=[{id:'video-99',file:{name:'IMG_001.mov',size:123456,lastModified:321},duration:120,candidates:[{time:15,enabled:true,title:'ゴール'}]}];
  const output=createEditTransfer(sources,[{sourceId:'video-99',start:12.4,end:22.3,zoom:1.5,zoomX:.4}], '2026-10-20T00:00:00.000Z');
  assert.equal(output.kind,'peakstamp-edit-transfer');
  assert.equal(output.version,1);
  assert.deepEqual(output.sources,[{key:'src-0',name:'IMG_001.mov',size:123456,duration:120,lastModified:321}]);
  assert.deepEqual(output.clips,[{sourceKey:'src-0',start:12.4,end:22.3,zoom:1.5,zoomX:.4,zoomY:.5,title:'ゴール'}]);
  assert.ok(!JSON.stringify(output).includes('video-99'));
});

test('rejects unknown media or invalid bounds', () => {
  const source={id:'a',file:{name:'a.mp4',size:200,lastModified:0},duration:10,candidates:[]};
  assert.throws(()=>createEditTransfer([source],[{sourceId:'missing',start:0,end:5}]));
  assert.throws(()=>createEditTransfer([source],[{sourceId:'a',start:9,end:11}]));
  assert.throws(()=>createEditTransfer([source],[{sourceId:'a',start:3,end:3.2}]));
});
