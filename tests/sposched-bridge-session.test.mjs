import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BRIDGE_SESSION_TTL_MS,clearBridgeSession,restoreBridgeSession,rememberBridgeSession}
 from '../sposched-bridge-session.mjs';

function store(){
 const data=new Map();
 return {data,getItem:k=>data.get(k)||null,
  setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
}
test('tab memory is explicit, environment scoped and expires after four hours',()=>{
 const s=store(),now=Date.now();
 assert.equal(restoreBridgeSession(s,'staging',now),'');
 assert.equal(rememberBridgeSession(s,'staging','test-only-password',now),true);
 assert.equal(restoreBridgeSession(s,'staging',now+1000),'test-only-password');
 assert.equal(restoreBridgeSession(s,'production',now+1000),'');
 assert.equal(rememberBridgeSession(s,'production','readonly-password',now),true);
 assert.equal(restoreBridgeSession(s,'production',now+1000),'readonly-password');
 assert.equal(restoreBridgeSession(s,'staging',now+BRIDGE_SESSION_TTL_MS),'');
 assert.equal(restoreBridgeSession(s,'production',now+BRIDGE_SESSION_TTL_MS),'');
 assert.equal(s.data.size,0,'expired tab secrets must be deleted');
});
test('same password cannot silently renew the TTL on each authorized GET',()=>{
 const s=store(),now=Date.now();
 rememberBridgeSession(s,'staging','secret',now);
 rememberBridgeSession(s,'staging','secret',now+BRIDGE_SESSION_TTL_MS/2);
 assert.equal(restoreBridgeSession(s,'staging',now+BRIDGE_SESSION_TTL_MS-1),'secret');
 assert.equal(restoreBridgeSession(s,'staging',now+BRIDGE_SESSION_TTL_MS),'');
});
test('forget and invalid or corrupted data are fail-closed',()=>{
 const s=store(),now=Date.now();
 assert.equal(rememberBridgeSession(s,'unknown','secret',now),false);
 assert.equal(rememberBridgeSession(s,'staging','',now),false);
 rememberBridgeSession(s,'staging','secret',now);
 clearBridgeSession(s,'staging');
 assert.equal(restoreBridgeSession(s,'staging',now),'');
 s.setItem('peakstamp_ss_bridge_tab_v1:staging','broken-json');
 assert.equal(restoreBridgeSession(s,'staging',now),'');
 s.setItem('peakstamp_ss_bridge_tab_v1:staging',JSON.stringify({
  token:'secret',expiresAt:now+BRIDGE_SESSION_TTL_MS*10
 }));
 assert.equal(restoreBridgeSession(s,'staging',now),'');
});
test('tab storage may be blocked without failing the SS flow',()=>{
 const fail={getItem(){throw Error('disabled')},setItem(){throw Error('disabled')},
  removeItem(){throw Error('disabled')}};
 assert.equal(restoreBridgeSession(fail,'staging'),'');
 assert.equal(rememberBridgeSession(fail,'staging','secret'),false);
 assert.doesNotThrow(()=>clearBridgeSession(fail,'staging'));
});
test('HTML only uses sessionStorage for Bridge password and supports iOS autofill',()=>{
 const html=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');
 assert.match(html,/id="ssBridgeToken"[^>]+autocomplete="current-password"/);
 assert.match(html,/id="ssRememberTab"/);
 assert.match(html,/id="ssForgetToken"/);
 assert.match(html,/rememberBridgeAfterSuccess\(env,token\)/);
 assert.match(html,/rememberBridgeAfterSuccess\('staging',token\)/);
 assert.match(html,/restoreBridgeInThisTab\(\)/);
 const token=readFileSync(new URL('../sposched-bridge-session.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(token,/localStorage/);
 assert.doesNotMatch(html,/localStorage\.setItem\([^\n]*BridgeToken/);
 assert.match(html,/if\(r\.status===401\|\|r\.status===403\)rejectRememberedBridge\(env\)/);
});
