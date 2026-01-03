/* public/sw.js */

// CAMBIA ESTE NOMBRE CADA VEZ QUE QUIERAS FORZAR ACTUALIZACIÓN EN TODOS LOS MÓVILES
const CACHE_NAME = 'rail-app-v10.1'; 

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/styles.css',
  './js/main.js',
  './js/config.js',
  './js/utils.js', // (Si tienes este archivo, si no bórralo de la lista)
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://fonts.googleapis.com/icon?family=Material+Icons+Round'
];

// 1. INSTALACIÓN: Guarda los archivos en caché
self.addEventListener('install', (e) => {
  self.skipWaiting(); // Fuerza a activar el nuevo SW inmediatamente
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// 2. ACTIVACIÓN: Borra cachés antiguas (CRÍTICO PARA QUE SE ACTUALICE LA VERSIÓN)
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[SW] Borrando caché antigua:', key);
          return caches.delete(key);
        }
      }));
    }).then(() => self.clients.claim()) // Toma el control de la página inmediatamente
  );
});

// 3. FETCH: Sirve desde caché, si falla va a internet
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});