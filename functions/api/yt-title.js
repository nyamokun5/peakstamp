import {validId} from '../../youtube-session.mjs';
export async function onRequestGet({request}){
 const id=new URL(request.url).searchParams.get('id');
 if(!validId(id))return new Response('Invalid video ID',{status:400});
 const endpoint=new URL('https://www.youtube.com/oembed');
 endpoint.searchParams.set('url','https://www.youtube.com/watch?v='+id);
 endpoint.searchParams.set('format','json');
 const r=await fetch(endpoint);
 if(!r.ok)return new Response('YouTubeの公開設定とURLを確認してください。',{status:422});
 const {title}=await r.json();
 return Response.json({title});
}
