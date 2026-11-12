/** Stable, TEST-only browser ledger key for a completed batch alias attempt. */
const clean=x=>typeof x==='string'?x.trim():'';
export function batchAliasAttemptKey({eventId,requestId,alias,memberId}={}){
 const norm=clean(alias).normalize('NFKC').toLocaleLowerCase('ja-JP')
  .replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
 const id=clean(memberId).toLowerCase();
 if(!clean(eventId)||!clean(requestId)||!norm||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id))
  return '';
 return 'peakstamp:batch-alias-attempt:v2:'+JSON.stringify([eventId,requestId,norm,id]);
}
