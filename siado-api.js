/* ================================================================
 * siado-api.js — Jembatan frontend lama (GAS) -> Supabase
 *
 * Meniru google.script.run.handleApiRequest(data) dengan supabase.rpc('api').
 * Sertakan SEBELUM script.js / admin-script.js:
 *   <script src="supabase.min.js"></script>   (salinan lokal supabase-js v2; fallback CDN otomatis)
 *   <script src="siado-config.js"></script>
 *   <script src="siado-api.js"></script>
 *
 * Setelah itu apiPeserta()/adminApi() di kode lama bekerja tanpa diubah,
 * karena objek global `google.script.run` disediakan oleh file ini.
 * ================================================================ */
(function (w) {
  'use strict';
  var cfg = w.SIADO_CONFIG || {};
  var modeLokal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);   // tools/dev_server.py
  var belumDiisi = !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY ||
    (!modeLokal && /GANTI-PROJECT-REF|GANTI_DENGAN/.test(String(cfg.SUPABASE_URL) + String(cfg.SUPABASE_ANON_KEY)));
  if (belumDiisi) {
    console.error('[SIADO] Isi SUPABASE_URL dan SUPABASE_ANON_KEY di siado-config.js');
    // Tampilkan peringatan yang terlihat, supaya kesalahan konfigurasi tidak
    // disangka "server tidak merespons" oleh pengguna.
    w.addEventListener('DOMContentLoaded', function () {
      var el = document.createElement('div');
      el.setAttribute('style', 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#b91c1c;color:#fff;' +
        'font:600 14px/1.4 system-ui,sans-serif;padding:10px 16px;text-align:center');
      el.textContent = 'Konfigurasi belum lengkap: isi SUPABASE_URL dan SUPABASE_ANON_KEY pada file siado-config.js (lihat PANDUAN_MIGRASI.md Langkah 5).';
      document.body.appendChild(el);
    });
  }
  // Secret key TIDAK BOLEH ada di browser. Hentikan lebih awal bila tertukar.
  if (/^sb_secret_/.test(String(cfg.SUPABASE_ANON_KEY || ''))) {
    throw new Error('[SIADO] SUPABASE_ANON_KEY berisi secret key! Ganti dengan publishable key (sb_publishable_…) atau anon key.');
  }
  /* --- Pustaka supabase-js ---
   * Normalnya sudah termuat dari supabase.min.js (tag <script> sebelum file ini).
   * Bila berkas itu lupa diunggah ke hosting, pustaka dimuat otomatis dari CDN jsDelivr
   * (versi yang sama) supaya aplikasi tetap berjalan, dan kesalahannya dilaporkan dengan jelas. */
  var SUPABASE_JS_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/dist/umd/supabase.min.js';
  var client = null, clientPromise = null;
  function buatClient_() {
    client = w.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },   // tidak memakai Supabase Auth
      global: { headers: { 'x-siado-client': cfg.APP_VERSION || 'v5' } }
    });
    w.siadoClient = client;
    return client;
  }
  if (w.supabase && w.supabase.createClient) buatClient_();
  function ambilClient_() {
    if (client) return Promise.resolve(client);
    if (clientPromise) return clientPromise;
    clientPromise = new Promise(function (resolve, reject) {
      console.warn('[SIADO] supabase.min.js tidak termuat (berkas belum diunggah ke hosting?). Memuat dari CDN: ' + SUPABASE_JS_CDN);
      var s = document.createElement('script');
      s.src = SUPABASE_JS_CDN; s.async = true;
      s.onload = function () {
        if (w.supabase && w.supabase.createClient) resolve(buatClient_());
        else reject(new Error('Pustaka Supabase tidak dapat diinisialisasi. Muat ulang halaman.'));
      };
      s.onerror = function () {
        clientPromise = null;   // boleh dicoba lagi pada permintaan berikutnya
        reject(new Error('Pustaka Supabase belum termuat: berkas supabase.min.js tidak ada di hosting ' +
          'dan CDN tidak terjangkau. Unggah berkas supabase.min.js (lihat PETUNJUK Langkah 5.3) atau periksa koneksi internet.'));
      };
      document.head.appendChild(s);
    });
    return clientPromise;
  }

  /** Panggil router SQL public.api(action, data). Selalu resolve {success, ...}. */
  function panggilApi(data) {
    data = data || {};
    var action = String(data.action || '');
    var payload = Object.assign({}, data);
    delete payload.action;
    return ambilClient_().then(function (c) {
      return c.rpc('api', { action: action, data: payload });
    }).then(function (res) {
      if (res.error) {
        var pesan = res.error.message || 'Permintaan ke server gagal.';
        if (/Failed to fetch|NetworkError|Load failed/i.test(pesan)) {
          pesan = 'Server belum merespons. Periksa koneksi internet Anda, lalu coba lagi.';
        }
        throw new Error(pesan);
      }
      return res.data;
    });
  }

  /* --- Emulasi google.script.run (rantai withSuccessHandler/withFailureHandler) --- */
  function Runner() { this._ok = null; this._err = null; }
  Runner.prototype.withSuccessHandler = function (fn) { this._ok = fn; return this; };
  Runner.prototype.withFailureHandler = function (fn) { this._err = fn; return this; };
  Runner.prototype.withUserObject = function () { return this; };
  Runner.prototype.handleApiRequest = function (data) {
    var self = this;
    panggilApi(data).then(function (hasil) { if (self._ok) self._ok(hasil); },
                          function (galat) { if (self._err) self._err(galat); else console.error(galat); });
  };
  var runProxy = {
    withSuccessHandler: function (fn) { return new Runner().withSuccessHandler(fn); },
    withFailureHandler: function (fn) { return new Runner().withFailureHandler(fn); },
    withUserObject: function () { return new Runner(); },
    handleApiRequest: function (data) { return new Runner().handleApiRequest(data); }
  };
  w.google = w.google || {};
  w.google.script = w.google.script || {};
  w.google.script.run = runProxy;
  // google.script.host / history dipanggil di beberapa tempat: buat no-op aman
  w.google.script.host = w.google.script.host || { close: function () {}, setHeight: function () {}, setWidth: function () {} };
  w.google.script.history = w.google.script.history || { push: function () {}, replace: function () {} };

  /* --- Variabel template yang dulu disuntikkan <?!= ?> --- */
  var base = (cfg.PUBLIC_BASE_URL || (location.origin + location.pathname.replace(/[^/]*$/, ''))).replace(/\/?$/, '/');
  w.APP_WEB_URL = base;            // index.html ada di root; ?page=admin diarahkan ke admin.html
  w.APP_PUBLIC_URL = '';           // tidak ada pembungkus iframe lagi
  if (typeof w.SESI_HANDOFF === 'undefined') w.SESI_HANDOFF = null;

  // Kode lama membentuk URL panel sebagai "<APP_WEB_URL>?page=admin".
  // Alihkan pola itu ke admin.html supaya tautan lama tetap benar.
  if (/[?&]page=admin/.test(location.search) && !/admin\.html$/.test(location.pathname)) {
    location.replace(base + 'admin.html' + location.hash);
  }

  /* --- Upload media/branding: LANGSUNG ke Supabase Storage (tanpa Edge Function) ---
   * Browser -> POST {SUPABASE_URL}/storage/v1/object/{bucket}/{username}/{nama}
   * dengan publishable key + header x-siado-token (token panel). Policy RLS di
   * storage.objects (sql/04) memverifikasi token itu lewat siado.storage_boleh_tulis();
   * tanpa token valid unggahan ditolak "row-level security". Untuk logo/background,
   * URL hasil unggah disimpan ke pengaturan lewat api() (updateBrandingLogo /
   * updateLoginBackground) — sama seperti perilaku Edge Function "media" sebelumnya. */
  function urlStorage_(bagian) {
    return String(cfg.SUPABASE_URL || '').replace(/\/+$/, '') + '/storage/v1/object/' + bagian;
  }
  function namaAman_(nama) {
    var ext = (String(nama || '').split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    var acak = Math.random().toString(36).slice(2, 10);
    return Date.now() + '-' + acak + '.' + ext;
  }
  function pesanStorage_(res, teks) {
    var m = '';
    try { var j = JSON.parse(teks || '{}'); m = j.message || j.error || ''; } catch (e) { m = teks || ''; }
    if (/row-level security|AccessDenied|Unauthorized/i.test(m)) {
      return 'Unggahan ditolak Storage (policy belum terpasang atau sesi panel berakhir). ' +
             'Jalankan ulang sql/04_fungsi_panel.sql, atau buat policy Storage sesuai PETUNJUK Langkah 4.2, lalu login ulang.';
    }
    if (/exceeded the maximum allowed size|Payload too large|413/i.test(m + res.status)) return 'Ukuran berkas melebihi batas bucket.';
    if (/mime type|not supported/i.test(m)) return 'Jenis berkas tidak diizinkan bucket: ' + m;
    return m || ('Storage menjawab HTTP ' + res.status + '.');
  }
  w.siadoUploadMedia = function (file, opsi) {
    opsi = opsi || {};
    var token = opsi.adminToken || (w.ADMIN && w.ADMIN.token) || '';
    var jenis = opsi.jenis || 'gambar';
    var isVideo = jenis === 'video';
    var bucket = (jenis === 'logo' || jenis === 'background') ? 'branding' : 'media-soal';
    var info;
    return panggilApi({ action: 'infoUploadMedia', adminToken: token }).then(function (r) {
      if (!r || !r.success) throw new Error((r && r.message) || 'Sesi panel tidak valid.');
      info = r;
      if (bucket === 'branding' && r.role !== 'ADMIN') throw new Error('Hanya admin yang boleh mengubah logo/background.');
      var maksMb = bucket === 'branding' ? (r.maksBrandingMb || 2) : (isVideo ? (r.maksVideoMb || 50) : (r.maksUploadMb || 5));
      if (file.size > maksMb * 1024 * 1024) throw new Error('Ukuran berkas melebihi ' + maksMb + ' MB.');
      var path = r.username + '/' + namaAman_(file.name);
      var url = urlStorage_(bucket + '/' + path.split('/').map(encodeURIComponent).join('/'));
      return fetch(url, {
        method: 'POST',
        headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY,
                   'x-siado-token': token, 'Content-Type': file.type || 'application/octet-stream',
                   'x-upsert': 'false', 'cache-control': 'max-age=31536000' },
        body: file
      }).then(function (res) {
        return res.text().then(function (teks) {
          if (!res.ok) throw new Error(pesanStorage_(res, teks));
          var publik = urlStorage_('public/' + bucket + '/' + path.split('/').map(encodeURIComponent).join('/'));
          var simpan = Promise.resolve({ success: true });
          if (jenis === 'logo') simpan = panggilApi({ action: 'updateBrandingLogo', adminToken: token, url: publik });
          if (jenis === 'background') simpan = panggilApi({ action: 'updateLoginBackground', adminToken: token, mode: 'gambar', url: publik });
          return simpan.then(function (hasil) {
            if (hasil && hasil.success === false) throw new Error(hasil.message || 'URL berkas gagal disimpan.');
            return { success: true, url: publik, path: path, bucket: bucket, embedKind: isVideo ? 'video' : 'image',
                     message: 'Berkas terunggah.', branding: hasil && hasil.branding, background: hasil && hasil.background };
          });
        });
      });
    }).catch(function (e) {
      var pesan = e && e.message ? e.message : String(e);
      if (/Failed to fetch|NetworkError|Load failed/i.test(pesan)) {
        pesan = 'Tidak dapat menghubungi Supabase Storage. Periksa koneksi internet, lalu coba lagi.';
      }
      return { success: false, message: pesan };
    });
  };
  w.siadoHapusMedia = function (url, opsi) {
    opsi = opsi || {};
    var token = opsi.adminToken || (w.ADMIN && w.ADMIN.token) || '';
    var m = /\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/.exec(String(url || ''));
    if (!m) return Promise.resolve({ success: true, dihapus: false, message: 'Bukan berkas Storage; tidak ada yang dihapus.' });
    var bucket = m[1], path = decodeURIComponent(m[2]);
    return panggilApi({ action: 'cekMediaDipakai', adminToken: token, url: url, idSoal: opsi.idSoal || null }).then(function (cek) {
      if (cek && cek.dipakai) return { success: true, dihapus: false, message: 'Berkas masih dipakai soal lain; tidak dihapus.' };
      return fetch(urlStorage_(bucket), {
        method: 'DELETE',
        headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY,
                   'x-siado-token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [path] })
      }).then(function (res) {
        return res.text().then(function (teks) {
          if (!res.ok) return { success: false, dihapus: false, message: pesanStorage_(res, teks) };
          return { success: true, dihapus: true, message: 'Berkas dihapus.' };
        });
      });
    }).catch(function (e) { return { success: false, dihapus: false, message: (e && e.message) || String(e) }; });
  };

  /* --- Realtime monitor (opsional, HANYA panel admin; peserta tetap polling) --- */
  w.siadoMonitorRealtime = function (onChange) {
    if (!client || !cfg.REALTIME_MONITOR) return null;
    return client.channel('monitor')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sesi_ujian' }, onChange)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pelanggaran' }, onChange)
      .subscribe();
  };

  w.siadoApi = panggilApi;
  w.siadoClient = client;   // null bila pustaka masih dimuat dari CDN; diisi ulang oleh buatClient_()
})(window);
