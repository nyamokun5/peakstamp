// Fixed-purpose authentication for highlight publication. No Google calls or data writes.
import {timingSafeEqual} from 'node:crypto';
const allowed=()=>['https://nyamokun5.github.io','https://peakstamp-ss-stage-nyamokun5.pages.dev',...String(process.env.PEAKSTAMP_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean)];
export default function handler(req,res){
 const origin=String(req.headers.origin||'');res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Origin');res.setHeader('X-Content-Type-Options','nosniff');
 if(allowed().includes(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','content-type, x-peakstamp-access');}
 if(origin&&!allowed().includes(origin))return res.status(403).json({error:'このサイトからのアクセスは許可されません。'});
 if(req.method==='OPTIONS')return res.status(204).end();
 const secret=process.env.PEAKSTAMP_ACCESS_CODE;
 if(req.method==='GET')return res.status(secret?200:503).json({service:'peakstamp-share-access',contract:'share-access-v1',configured:Boolean(secret)});
 if(req.method!=='POST')return res.status(405).json({error:'POSTのみ対応します。'});
 if(!secret)return res.status(503).json({error:'共有機能のアクセス設定が未完了です。'});
 const code=req.headers['x-peakstamp-access'];
 if(typeof code!=='string'||Buffer.byteLength(code)!==Buffer.byteLength(secret)||!timingSafeEqual(Buffer.from(code),Buffer.from(secret)))return res.status(401).json({error:'アクセスコードを確認してください。'});
 if(!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type']||''))||req.body?.probe!==true||Object.keys(req.body).some(k=>k!=='probe'))return res.status(400).json({error:'認証確認の形式が正しくありません。'});
 return res.status(200).json({service:'peakstamp-share-access',ready:true});
}
