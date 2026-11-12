/** Restrict post-commit nickname learning to the exact video goals sent to SS. */
export function submittedAliasRows(rows,submitted){
 if(!Array.isArray(rows)||!Array.isArray(submitted)||!submitted.length)return [];
 const ids=new Set(submitted.filter(x=>typeof x==='string'&&x.length>0));
 return rows.filter(row=>{
  if(!row||!row.include||row.guest||row.goal?.manual)return false;
  const source=row.goal?.source?.name,id=row.goal?.id;
  return typeof source==='string'&&source.length>0&&id!=null&&
   ids.has(source+'::'+id);
 });
}
