// =====================================================================
//  부부 AI 가계부 — 서비스 워커
//  · 앱 화면(index.html): 인터넷이 되면 항상 최신본, 안 되면 저장본으로 실행
//  · 외부 라이브러리(React 등): 저장본으로 바로 실행하고 뒤에서 새로 받아 둠
//  · Supabase 데이터 요청: 저장하지 않음 (항상 서버로)
//  index.html만 고쳐서 올릴 때는 이 파일을 바꿀 필요가 없습니다.
// =====================================================================
const CACHE = 'couple-budget-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];
const CDN_HOSTS = ['cdn.tailwindcss.com', 'unpkg.com', 'cdn.jsdelivr.net'];

// index.html에 적힌 외부 라이브러리 주소를 읽어 미리 저장 (첫 실행 직후에도 오프라인 가능)
// → 라이브러리 버전을 바꿔도 이 파일은 고칠 필요 없음
async function precacheLibraries(cache) {
  const html = await (await fetch('./index.html', { cache: 'no-store' })).text();
  const urls = [...html.matchAll(/<script[^>]+src="(https:\/\/[^"]+)"/g)].map((m) => m[1]);
  await Promise.allSettled(urls.map(async (u) => {
    try {
      const res = await fetch(u, { mode: 'cors' });
      if (res.ok) return cache.put(u, res);
    } catch (e) { /* CORS를 허용하지 않는 곳은 아래로 */ }
    return cache.put(u, await fetch(u, { mode: 'no-cors' }));
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then(async (c) => {
        await c.addAll(APP_SHELL);
        await precacheLibraries(c).catch(() => {});   // 실패해도 설치는 계속 (다음 실행 때 저장됨)
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Supabase(데이터·실시간)는 건드리지 않음
  if (url.hostname.endsWith('supabase.co')) return;

  // 앱 화면: 네트워크 우선 → 실패하면 저장본
  if (req.mode === 'navigate' || (url.origin === self.location.origin && url.pathname.endsWith('.html'))) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // 외부 라이브러리: 저장본 먼저, 뒤에서 갱신
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(CACHE).then(async (c) => {
        const cached = await c.match(req);
        const network = fetch(req)
          .then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 같은 사이트의 아이콘·manifest 등: 저장본 먼저
  if (url.origin === self.location.origin) {
    event.respondWith(caches.match(req).then((r) => r || fetch(req)));
  }
});
