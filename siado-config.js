/* ================================================================
 * siado-config.js — SATU-SATUNYA file yang perlu diisi saat deploy.
 *
 * Ambil nilainya dari Supabase Dashboard > Settings > API Keys:
 *   SUPABASE_URL      : "Project URL"  -> https://xxxxxxxx.supabase.co
 *   SUPABASE_ANON_KEY : kunci publik untuk browser. Boleh salah satu dari:
 *                       - Publishable key (baru)  : sb_publishable_xxxxxxxx   <- disarankan
 *                       - anon key (legacy/JWT)   : eyJhbGciOi...             <- masih didukung s.d. akhir 2026
 * Kunci ini AMAN dipublikasikan: semua tabel tertutup RLS, dari luar hanya
 * fungsi api() yang bisa dipanggil dan ia memverifikasi token SIADO sendiri.
 * JANGAN PERNAH menaruh secret key (sb_secret_…) / service_role di file ini.
 *
 * Baris "localhost" di bawah hanya untuk pengujian lokal dengan tools/dev_server.py;
 * boleh dibiarkan, tidak berpengaruh saat sudah di-hosting.
 * ================================================================ */
window.SIADO_CONFIG = {
  SUPABASE_URL: (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? location.origin
    : 'https://GANTI-PROJECT-REF.supabase.co',
  SUPABASE_ANON_KEY: 'GANTI_DENGAN_PUBLISHABLE_KEY_ATAU_ANON_KEY',
  PUBLIC_BASE_URL: '',            // kosongkan = otomatis (mis. https://ictrobotech.github.io/SIADO-V3.3/)
  REALTIME_MONITOR: false,        // true = monitor admin memakai Supabase Realtime (maks 200 koneksi di paket Free)
  APP_VERSION: 'siado-v5-r3.5'  // frontend = repo SIADO-V3.3 commit 1 Sep 2026 (revisi 3.4/3.5) + jembatan Supabase
};
