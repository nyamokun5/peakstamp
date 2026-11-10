import {validId} from '../youtube-session.mjs';

export async function onRequestGet({request,env}){
 const url=new URL(request.url);
 const page=await env.ASSETS.fetch(request);
 const id=url.searchParams.get('id');
 if(page.status!==200||!id||!/^[0-9a-f]{64}$/.test(id))return page;
 const data=await env.HIGHLIGHTS.get(id,'json');
 const clips=data?.clips;
 if(!Array.isArray(clips)||!validId(clips[0]?.video))return page;
 const image='https://i.ytimg.com/vi/'+clips[0].video+'/hqdefault.jpg';
 const count=new Set(clips.map(c=>c.video)).size;
 const title='試合ハイライト｜'+count+'試合・'+clips.length+'場面';
 const description='採用した場面を試合順に連続再生できます。';
 const canonical=url.origin+'/youtube-watch?id='+id;
 const tags=[['og:type','website'],['og:title',title],['og:description',description],['og:url',canonical],['og:image',image],['og:image:width','480'],['og:image:height','360']];
 const markup=tags.map(([key,value])=>'<meta property="'+key+'" content="'+value+'">').join('\n')
  +'<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="'+image+'">';
 const headers=new Headers(page.headers);
 headers.set('Cache-Control','no-cache');
 headers.delete('Content-Length');headers.delete('ETag');
 return new HTMLRewriter().on('title',{element(node){node.setInnerContent(title);node.after(markup,{html:true})}})
  .transform(new Response(page.body,{headers}));
}
