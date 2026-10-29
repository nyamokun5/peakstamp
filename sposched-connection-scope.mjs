// Guard against an old official GET response being applied under another SS
// environment, password, event selection or UI revision. No tokens are logged.
const fail=()=>{throw Object.assign(
 Error('SSの接続先・認証・イベントが読み込み中に変わりました。再取得してください。'),
 {code:'stale_connection'});};
export function assertCurrentConnection(expected,current){
 if(!expected||!current||
    !['staging','production'].includes(expected.environment)||
    !Number.isSafeInteger(expected.revision)||expected.revision<0)
  fail();
 for(const field of ['environment','token','revision','eventId']){
  if(expected[field]!==current[field])fail();
 }
 return true;
}
