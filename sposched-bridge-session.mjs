// Optional TEST/production Bridge token reuse within this browser tab only.
// Never use localStorage, cookies or URL parameters to persist this secret.
// sessionStorage is still script-readable: the checkbox must be user opt-in.
// No cross-environment reuse (production and staging use different keys).
export const BRIDGE_SESSION_TTL_MS=4*60*60*1000;
const KEY_PREFIX='peakstamp_ss_bridge_tab_v1:';
const validEnv=environment=>environment==='staging'||environment==='production';
const key=environment=>KEY_PREFIX+environment;

export function clearBridgeSession(store,environment){
 if(!validEnv(environment))return;
 try{store.removeItem(key(environment))}catch{}
}
export function restoreBridgeSession(store,environment,now=Date.now()){
 if(!validEnv(environment))return '';
 try{
  const raw=store.getItem(key(environment));
  if(!raw)return '';
  const stored=JSON.parse(raw);
  if(!stored||typeof stored.token!=='string'||!stored.token||
     !Number.isFinite(stored.expiresAt)||stored.expiresAt<=now||
     stored.expiresAt>now+BRIDGE_SESSION_TTL_MS){
   clearBridgeSession(store,environment);return '';
  }
  return stored.token;
 }catch{clearBridgeSession(store,environment);return ''}
}
export function rememberBridgeSession(store,environment,token,now=Date.now()){
 if(!validEnv(environment)||typeof token!=='string'||!token.trim())return false;
 try{
  // Fixed four-hour expiry from the initial successful authentication.
  if(restoreBridgeSession(store,environment,now)===token)return true;
  store.setItem(key(environment),JSON.stringify({
   token,expiresAt:now+BRIDGE_SESSION_TTL_MS
  }));
  return true;
 }catch{return false}
}
