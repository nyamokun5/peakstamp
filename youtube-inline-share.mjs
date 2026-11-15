const fields=['video','match','start','end','label','scorer','assist'];
function checked(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>1000)throw Error('共有する場面を確認してください。');
 return rows.map(row=>{
  if(!Array.isArray(row)||![7,8].includes(row.length))throw Error('共有リンクの形式が正しくありません。');
  const [video,match,start,end,label,scorer,assist]=row;
  if(typeof video!=='string'||!/^[-\w]{11}$/.test(video)||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end-start<.29||end>604800||![match,label,scorer,assist].every(x=>typeof x==='string'&&x.length<=512))throw Error('共有リンクの場面情報が正しくありません。');
  const result=Object.fromEntries(fields.map((f,i)=>[f,row[i]]));
  if(row.length===8){if(!Array.isArray(row[7])||row[7].length>100||row[7].some(x=>typeof x!=='string'||!x||x.length>512))throw Error('共有する選手情報を確認してください。');result.participants=[...new Set(row[7])];}
  return result;
 });
}
export function inlineShareUrl(clips,base){
 const rows=clips.map(c=>[...fields.map(f=>c[f]),...(c.participants?[c.participants]:[])]);checked(rows);
 const bytes=new TextEncoder().encode(JSON.stringify({v:1,c:rows}));
 const encoded=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
 if(encoded.length>12000)throw Error('共有リンクが長くなりすぎます。場面を減らして作成してください。');
 const url=new URL('./youtube-watch.html',base);url.hash='clips='+encoded;return url.href;
}
export function inlineShareClips(hash){
 const data=new URLSearchParams(String(hash).replace(/^#/,''));if(!data.has('clips'))return null;
 const encoded=data.get('clips');if(!encoded||encoded.length>12000||!/^[\w-]+$/.test(encoded))throw Error('共有リンクが不完全です。URL全体をコピーしてください。');
 try{const text=atob(encoded.replaceAll('-','+').replaceAll('_','/'));const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(text,x=>x.charCodeAt(0))));
  if(parsed.v!==1)throw Error('version');return checked(parsed.c);
 }catch{throw Error('共有リンクが不完全です。URL全体をコピーしてください。');}
}
