/**
 * SmartCash — service-worker.js
 * Progressive Web App — Suporte Offline
 * -----------------------------------------------
 * Estratégia: Cache First para assets estáticos.
 * Recursos externos (CDN) são cacheados na 1ª visita.
 * IndexedDB funciona offline nativamente.
 */

'use strict';

const CACHE_NAME    = 'smartcash-v1.2.0-auth';
const OFFLINE_URL   = './index.html';

// Assets locais para pre-cachear no install
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/app.js',
  './js/supabase.js',
  './js/auth.js',
  './js/dashboard.js',
  './js/contas.js',
  './js/dividas.js',
  './js/patrimonio.js',
  './js/planejamento.js',
  './js/configuracoes.js',
  './assets/icons/icon-192.svg',
  './assets/icons/icon-512.svg'
];

// Assets externos (CDN) — cacheados na 1ª visita
const EXTERNAL_ASSETS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// ============================================================
// INSTALL — Pre-cacheia assets estáticos
// ============================================================
self.addEventListener('install', event => {
  console.log('[SW] Instalando SmartCash Service Worker...');

  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {

      // Cacheia assets locais (falha individual não bloqueia tudo)
      const localPromises = STATIC_ASSETS.map(url =>
        cache.add(url).catch(err => console.warn('[SW] Não cacheou (local):', url, err))
      );

      // Cacheia assets externos
      const externalPromises = EXTERNAL_ASSETS.map(async url => {
        try {
          const response = await fetch(url, { mode: 'cors' });
          if (response.ok) await cache.put(url, response);
        } catch (err) {
          console.warn('[SW] Não cacheou (externo):', url, err);
        }
      });

      await Promise.all([...localPromises, ...externalPromises]);
      console.log('[SW] Cache criado com sucesso:', CACHE_NAME);
    })
  );

  // Ativa o SW imediatamente (sem esperar fechar outras abas)
  self.skipWaiting();
});

// ============================================================
// ACTIVATE — Remove caches antigos
// ============================================================
self.addEventListener('activate', event => {
  console.log('[SW] Ativando SmartCash Service Worker...');

  event.waitUntil(
    caches.keys().then(nomes => {
      return Promise.all(
        nomes
          .filter(nome => nome.startsWith('smartcash-') && nome !== CACHE_NAME)
          .map(nome => {
            console.log('[SW] Removendo cache antigo:', nome);
            return caches.delete(nome);
          })
      );
    })
  );

  // Controla todas as páginas abertas imediatamente
  self.clients.claim();
});

// ============================================================
// FETCH — Intercepta requisições (Cache First)
// ============================================================
self.addEventListener('fetch', event => {
  // Ignora requisições não-GET e extensões do browser
  if (event.request.method !== 'GET') return;
  // Apenas assets locais e CDNs explicitamente permitidos entram no cache.
  // Chamadas ao Supabase (inclusive GET de Auth) seguem diretamente à rede.
  const requestURL = new URL(event.request.url);
  if (requestURL.origin !== self.location.origin &&
      !EXTERNAL_ASSETS.includes(event.request.url)) return;
  if (event.request.headers.has('Authorization') ||
      requestURL.pathname.startsWith('/auth/v1/') ||
      requestURL.pathname.startsWith('/rest/v1/')) return;
  if (event.request.url.startsWith('chrome-extension://')) return;
  if (event.request.url.includes('indexeddb')) return;

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {

      // ── Cache hit: retorna do cache ──────────────────────
      if (cachedResponse) {
        // Atualiza o cache em background (stale-while-revalidate)
        const fetchPromise = fetch(event.request)
          .then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, networkResponse.clone());
              });
            }
            return networkResponse;
          })
          .catch(() => { /* offline: usa cache */ });

        return cachedResponse;
      }

      // ── Cache miss: busca na rede ────────────────────────
      return fetch(event.request)
        .then(networkResponse => {
          // Cacheia resposta válida para uso futuro
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, clone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline e sem cache: retorna a página principal (SPA fallback)
          if (event.request.destination === 'document') {
            return caches.match(OFFLINE_URL);
          }
          // Para outros recursos: resposta vazia
          return new Response('', { status: 408, statusText: 'Offline' });
        });
    })
  );
});

// ============================================================
// MESSAGE — Comunicação com a página
// ============================================================
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
