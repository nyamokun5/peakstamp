import {forMember} from './youtube-session.mjs';
const showMemberFilter=false;
const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const id=params.get('id');
let clips=[],queue=[],index=0,player,active=false,seeking=false,ready=false;
const label=c=>[c.label,c.scorer&&'得点 '+c.scorer,c.assist&&'アシスト '+c.assist].filter(Boolean).join('　');
function statusClip(){
 const c=queue[index];$('status').textContent=(index+1)+' / '+queue.length+'　'+c.match+'　'+label(c);
}
function jump(next){
 index=next;active=true;seeking=true;const c=queue[index];statusClip();
 if(player.getVideoData()?.video_id===c.video){
  const playing=player.getPlayerState()===YT.PlayerState.PLAYING;
  player.seekTo(c.start,true);if(!playing)player.playVideo();
 }else player.loadVideoById({videoId:c.video,startSeconds:c.start});
}
function advance(){
 if(index+1<queue.length)jump(index+1);
 else{active=false;player.pauseVideo();$('status').textContent='全場面の再生が終了しました';$('play').textContent='最初から再生'}
}
function button(text,action){
 const b=document.createElement('button');b.textContent=text;b.onclick=action;return b;
}
function selectMember(name){
 queue=forMember(clips,name);renderList();if(ready&&queue.length)jump(0);
}
function renderList(){
 const list=$('list');list.replaceChildren();let d,last;
 queue.forEach((c,i)=>{
  if(c.video!==last){d=document.createElement('details');const summary=document.createElement('summary');summary.textContent=c.match;d.append(summary);list.append(d);last=c.video}
  const m=Math.floor(c.start/60),s=String(Math.floor(c.start%60)).padStart(2,'0');
  d.append(button(m+':'+s+'　'+label(c),()=>{if(ready)jump(i)}));
 });
}
async function init(){
 if(!/^[0-9a-f]{64}$/.test(id||''))throw Error('共有リンクが正しくありません。');
 const r=await fetch('./api/yt-share?id='+id);const result=await r.json();
 if(!r.ok)throw Error(result.error);
 clips=result.clips;queue=clips;
 if(!queue?.length)throw Error('公開された場面がありません。');
 renderList();
 if(showMemberFilter){
  const names=new Set(clips.flatMap(c=>[c.scorer,c.assist]).filter(Boolean));
  $('members').append(button('全員',()=>selectMember('')));
  for(const name of names)$('members').append(button(name,()=>selectMember(name)));
  $('members').hidden=false;
 }
 const c=queue[0];$('screen').hidden=false;
 window.onYouTubeIframeAPIReady=()=>{
  player=new YT.Player('screen',{videoId:c.video,playerVars:{playsinline:0,controls:1,fs:1,start:Math.floor(c.start),origin:location.origin},events:{
   onReady:()=>{ready=true;$('play').hidden=false;$('play').textContent='▶ 全画面で'+queue.length+'場面を連続再生';$('status').textContent='全'+queue.length+'場面'},
   onStateChange:e=>{
    if(e.data===1&&!active){jump(0);return}
    if(e.data===0&&active&&!seeking)advance();
   },
   onAutoplayBlocked:()=>{$('status').textContent='動画内の▶を押すと続きから再生します。'},
   onError:()=>{active=false;$('status').textContent='この動画を再生できません。試合一覧から別の場面を選べます。'}
  }});
 };
 $('play').onclick=()=>jump(0);
 const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';
 script.onerror=()=>{$('status').textContent='YouTubeに接続できません。再読み込みしてください。'};
 document.head.append(script);
 setInterval(()=>{
  if(!active||player.getPlayerState()!==1)return;
  const c=queue[index];if(player.getVideoData()?.video_id!==c.video)return;
  const t=player.getCurrentTime();
  if(seeking){if(t>=c.start-1&&t<c.end)seeking=false;return}
  if(t>=c.end)advance();
 },120);
}
init().catch(e=>{$('status').textContent=e.message});
