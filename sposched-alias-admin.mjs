/**
 * Alias administration is intentionally separated from score registration.
 * Only operate on an explicit official alias ID and stable member identity.
 * A generic 2xx response is never proof of a successful correction.
 */
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const txt=x=>typeof x==='string'?x.trim():'';
const norm=x=>txt(x).normalize('NFKC').toLocaleLowerCase('ja-JP');

export function normalizeAliasList(payload) {
 const source=Array.isArray(payload)?payload:
  Array.isArray(payload?.aliases)?payload.aliases:null;
 if(!source)throw Error('SS公式の名寄せ一覧を取得できません');
 return source.map(entry=>{
  const alias=txt(entry?.alias),member_id=txt(entry?.member_id||entry?.user_id);
  const id=txt(entry?.id||entry?.alias_id);
  if(!alias||!uuid.test(member_id))
   throw Error('名寄せデータに正式メンバーIDがありません');
  return {id,alias,member_id,name:txt(entry.name||entry.person),
   source:txt(entry.source)};
 });
}

export function aliasListView(entries,query='') {
 const q=norm(query);
 const counts=new Map();
 for(const e of entries){
  const key=norm(e.alias);
  const members=counts.get(key)||new Set();
  members.add(e.member_id);counts.set(key,members);
 }
 return entries.filter(e=>!q||norm(e.alias).includes(q)||norm(e.name).includes(q))
  .map(e=>({...e,shared:counts.get(norm(e.alias)).size>1}));
}

/**
 * Read-only by default. Caller must inject a specifically authorized API
 * adapter and official GET readback; no browser-side arbitrary endpoint.
 */
export async function correctAlias({original,replacementMemberId,write,read}={}) {
 if(!original?.id||!uuid.test(original.member_id||'')||
    !uuid.test(replacementMemberId||'')||
    original.member_id===replacementMemberId)
  return {saved:false,reason:'変更先の正式メンバーを指定してください'};
 if(typeof write!=='function'||typeof read!=='function')
  return {saved:false,reason:'SSの名寄せ修正APIが未接続です'};
 try{
  await write({alias_id:original.id,expected_member_id:original.member_id,
   member_id:replacementMemberId});
  const entries=normalizeAliasList(await read());
  const matches=entries.filter(e=>e.id===original.id);
  if(matches.length!==1||matches[0].member_id!==replacementMemberId)
   return {saved:false,uncertain:true,reason:'修正結果を公式一覧で確認できません'};
  return {saved:true,entry:matches[0]};
 }catch{
  return {saved:false,uncertain:true,reason:'結果が不明です。再送せず公式一覧を確認してください'};
 }
}

export async function removeAlias({original,remove,read}={}) {
 if(!original?.id||!uuid.test(original.member_id||''))
  return {saved:false,reason:'削除対象の正式IDがありません'};
 if(typeof remove!=='function'||typeof read!=='function')
  return {saved:false,reason:'SSの名寄せ削除APIが未接続です'};
 try{
  await remove({alias_id:original.id,expected_member_id:original.member_id});
  const entries=normalizeAliasList(await read());
  if(entries.some(e=>e.id===original.id))
   return {saved:false,uncertain:true,reason:'削除結果を公式一覧で確認できません'};
  return {saved:true};
 }catch{
  return {saved:false,uncertain:true,reason:'結果が不明です。再送せず公式一覧を確認してください'};
 }
}
