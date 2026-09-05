/* ================================================================
 * siado-api.js — Jembatan frontend lama (GAS) -> Supabase
 *
 * Meniru google.script.run.handleApiRequest(data) dengan supabase.rpc('api').
 * Sertakan SEBELUM script.js / admin-script.js:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
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
  var client = w.supabase && w.supabase.createClient
    ? w.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },   // tidak memakai Supabase Auth
        global: { headers: { 'x-siado-client': cfg.APP_VERSION || 'v5' } }
      })
    : null;

  /** Panggil router SQL public.api(action, data). Selalu resolve {success, ...}. */
  function panggilApi(data) {
    data = data || {};
    var action = String(data.action || '');
    var payload = Object.assign({}, data);
    delete payload.action;
    if (!client) return Promise.reject(new Error('Supabase client belum termuat.'));
    return client.rpc('api', { action: action, data: payload }).then(function (res) {
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

  /* --- Upload media/branding lewat Edge Function (pengganti Drive) --- */
  w.siadoUploadMedia = function (file, opsi) {
    opsi = opsi || {};
    var form = new FormData();
    form.append('aksi', 'upload');
    form.append('adminToken', opsi.adminToken || (w.ADMIN && w.ADMIN.token) || '');
    form.append('jenis', opsi.jenis || 'gambar');
    form.append('file', file, file.name);
    return fetch(cfg.SUPABASE_URL + '/functions/v1/media', {
      method: 'POST', body: form, headers: { apikey: cfg.SUPABASE_ANON_KEY }
    }).then(function (r) { return r.json(); });
  };
  w.siadoHapusMedia = function (url, opsi) {
    opsi = opsi || {};
    var form = new FormData();
    form.append('aksi', 'hapus');
    form.append('adminToken', opsi.adminToken || (w.ADMIN && w.ADMIN.token) || '');
    form.append('jenis', opsi.jenis || 'gambar');
    form.append('url', url || '');
    if (opsi.idSoal) form.append('idSoal', String(opsi.idSoal));
    return fetch(cfg.SUPABASE_URL + '/functions/v1/media', {
      method: 'POST', body: form, headers: { apikey: cfg.SUPABASE_ANON_KEY }
    }).then(function (r) { return r.json(); });
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
  w.siadoClient = client;
})(window);
