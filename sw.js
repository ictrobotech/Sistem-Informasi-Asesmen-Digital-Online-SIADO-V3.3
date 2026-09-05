/**
 * sw.js - service worker minimal untuk SIADO (GitHub Pages).
 *
 * SENGAJA TIDAK MENYIMPAN CACHE APA PUN. Tugasnya hanya membuat browser
 * mengenali halaman ini sebagai aplikasi yang dapat dipasang ke layar utama,
 * sehingga peserta dapat membukanya tanpa bilah alamat (mode aplikasi) dan
 * notifikasi "swipe down to exit full screen" tidak pernah muncul.
 *
 * Karena tidak ada cache, aplikasi tidak akan pernah menyajikan versi lama.
 */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () { /* selalu ambil dari jaringan */ });
