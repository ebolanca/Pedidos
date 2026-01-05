/* public/sw.js */
// CAMBIA ESTE NOMBRE PARA FORZAR LA ACTUALIZACIÓN EN LOS MÓVILES
const CACHE_NAME = 'rail-app-cache-v10.8';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/styles.css',
  './js/main.js',
  './js/config.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://fonts.googleapis.com/icon?family=Material+Icons+Round'
];

// 1. Instalación: Forzamos la espera (skipWaiting) para que la nueva versión se active ya
self.addEventListener('install', (e) => {
  self.skipWaiting(); 
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

// 2. Activación: Borramos cualquier caché antigua que no coincida con la versión actual
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[SW] Borrando caché antigua:', key);
          return caches.delete(key);
        }
      }));
    }).then(() => self.clients.claim())
  );
});

// 3. Estrategia: Network First (Red primero, si falla usa caché)
// Esto asegura que siempre intenten ver la última versión si tienen internet.
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request)
      .then(res => res)
      .catch(() => caches.match(e.request))
  );
});