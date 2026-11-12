import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAliasList,aliasListView,correctAlias,removeAlias} from './sposched-alias-admin.mjs';
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const entries=[{id:'alias1',alias:'たいせい',member_id:a,name:'選手A'},
 {id:'alias2',alias:'たいせい',member_id:b,name:'選手B'}];
test('same nickname for distinct members is shared, not deduplicated',()=>{
 const list=aliasListView(normalizeAliasList(entries),'たいせい');
 assert.equal(list.length,2);assert.equal(list.every(x=>x.shared),true);
});
test('editing requires official write adapter and readback',async()=>{
 const original=entries[0];
 assert.equal((await correctAlias({original,replacementMemberId:b})).saved,false);
 let writes=0;
 const failed=await correctAlias({original,replacementMemberId:b,
  write:async()=>{writes++},read:async()=>entries});
 assert.equal(writes,1);assert.equal(failed.saved,false);
 assert.equal(failed.uncertain,true);
 const passed=await correctAlias({original,replacementMemberId:b,
  write:async()=>{},read:async()=>[{...original,member_id:b},entries[1]]});
 assert.equal(passed.saved,true);
});
test('delete is confirmed only when alias id disappears from GET',async()=>{
 const original=entries[0];
 const uncertain=await removeAlias({original,remove:async()=>{},read:async()=>entries});
 assert.equal(uncertain.saved,false);
 const verified=await removeAlias({original,remove:async()=>{},read:async()=>[entries[1]]});
 assert.equal(verified.saved,true);
});
test('network failure does not retry',async()=>{
 let calls=0;
 const result=await removeAlias({original:entries[0],remove:async()=>{calls++;throw Error('timeout')},
  read:async()=>entries});
 assert.equal(calls,1);assert.equal(result.uncertain,true);
});

test('read-only listing works without a mutation-specific alias ID',()=>{
 const list=normalizeAliasList([{alias:'タケ',user_id:a,name:'選手A'}]);
 assert.equal(list.length,1);
 assert.equal(list[0].id,'');
 assert.equal(aliasListView(list,'たけ').length,1);
});

test('official SS aliases response with nested member person is readable',()=>{
 const list=normalizeAliasList({aliases:[{alias_id:'33333333-3333-4333-8333-333333333333',alias:'ハマさん',person:{type:'member',member_id:a,name:'濱直'}}]});
 assert.deepEqual(list,[{id:'33333333-3333-4333-8333-333333333333',alias:'ハマさん',member_id:a,name:'濱直',source:''}]);
});
test('official child identity is not silently mistaken for member',()=>{
 assert.throws(()=>normalizeAliasList({aliases:[{alias:'子供',person:{type:'child',child_id:b,name:'子供A'}}]}),/正式メンバーID/);
});
