/* VINBOX offline shell. API requests always use the network. */
const VERSION='vinbox-v15';
const SHELL=['./','index.html','app.js','backup.js','epa-match.js','epa.js','extras.js','styles.css','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png','apple-touch-icon.png'];
const ROOT=new URL('./',self.registration.scope);
const STATIC=new Set(SHELL.map(p=>new URL(p,ROOT).pathname));
const ZXING='/@zxing/library@0.21.3/umd/index.min.js';

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(
    keys.filter(k=>k.startsWith('vinbox-')&&k!==VERSION).map(k=>caches.delete(k))
  )).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  const local=url.origin===self.location.origin;
  // Only provide the app shell for navigation. Always try a fresh page first.
  if(local&&req.mode==='navigate'){
    e.respondWith((async()=>{
      try{
        const fresh=await fetch(req);
        if(fresh.ok && (url.pathname===ROOT.pathname || url.pathname===new URL('index.html',ROOT).pathname)){
          const cache=await caches.open(VERSION);
          await cache.put(new URL('./',ROOT).href,fresh.clone()).catch(()=>{});
        }
        return fresh;
      }catch(e){
        return (await caches.match(new URL('./',ROOT).href))||Response.error();
      }
    })());
    return;
  }
  // Never cache arbitrary same-origin paths, request URLs with query strings,
  // or NHTSA data; only the known shell and pinned scanner/font resources.
  const shell=local && !url.search && STATIC.has(url.pathname);
  const runtime=!local && (
    url.hostname==='fonts.googleapis.com' ||
    url.hostname==='fonts.gstatic.com' ||
    (url.hostname==='unpkg.com' && url.pathname===ZXING && !url.search)
  );
  if(!shell&&!runtime)return;
  e.respondWith((async()=>{
    const cache=await caches.open(VERSION);
    const cached=await cache.match(req);
    const refresh=fetch(req).then(async res=>{
      if(res && (res.ok || (runtime&&res.type==='opaque')))
        await cache.put(req,res.clone()).catch(()=>{});
      return res;
    }).catch(()=>null);
    if(cached){e.waitUntil(refresh);return cached;}
    return (await refresh)||Response.error();
  })());
});
