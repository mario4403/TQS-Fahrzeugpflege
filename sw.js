/* TQS Fahrzeugpflege: Offline-Zwischenspeicher für die App selbst.
   Die Daten (Fahrzeuge, Maßnahmen) speichert Firebase offline selbst. */
const V='tqs-shell-v3';
const SHELL=['./','./index.html','./favicon-32.png','./favicon-192.png','./apple-touch-icon.png','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-maskable-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).catch(()=>{}).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);
 // Seite selbst: immer zuerst aus dem Netz, am Browser-Zwischenspeicher vorbei (damit Updates sofort ankommen), ohne Netz aus dem Speicher
 if(r.mode==='navigate'){e.respondWith(fetch(r.url.split('?')[0],{cache:'no-cache'}).then(res=>{if(res.ok){const c=res.clone();caches.open(V).then(x=>x.put('./index.html',c))}return res}).catch(()=>caches.match('./index.html').then(m=>m||caches.match('./'))));return}
 const stat=u.origin===location.origin||(u.host==='www.gstatic.com'&&u.pathname.startsWith('/firebasejs/'))||u.host==='fonts.googleapis.com'||u.host==='fonts.gstatic.com'||u.host==='cdn.jsdelivr.net'||u.host==='fastly.jsdelivr.net';
 if(!stat)return; // Firebase-Datenverkehr nicht anfassen
 e.respondWith(caches.match(r).then(hit=>{const net=fetch(r).then(res=>{if(res.ok||res.type==='opaque'){const c=res.clone();caches.open(V).then(x=>x.put(r,c))}return res}).catch(()=>hit);return hit||net}))});
