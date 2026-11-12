/** TEST-only batch alias plan. Only a fully verified batch may teach names. */
import {aliasIntentsForCommittedGoal} from './sposched-goal-commit-alias.mjs';
const clean=x=>typeof x==='string'?x.trim():'';
const norm=x=>clean(x).normalize('NFKC').toLocaleLowerCase('ja-JP');
export function aliasesAfterVerifiedBatch({verified=false,rows=[],snapshot}={}){
 if(verified!==true||!Array.isArray(rows)||!snapshot)return [];
 const proposals=[];
 for(const row of rows){
  if(!row?.include||row.guest||row.goal?.manual)continue;
  proposals.push(...aliasIntentsForCommittedGoal({row,snapshot,goalVerified:true}));
 }
 // A spoken name associated with two different official members is ambiguous.
 // Never teach either mapping automatically, regardless of goal count.
 const targets=new Map();
 for(const p of proposals){
  const key=norm(p.alias);
  if(!targets.has(key))targets.set(key,new Set());
  targets.get(key).add(p.member_id.toLowerCase());
 }
 const seen=new Set();
 return proposals.filter(p=>{
  const key=norm(p.alias);
  if(targets.get(key).size!==1)return false;
  const pair=key+'|'+p.member_id.toLowerCase();
  if(seen.has(pair))return false;
  seen.add(pair);
  return true;
 });
}
