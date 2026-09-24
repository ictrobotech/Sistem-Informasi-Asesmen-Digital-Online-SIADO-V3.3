/* ================================================================
 * admin-script.html - Panel admin realtime
 * ================================================================ */

/* Penampil error global: bila ada kesalahan JavaScript di panel,
 * tampilkan teks errornya di layar (bukan layar putih) agar mudah
 * didiagnosis. */
(function() {
  function tampilError(judul, detail) {
    try {
      var div = document.getElementById('fatalErrorBox');
      if (!div) {
        div = document.createElement('div');
        div.id = 'fatalErrorBox';
        div.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#dc2626;color:#fff;' +
          'padding:14px 18px;font:13px/1.5 monospace;white-space:pre-wrap;word-break:break-word;';
        document.body.appendChild(div);
      }
      div.style.display = 'block';
      div.textContent = judul + '\n' + (detail || '');
    } catch (abaikan) {}
  }
  window.addEventListener('error', function(e) {
    tampilError('Kesalahan JavaScript: ' + (e.message || 'unknown'),
      (e.filename || '') + ' baris ' + (e.lineno || '') + ':' + (e.colno || ''));
  });
  window.addEventListener('unhandledrejection', function(e) {
    var alasan = (e && e.reason && (e.reason.message || e.reason)) || e || '';
    tampilError('Janji gagal (unhandled rejection):', String(alasan));
  });
})();

var ADMIN = {
  token: '',
  username: '',
  nama: '',
  role: 'ADMIN',
  isAdmin: true,
  activeTab: 'soal',
  questions: [],
  teachers: [],
  participants: [],
  rombel: [],
  notifications: [],
  unreadNotif: 0,
  essayDrafts: {},
  autoRefreshId: null,
  refreshBusy: {},
  operationBusy: {},
  settings: null,
  background: null,
  brandingVersion: '',
  brandingSyncId: null,
  brandingBusy: false,
  // PERBAIKAN 3.4: tema aktif dan daftar tema dari server (Pengaturan -> Tema).
  tema: 'navy',
  daftarTema: [],
  // REVISI 2026-09-22 (2 mapel): daftar mapel yang diampu akun ini (maks. 2),
  // diurai dari profil guru / pengaturan server bila tersedia.
  mapelDiampu: []
};

var TAB_META = {
  soal:        { judul: 'Kelola Soal', sub: 'Bank soal, media stimulus, dan import soal' },
  kartusoal:   { judul: 'Kartu Soal', sub: 'Kisi-kisi butir soal untuk STS dan SAS' },
  monitor:     { judul: 'Monitor Peserta', sub: 'Pemantauan peserta ujian secara realtime' },
  pelanggaran: { judul: 'Pelanggaran', sub: 'Log kecurangan dan tindakan sistem' },
  uraian:      { judul: 'Nilai Uraian', sub: 'Penilaian manual jawaban uraian sebelum export' },
  hasil:       { judul: 'Hasil Ujian', sub: 'Nilai, KKM, dan status Tuntas/Remedial peserta' },
  rekap:       { judul: 'Rekap Kelas', sub: 'Ringkasan pencapaian setiap kelas' },
  export:      { judul: 'Export Laporan', sub: 'Unduh laporan nilai dan pelanggaran (Excel/PDF)' },
  peserta:     { judul: 'Data Peserta', sub: 'Validasi peserta dan rombel VII sampai IX' },
  pengguna:    { judul: 'Akun Guru Mapel', sub: 'Kelola akun guru, reset password, dan hapus akun' },
  notifikasi:  { judul: 'Notifikasi', sub: 'Semua informasi aktivitas aplikasi' },
  pengaturan:  { judul: 'Pengaturan', sub: 'Ujian, tampilan, akun, dan pemeliharaan aplikasi' }
};

var ADMIN_STORAGE_KEY = 'ao_admin_session_v3';
var ADMIN_OLD_STORAGE_KEY = 'ao_admin_session_v2';

function getStoredAdminSession_() {
  try {
    var persistent = localStorage.getItem(ADMIN_STORAGE_KEY);
    if (persistent) return persistent;
  } catch (error) {}
  try {
    return sessionStorage.getItem(ADMIN_STORAGE_KEY) || sessionStorage.getItem(ADMIN_OLD_STORAGE_KEY);
  } catch (error) {
    return null;
  }
}

function saveStoredAdminSession_(data) {
  var raw = JSON.stringify(data);
  try {
    localStorage.setItem(ADMIN_STORAGE_KEY, raw);
    sessionStorage.removeItem(ADMIN_OLD_STORAGE_KEY);
    return;
  } catch (error) {}
  try { sessionStorage.setItem(ADMIN_STORAGE_KEY, raw); } catch (error) {}
}

function clearStoredAdminSession_() {
  try {
    localStorage.removeItem(ADMIN_STORAGE_KEY);
    localStorage.removeItem(ADMIN_OLD_STORAGE_KEY);
  } catch (error) {}
  try {
    sessionStorage.removeItem(ADMIN_STORAGE_KEY);
    sessionStorage.removeItem(ADMIN_OLD_STORAGE_KEY);
  } catch (error) {}
}

function adminApi(action, payload) {
  var data = payload || {};
  data.action = action;
  if (ADMIN.token) data.adminToken = ADMIN.token;
  return new Promise(function(resolve, reject) {
    var selesai = false;
    // Google Apps Script tidak pernah memanggil handler bila koneksi terputus,
    // sehingga Promise dapat menggantung selamanya. Batas waktu ini membuat
    // kegagalan tampil apa adanya, bukan sebagai pesan umum tanpa sebab.
    var batas = window.setTimeout(function() {
      if (selesai) return;
      selesai = true;
      reject(new Error('Server tidak merespons untuk "' + action +
        '". Periksa koneksi internet, lalu muat ulang halaman. Data mungkin sudah tersimpan.'));
    }, 45000);

    google.script.run
      .withSuccessHandler(function(hasil) {
        if (selesai) return;
        selesai = true;
        window.clearTimeout(batas);
        if (hasil === null || hasil === undefined) {
          reject(new Error('Server mengembalikan data kosong untuk "' + action +
            '". Biasanya deployment Web App belum diperbarui ke versi terbaru.'));
          return;
        }
        resolve(hasil);
      })
      .withFailureHandler(function(galat) {
        if (selesai) return;
        selesai = true;
        window.clearTimeout(batas);
        var pesan = (galat && galat.message) ? String(galat.message) : String(galat || '');
        reject(new Error(pesan || 'Panggilan "' + action + '" ditolak server.'));
      })
      .handleApiRequest(data);
  });
}

document.addEventListener('DOMContentLoaded', function() {
  // Terapkan tema tersimpan secepatnya agar panel tidak berkedip; server
  // menegaskan tema resmi lewat getBootstrapAdmin.
  try {
    var temaTersimpan = localStorage.getItem('siado_tema');
    if (temaTersimpan) document.documentElement.setAttribute('data-theme', temaTersimpan);
  } catch (error) {}
  bindAdminInterface();
  startBrandingSync_();
  if (!terimaHandoffPanel_()) tryRestoreAdminSession();
});

/** Menerapkan tema tampilan pada panel (5 tema profesional). */
function terapkanTemaPanel_() {
  var tema = String(ADMIN.tema || 'navy').toLowerCase();
  try { localStorage.setItem('siado_tema', tema); } catch (error) {}
  document.documentElement.setAttribute('data-theme', tema);
}

/** Daftar tema profesional yang tersedia di panel. */
var DAFTAR_TEMA_ = [
  { id: 'navy', nama: 'Navy Profesional', warna: '#1f6feb', gelap: '#0b1f36' },
  { id: 'emerald', nama: 'Emerald Modern', warna: '#0e9f6e', gelap: '#0b3d2e' },
  { id: 'royal', nama: 'Royal Violet', warna: '#6d28d9', gelap: '#2b1060' },
  { id: 'ocean', nama: 'Ocean Teal', warna: '#0d9488', gelap: '#083344' },
  { id: 'sunset', nama: 'Sunset Coral', warna: '#ea580c', gelap: '#431407' }
];

/** Warna kartu tema (dipakai bila server tidak mengirim kode warnanya). */
function warnaTema_(id) {
  var bawaan = DAFTAR_TEMA_.filter(function(item) { return item.id === String(id).toLowerCase(); })[0];
  return bawaan || { warna: '#1f6feb', gelap: '#0b1f36' };
}

/**
 * PERBAIKAN 3.4: mengisi menu "Tema" pada Pengaturan.
 *
 * Sebelumnya <select id="sTema"> dibiarkan kosong di admin.html dan tidak ada
 * kode yang mengisinya, sehingga 5 pilihan tema tidak pernah muncul. Daftar
 * diambil dari server (result.daftarTema) bila tersedia, dengan cadangan
 * DAFTAR_TEMA_ di sisi panel.
 */
function isiPilihanTema_(temaTerpilih) {
  var pilih = document.getElementById('sTema');
  if (!pilih) return;
  var daftar = (ADMIN.daftarTema && ADMIN.daftarTema.length) ? ADMIN.daftarTema : DAFTAR_TEMA_;
  var aktif = String(temaTerpilih || ADMIN.tema || pilih.value || 'navy').toLowerCase();
  var adaAktif = daftar.some(function(item) { return String(item.id).toLowerCase() === aktif; });
  if (!adaAktif) aktif = String(daftar[0].id).toLowerCase();
  pilih.innerHTML = daftar.map(function(item) {
    var id = String(item.id || '').toLowerCase();
    var nama = escapeAdmin(item.nama || id);
    return '<option value="' + escapeAdmin(id) + '"' + (id === aktif ? ' selected' : '') + '>' + nama + '</option>';
  }).join('');
  pilih.value = aktif;
  gambarKartuTema_(daftar, aktif);
}

/**
 * Menggambar kartu warna tema.
 *
 * PERBAIKAN 3.4b: <select> saja ternyata tidak terlihat jelas di panel
 * (apalagi ketika kosong), sehingga pilihan tema ditampilkan sebagai kartu
 * warna yang dapat diklik. Kartu dan <select> selalu disinkronkan.
 */
function gambarKartuTema_(daftar, aktif) {
  var wadah = document.getElementById('temaGrid');
  if (!wadah) return;
  daftar = (daftar && daftar.length) ? daftar : DAFTAR_TEMA_;
  aktif = String(aktif || ADMIN.tema || 'navy').toLowerCase();
  wadah.innerHTML = daftar.map(function(item) {
    var id = String(item.id || '').toLowerCase();
    var referensi = warnaTema_(id);
    var warna = String(item.warna || referensi.warna);
    var gelap = String(item.gelap || referensi.gelap);
    var terpilih = id === aktif;
    return '<button type="button" class="tema-chip' + (terpilih ? ' aktif' : '') + '"' +
      ' data-tema="' + escapeAdmin(id) + '" role="radio" aria-checked="' + (terpilih ? 'true' : 'false') + '"' +
      ' style="--tema-warna:' + escapeAdmin(warna) + ';--tema-gelap:' + escapeAdmin(gelap) + '">' +
      '<span class="tema-bulat"></span>' +
      '<span class="tema-teks"><span class="tema-nama">' + escapeAdmin(item.nama || id) + '</span>' +
      '<span class="tema-status">' + (terpilih ? 'Sedang dipakai' : 'Pilih tema') + '</span></span>' +
      '<i class="fa-solid fa-circle-check tema-centang"></i></button>';
  }).join('');
}

/** Klik kartu tema: menyorot pilihan, menyamakan select, dan pratinjau langsung. */
function pilihKartuTema_(id) {
  var pilih = document.getElementById('sTema');
  var tema = String(id || '').toLowerCase();
  if (!tema) return;
  if (pilih) pilih.value = tema;
  gambarKartuTema_((ADMIN.daftarTema && ADMIN.daftarTema.length) ? ADMIN.daftarTema : DAFTAR_TEMA_, tema);
  document.documentElement.setAttribute('data-theme', tema);
}

/** Pratinjau tema langsung saat pilihan diganti (belum disimpan ke server). */
function pratinjauTemaAdmin_() {
  var pilih = document.getElementById('sTema');
  if (!pilih || !pilih.value) return;
  pilihKartuTema_(pilih.value);
}

/** Menyimpan tema pilihan admin ke server dan menerapkannya langsung. */
async function simpanTemaAdmin_() {
  var pilih = document.getElementById('sTema');
  if (!pilih) return;
  if (!pilih.value) {
    isiPilihanTema_();
    if (!pilih.value) {
      showToast('Daftar tema belum siap. Muat ulang panel lalu coba lagi.', 'error');
      return;
    }
  }
  try {
    var result = await apiWajib_('simpanTema', { tema: pilih.value });
    ADMIN.tema = result.tema || pilih.value;
    isiPilihanTema_(ADMIN.tema);
    terapkanTemaPanel_();
    showToast(result.message || 'Tema tampilan diterapkan.', 'success');
  } catch (error) {
    // Kembalikan tampilan ke tema resmi bila penyimpanan gagal.
    isiPilihanTema_(ADMIN.tema);
    terapkanTemaPanel_();
    showToast('Tema gagal disimpan: ' + (error.message || ''), 'error');
  }
}

/** Menghapus kode handoff dari address bar agar tidak tersalin/terpakai ulang. */
function bersihkanKodeHandoffUrl_() {
  try {
    if (!window.history || !window.history.replaceState) return;
    var url = new URL(window.location.href);
    if (!url.searchParams.has('hs')) return;
    url.searchParams.delete('hs');
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  } catch (error) {}
}

/**
 * Menerima sesi panel yang dikirim dari halaman login peserta (login terpadu),
 * sehingga pengguna tidak perlu mengetik password dua kali.
 */
function terimaHandoffPanel_() {
  var data = null;

  // 1) Utama: sesi yang disuntikkan server lewat kode sekali pakai (?hs=...).
  //    Cara ini tetap bekerja walau halaman berpindah iframe atau dibuka dari
  //    domain lain seperti GitHub Pages.
  if (typeof SESI_HANDOFF === 'object' && SESI_HANDOFF && SESI_HANDOFF.adminToken) {
    data = SESI_HANDOFF;
    try { SESI_HANDOFF = null; } catch (bekuError) {}
    bersihkanKodeHandoffUrl_();
  }

  // 2) Cadangan: cara lama lewat sessionStorage, untuk pemasangan yang
  //    halaman login dan panelnya berbagi konteks penyimpanan yang sama.
  if (!data) {
    var raw = null;
    try { raw = sessionStorage.getItem('ao_panel_handoff_v1'); } catch (error) { return false; }
    if (!raw) return false;
    try { sessionStorage.removeItem('ao_panel_handoff_v1'); } catch (error) {}
    try { data = JSON.parse(raw); } catch (parseError) { return false; }
  }

  try {
    if (!data || !data.adminToken) return false;
    if (data.expiresAt && new Date(data.expiresAt).getTime() < Date.now()) return false;
    ADMIN.token = data.adminToken;
    ADMIN.username = data.username || '';
    ADMIN.nama = data.nama || data.username || '';
    ADMIN.role = data.role || 'ADMIN';
    saveStoredAdminSession_({ token: ADMIN.token, username: ADMIN.username, nama: ADMIN.nama, role: ADMIN.role });
    // Panel ditampilkan lebih dulu supaya tidak ada kedipan kembali ke layar
    // login sementara data awal masih diambil dari server.
    openAdminPanel_();
    tampilkanMemuatPanel_(true);
    loadAdminBootstrap().catch(function() {
      showToast('Sesi diterima, tetapi data awal belum termuat. Tekan Refresh.', 'error');
    }).then(function() { tampilkanMemuatPanel_(false); });
    return true;
  } catch (error) { return false; }
}

function bindAdminInterface() {
  document.getElementById('adminLoginForm').addEventListener('submit', loginAdminPanel);
  document.getElementById('toggleAdminPassword').addEventListener('click', function() {
    var input = document.getElementById('adminPassword');
    var icon = this.querySelector('i');
    var visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    icon.className = visible ? 'fa-regular fa-eye' : 'fa-regular fa-eye-slash';
    this.setAttribute('aria-label', visible ? 'Tampilkan password' : 'Sembunyikan password');
  });
  document.getElementById('adminLogoutButton').addEventListener('click', adminLogout);
  bindPasswordToggle('toggleParticipantNewPassword', 'sPassPeserta', 'password peserta');
  bindPasswordToggle('toggleNewAdminPassword', 'sNewAdminPass', 'password admin baru');
  bindPasswordToggle('toggleConfirmAdminPassword', 'sConfirmAdminPass', 'konfirmasi password admin');

  document.querySelectorAll('.sidebar-link').forEach(function(button) {
    button.addEventListener('click', function() {
      switchAdminTab(this.dataset.tab);
      closeSidebarMobile_();
    });
  });
  var sidebarToggle = document.getElementById('sidebarToggle');
  if (sidebarToggle) sidebarToggle.addEventListener('click', toggleSidebarMobile_);
  var backdrop = document.getElementById('sidebarBackdrop');
  if (backdrop) backdrop.addEventListener('click', closeSidebarMobile_);
  var notifButton = document.getElementById('notifButton');
  if (notifButton) notifButton.addEventListener('click', function() { switchAdminTab('notifikasi'); });

  // Sakelar "Peserta ujian" membawa pengguna kembali ke halaman ujian.
  var modePeserta = document.getElementById('modePeserta');
  if (modePeserta) modePeserta.addEventListener('change', function() {
    if (!this.checked) return;
    var target = urlAplikasiAdmin_('');
    if (!target) {
      this.checked = false;
      setAdminLoginMessage('Alamat halaman peserta tidak dapat ditentukan. Muat ulang halaman lalu coba lagi.', 'error');
      return;
    }
    setAdminLoginMessage('Membuka halaman login peserta...', 'success');
    // Di dalam pembungkus cukup ganti isi bingkai; navigasi lintas domain diblokir.
    if (mintaPembungkusPindahAdmin_(
        (typeof APP_WEB_URL === 'string' ? APP_WEB_URL : ''), '')) {
      window.setTimeout(function() { pindahHalamanAdmin_(target); }, 1200);
      return;
    }
    pindahHalamanAdmin_(target);
  });
  document.getElementById('refreshSoal').addEventListener('click', buatRefresh_('Daftar soal', loadQuestions, function() { return (ADMIN.questions || []).length; }));
  document.getElementById('refreshMonitor').addEventListener('click', buatRefresh_('Monitor peserta', loadMonitor));
  document.getElementById('refreshPelanggaran').addEventListener('click', buatRefresh_('Data pelanggaran', loadViolations));
  bindClick_('refreshDiskualifikasi', buatRefresh_('Daftar diskualifikasi', loadDisqualified));
  bindClick_('pulihkanSemuaDq', pulihkanSemuaPeserta);
  bindClick_('resetDataDq', resetDataDiskualifikasi);
  document.getElementById('refreshHasil').addEventListener('click', buatRefresh_('Hasil ujian', loadResults));
  document.getElementById('refreshUraian').addEventListener('click', buatRefresh_('Nilai uraian', loadEssays));
  document.getElementById('refreshRekap').addEventListener('click', buatRefresh_('Rekap kelas', loadRecap));
  document.getElementById('filterHasilKelas').addEventListener('input', debounce(function() { loadResults(); }, 450));
  document.getElementById('filterUraianKelas').addEventListener('input', debounce(function() { loadEssays(); }, 450));
  document.getElementById('filterUraianPending').addEventListener('change', loadEssays);
  // Pencarian sisi klien: langsung menyaring data yang sudah termuat.
  ikatFilter_('cariSoal', 'input', terapkanFilterSoal_, true);
  ikatFilter_('filterSoalTipe', 'change', terapkanFilterSoal_, false);
  ikatFilter_('filterSoalStatus', 'change', terapkanFilterSoal_, false);
  // Dropdown "Kelas sasaran" pada Bank Soal: penyaringan per soal di sisi klien.
  ikatFilter_('filterSoalTingkat', 'change', terapkanFilterSoal_, false);
  // REVISI 2 mapel: filter mapel pada Bank Soal, Monitor, dan Hasil.
  ikatFilter_('filterSoalMapel', 'change', terapkanFilterSoal_, false);
  ikatFilter_('filterMonitorMapel', 'change', terapkanFilterMonitor_, false);
  ikatFilter_('filterHasilMapel', 'change', terapkanFilterHasil_, false);
  ikatFilter_('cariMonitor', 'input', terapkanFilterMonitor_, true);
  ikatFilter_('cariPelanggaran', 'input', terapkanFilterPelanggaran_, true);
  ikatFilter_('cariHasil', 'input', terapkanFilterHasil_, true);
  ikatFilter_('cariUraian', 'input', terapkanFilterUraian_, true);
  ikatFilter_('cariRekap', 'input', terapkanFilterRekap_, true);
  ikatFilter_('cariPeserta', 'input', terapkanFilterPeserta_, true);
  ikatFilter_('filterPesertaKehadiran', 'change', terapkanFilterPeserta_, false);
  ikatFilter_('cariGuru', 'input', terapkanFilterGuru_, true);
  ikatFilter_('cariKartuSoal', 'input', terapkanFilterKartuSoal_, true);
  ikatFilter_('filterKartuLengkap', 'change', terapkanFilterKartuSoal_, false);
  // Kartu Soal
  bindClick_('refreshKartuSoal', buatRefresh_('Kartu soal', loadKartuSoal, function() { return KARTU_SOAL.data.length; }));
  bindClick_('closeKartuSoal', tutupKartuSoal_);
  bindClick_('batalKartuSoal', tutupKartuSoal_);
  bindSubmit_('kartuSoalForm', simpanKartuSoal_);
  document.getElementById('clearViolationHistory').addEventListener('click', clearViolationHistory);
  document.getElementById('clearEssayHistory').addEventListener('click', clearEssayHistory);
  document.getElementById('clearRecapHistory').addEventListener('click', clearRecapHistory);
  document.getElementById('resetDefaultButton').addEventListener('click', resetDefaultSettings);

  // Kelola soal: status massal dan import
  bindClick_('deactivateAllQuestions', function() { setAllQuestionStatus(false); });
  bindClick_('activateAllQuestions', function() { setAllQuestionStatus(true); });
  bindClick_('importSoalButton', importSoalDariFile);
  bindClick_('downloadTemplateSoal', unduhTemplateSoal);

  // Export laporan
  bindClick_('exportExcel', function() { exportLaporanFile('excel'); });
  bindClick_('exportPdf', function() { exportLaporanFile('pdf'); });

  // Notifikasi
  bindClick_('refreshNotif', buatRefresh_('Notifikasi', loadNotifications));
  bindClick_('markAllNotif', function() { markNotificationsRead(''); });
  bindClick_('clearNotif', clearAllNotifications);

  // Akun guru mapel
  bindSubmit_('teacherForm', createTeacher);
  bindClick_('refreshGuru', buatRefresh_('Akun guru', loadTeachers, function() { return (ADMIN.teachers || []).length; }));
  bindPasswordToggle('toggleTeacherPassword', 'gPassword', 'password guru');

  // Data peserta dan rombel
  bindSubmit_('rombelForm', saveRombel);
  bindSubmit_('participantForm', createParticipant);
  // Refresh Data Peserta SELALU memaksa pemuatan ulang (tidak di-skip saat
  // permintaan sebelumnya masih berjalan) — diperbaiki putaran 8.
  bindClick_('refreshPeserta', buatRefresh_('Data peserta', function() { return loadParticipants(); }, function() { return (ADMIN.participants || []).length; }));
  bindClick_('generateToken', function() {
    document.getElementById('rToken').value = buatTokenAcak_();
    showToast('Token acak dibuat. Simpan rombel untuk menerapkannya.', 'info');
  });
  bindClick_('importPesertaButton', importPesertaDariFile);
  bindClick_('downloadTemplatePeserta', unduhTemplatePeserta);
  // Modal ubah peserta dan ubah akun guru.
  bindClick_('closeEditPeserta', tutupEditPeserta_);
  bindClick_('batalEditPeserta', tutupEditPeserta_);
  bindSubmit_('editParticipantForm', simpanEditPeserta_);
  bindClick_('closeKehadiran', tutupKehadiran_);
  bindClick_('batalKehadiran', tutupKehadiran_);
  bindSubmit_('kehadiranForm', simpanKehadiran_);
  bindClick_('closeEditGuru', tutupEditGuru_);
  bindClick_('batalEditGuru', tutupEditGuru_);
  bindSubmit_('editTeacherForm', simpanEditGuru_);
  bindPasswordToggle('toggleEgPassword', 'egPassword', 'password guru');
  // REVISI 6: preview username sesuai yang diketik admin/guru.
  var pNama = document.getElementById('pNama');
  var pUsername = document.getElementById('pUsername');
  var pUsernamePreview = document.getElementById('pUsernamePreview');
  if (pUsername && pUsernamePreview) {
    pUsername.addEventListener('input', function() {
      var nilai = this.value.trim();
      pUsernamePreview.textContent = nilai
        ? 'Username login peserta: ' + nilai.toLowerCase().replace(/\s+/g, '').replace(/\./g, '')
        : 'Aturan: huruf kecil, tanpa spasi, tanpa titik; angka dan simbol _ / - boleh.';
    });
  }
  if (pNama) pNama.addEventListener('input', function() {
    if (!pUsername || !pUsername.value.trim()) {
      var depan = namaDepanKlien_(this.value);
      if (pUsernamePreview) pUsernamePreview.innerHTML = depan ?
        'Username peserta: <b>' + escapeAdmin(depan) + '</b>' :
        'Aturan: huruf kecil, tanpa spasi, tanpa titik; angka dan simbol _ / - boleh.';
    }
  });
  var filterRombel = document.getElementById('filterPesertaRombel');
  if (filterRombel) filterRombel.addEventListener('change', function() { loadParticipants(); });

  // Nilai uraian massal
  bindClick_('saveAllEssayScores', saveAllEssayScores);
  // Peringatan bila admin menutup/memuat ulang halaman padahal masih ada
  // nilai uraian yang diketik tetapi belum disimpan.
  window.addEventListener('beforeunload', function(event) {
    if (!Object.keys(ADMIN.essayDrafts || {}).length) return;
    event.preventDefault();
    event.returnValue = '';
  });

  // Password sendiri

  // Background login
  document.querySelectorAll('[data-bg-tab]').forEach(function(button) {
    button.addEventListener('click', function() {
      document.querySelectorAll('[data-bg-tab]').forEach(function(item) { item.classList.remove('active'); });
      this.classList.add('active');
      var target = this.dataset.bgTab;
      document.querySelectorAll('[data-bg-panel]').forEach(function(panel) {
        panel.classList.toggle('show', panel.dataset.bgPanel === target);
      });
    });
  });
  bindClick_('applyBgImage', applyBackgroundImage);
  bindClick_('resetBgImage', resetBackgroundImage);

  // Uploader media soal
  initMediaBoxes_();

  // Dialog terpusat untuk konfirmasi, isian, dan notifikasi hasil aksi.
  bindDialogTerpusat_();
  document.getElementById('brandingLogoForm').addEventListener('submit', updateBrandingLogo);
  document.getElementById('brandingLogoFile').addEventListener('change', previewSelectedBrandingLogo_);
  document.getElementById('resetBrandingLogo').addEventListener('click', resetBrandingLogo);

  document.getElementById('addQuestionForm').addEventListener('submit', function(event) { event.preventDefault(); saveNewQuestion(); });
  document.getElementById('editQuestionForm').addEventListener('submit', function(event) { event.preventDefault(); saveEditedQuestion(); });
  document.getElementById('btnTerapkanDurasi').addEventListener('click', terapkanDurasiRealtime);
  var btnResetSatu = document.getElementById('btnResetWaktuPeserta');
  if (btnResetSatu) btnResetSatu.addEventListener('click', resetWaktuSatuPeserta_);
  var btnResetSemua = document.getElementById('btnResetWaktuSemua');
  if (btnResetSemua) btnResetSemua.addEventListener('click', resetWaktuSemuaPeserta_);
  // PERBAIKAN 3.4: isi 5 pilihan tema segera saat panel dibuka, lalu
  // pratinjau langsung ketika pilihan diganti.
  isiPilihanTema_();
  var pilihTema = document.getElementById('sTema');
  if (pilihTema) pilihTema.addEventListener('change', pratinjauTemaAdmin_);
  var gridTema = document.getElementById('temaGrid');
  if (gridTema) gridTema.addEventListener('click', function(event) {
    var kartu = event.target && event.target.closest ? event.target.closest('.tema-chip') : null;
    if (!kartu) return;
    pilihKartuTema_(kartu.getAttribute('data-tema'));
  });
  var btnTema = document.getElementById('btnSimpanTema');
  if (btnTema) btnTema.addEventListener('click', simpanTemaAdmin_);
  document.getElementById('closeEditModal').addEventListener('click', closeEditQuestion);
  document.getElementById('cancelEdit').addEventListener('click', closeEditQuestion);
  document.getElementById('settingsForm').addEventListener('submit', function(event) { event.preventDefault(); saveSettings(); });
  // REVISI 2 mapel: dropdown mapel aktif + kotak ketik manual.
  var pilihMapelAktif = document.getElementById('sMapel');
  if (pilihMapelAktif) pilihMapelAktif.addEventListener('change', function() {
    tampilManualMapel_(pilihMapelAktif.value === MAPEL_MANUAL_);
    perbaruiInfoMapelSoal_();
    perbaruiInfoBatasKelasGuru_();
  });
  var ketikMapelManual = document.getElementById('sMapelManual');
  if (ketikMapelManual) ketikMapelManual.addEventListener('input', debounce(perbaruiInfoMapelSoal_, 180));
  // REVISI batas kelas: label dinamis + tombol pilih semua/bersihkan.
  ['gMapel1', 'gMapel2', 'egMapel1', 'egMapel2'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', perbaruiLabelKelasGuru_);
  });
  document.querySelectorAll('[data-pilih-semua]').forEach(function(b) {
    b.addEventListener('click', function() {
      var box = document.getElementById(b.dataset.pilihSemua);
      if (box) box.querySelectorAll('input[type="checkbox"]').forEach(function(c) { c.checked = true; });
    });
  });
  document.querySelectorAll('[data-bersihkan]').forEach(function(b) {
    b.addEventListener('click', function() {
      var box = document.getElementById(b.dataset.bersihkan);
      if (box) box.querySelectorAll('input[type="checkbox"]').forEach(function(c) { c.checked = false; });
    });
  });

  // Judul besar ujian mengikuti jenis ujian, semester, dan tahun ajaran
  // secara langsung, sehingga operator melihat hasilnya sebelum menyimpan.
  ['sJenisUjian', 'sSemester', 'sTahunAjaran'].forEach(function(id) {
    var kolom = document.getElementById(id);
    if (!kolom) return;
    kolom.addEventListener('input', perbaruiJudulUjian_);
    kolom.addEventListener('change', perbaruiJudulUjian_);
  });
  document.getElementById('adminCredentialForm').addEventListener('submit', function(event) { event.preventDefault(); changeAdminCredential(); });

  ['f', 'e'].forEach(function(prefix) {
    document.getElementById(prefix + 'Tipe').addEventListener('change', function() { updateQuestionFormatHelp(prefix); });
    var kolomOpsi = document.getElementById(prefix + 'Opsi');
    // Kunci menjodohkan mengikuti isi kolom pasangan secara langsung.
    if (kolomOpsi) kolomOpsi.addEventListener('input', function() { perbaruiKunciJodoh_(prefix); });
    // REVISI RUMUS 2026-09-24: tempelan dari Word (OMML) atau AI (LaTeX
    // $...$ / \frac{...} / MathJax) di kolom Opsi & Kunci otomatis diubah
    // menjadi rumus $latex$ sehingga ter-render rapi saat tampil.
    ['Opsi', 'Kunci'].forEach(function(col) {
      var el = document.getElementById(prefix + col);
      if (!el) return;
      el.addEventListener('paste', function(event) {
        var cd = event.clipboardData || window.clipboardData;
        if (!cd || !window.SRich) return;
        var hasil = SRich.plainFieldPaste(String(cd.getData('text/html') || ''), String(cd.getData('text/plain') || ''));
        if (!hasil.changed) return; // tempelan biasa: biarkan browser
        event.preventDefault();
        el.focus();
        var ok = false;
        try { ok = document.execCommand('insertText', false, hasil.text); } catch (err) { ok = false; }
        if (!ok) {
          var s = el.selectionStart == null ? el.value.length : el.selectionStart;
          var en = el.selectionEnd == null ? s : el.selectionEnd;
          el.value = el.value.slice(0, s) + hasil.text + el.value.slice(en);
          el.selectionStart = el.selectionEnd = s + hasil.text.length;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
    updateQuestionFormatHelp(prefix);
  });
  bindClick_('ePreviewMedia', previewEditMedia);

  // REVISI 4.0: editor rich text pertanyaan + editor terstruktur
  // PGK Kategori & Menjodohkan + hapus seluruh bank soal.
  RTE_PERTANYAAN.f = SRich.mountEditor(document.getElementById('fPertanyaanRte'), {
    placeholder: 'Tulis pertanyaan. Dukung tebal, miring, garis bawah, coret, tabel, grafik, gambar, dan rumus.',
    maxlength: 12000,
    onChange: function() { document.getElementById('fPertanyaan').value = RTE_PERTANYAAN.f.getHtml(); }
  });
  RTE_PERTANYAAN.e = SRich.mountEditor(document.getElementById('ePertanyaanRte'), {
    placeholder: 'Tulis pertanyaan...',
    maxlength: 12000,
    onChange: function() { document.getElementById('ePertanyaan').value = RTE_PERTANYAAN.e.getHtml(); }
  });
  resetPgkEditor('f', null);
  resetJodohEditor('f', null);
  bindClick_('fPgkAddRow', function() { pgkAddRow('f', '', ''); perbaruiKunciPgk_('f'); perbaruiPratinjauPgk_('f'); });
  bindClick_('ePgkAddRow', function() { pgkAddRow('e', '', ''); perbaruiKunciPgk_('e'); perbaruiPratinjauPgk_('e'); });
  bindClick_('fJodohAddRow', function() { jodohAddRow('f', '', ''); });
  bindClick_('eJodohAddRow', function() { jodohAddRow('e', '', ''); });
  bindClick_('deleteAllQuestions', deleteAllQuestions);
}

/* ==================================================================
 * DIALOG TERPUSAT
 * Mengganti window.confirm / window.prompt bawaan browser dengan kotak
 * dialog di tengah layar, sehingga setiap aksi simpan, ubah, dan hapus
 * memberi umpan balik yang konsisten dan mudah dibaca.
 * ================================================================== */
var DIALOG_STATE = { resolve: null, mode: 'confirm' };

function dialogElemen_() {
  return {
    root: document.getElementById('appDialog'),
    icon: document.getElementById('appDialogIcon'),
    judul: document.getElementById('appDialogTitle'),
    pesan: document.getElementById('appDialogMessage'),
    wrap: document.getElementById('appDialogFieldWrap'),
    label: document.getElementById('appDialogLabel'),
    input: document.getElementById('appDialogInput'),
    hint: document.getElementById('appDialogHint'),
    ok: document.getElementById('appDialogOk'),
    cancel: document.getElementById('appDialogCancel')
  };
}

function tutupDialog_(hasil) {
  var el = dialogElemen_();
  if (!el.root) return;
  el.root.classList.remove('show');
  var selesai = DIALOG_STATE.resolve;
  DIALOG_STATE.resolve = null;
  if (selesai) selesai(hasil);
}

/**
 * Menampilkan dialog. Mengembalikan Promise berisi:
 * - mode 'confirm' / 'info' : true bila ditekan tombol utama, false bila batal
 * - mode 'prompt'           : teks isian, atau null bila batal
 */
function bukaDialog_(opsi) {
  var el = dialogElemen_();
  if (!el.root) {
    // Cadangan bila markup dialog tidak tersedia.
    if (opsi.mode === 'prompt') return Promise.resolve(window.prompt(opsi.pesan, opsi.nilaiAwal || ''));
    if (opsi.mode === 'info') return Promise.resolve(true);
    return Promise.resolve(window.confirm(opsi.pesan));
  }

  DIALOG_STATE.mode = opsi.mode || 'confirm';
  var nada = opsi.nada || 'info';
  var ikon = { info: 'fa-circle-question', warn: 'fa-triangle-exclamation',
               danger: 'fa-trash-can', success: 'fa-circle-check' }[nada] || 'fa-circle-question';

  el.icon.className = 'app-dialog-icon ' + (nada === 'info' ? '' : nada);
  el.icon.innerHTML = '<i class="fa-solid ' + ikon + '"></i>';
  el.judul.textContent = opsi.judul || 'Konfirmasi';
  el.pesan.innerHTML = opsi.pesanHtml || escapeAdmin(opsi.pesan || '');

  var pakaiInput = DIALOG_STATE.mode === 'prompt';
  el.wrap.classList.toggle('show', pakaiInput);
  if (pakaiInput) {
    el.label.textContent = opsi.label || 'Masukkan nilai';
    el.input.type = opsi.tipeInput || 'text';
    el.input.value = opsi.nilaiAwal || '';
    el.input.placeholder = opsi.placeholder || '';
    el.hint.textContent = opsi.hint || '';
  }

  el.ok.textContent = opsi.teksOk || (DIALOG_STATE.mode === 'info' ? 'Mengerti' : 'Ya, Lanjutkan');
  el.ok.className = (nada === 'danger' || nada === 'warn') ? 'admin-danger' : 'admin-primary';
  el.cancel.style.display = DIALOG_STATE.mode === 'info' ? 'none' : '';
  el.cancel.textContent = opsi.teksBatal || 'Batal';

  el.root.classList.add('show');
  window.setTimeout(function() {
    if (pakaiInput) { el.input.focus(); el.input.select(); } else { el.ok.focus(); }
  }, 60);

  return new Promise(function(resolve) { DIALOG_STATE.resolve = resolve; });
}

/** Konfirmasi ya/tidak di tengah layar. */
function konfirmasi_(pesan, opsi) {
  opsi = opsi || {};
  return bukaDialog_({
    mode: 'confirm', pesan: pesan,
    judul: opsi.judul || 'Konfirmasi Tindakan',
    nada: opsi.nada || 'warn',
    teksOk: opsi.teksOk || 'Ya, Lanjutkan',
    teksBatal: opsi.teksBatal || 'Batal'
  });
}

/** Isian teks di tengah layar. Mengembalikan null bila dibatalkan. */
function tanya_(pesan, opsi) {
  opsi = opsi || {};
  return bukaDialog_({
    mode: 'prompt', pesan: pesan,
    judul: opsi.judul || 'Masukkan Data',
    nada: opsi.nada || 'info',
    label: opsi.label, nilaiAwal: opsi.nilaiAwal,
    placeholder: opsi.placeholder, hint: opsi.hint,
    tipeInput: opsi.tipeInput,
    teksOk: opsi.teksOk || 'Simpan'
  });
}

/** Notifikasi hasil aksi di tengah layar. */
function beritahu_(pesan, opsi) {
  opsi = opsi || {};
  return bukaDialog_({
    mode: 'info', pesan: pesan,
    judul: opsi.judul || 'Berhasil',
    nada: opsi.nada || 'success',
    teksOk: opsi.teksOk || 'Mengerti'
  });
}

/**
 * ============ v4.9: LAPISAN AKSI TERPUSAT ============
 * Menyatukan pola "konfirmasi -> jalankan -> tampilkan hasil" agar seluruh
 * tombol panel memberi umpan balik yang sama rapinya, termasuk saat gagal.
 */

/** Kotak hasil sukses dengan rincian opsional berbentuk daftar. */
function hasilSukses_(judul, pesan, rincian) {
  return bukaDialog_({
    mode: 'info', nada: 'success', judul: judul || 'Berhasil',
    pesanHtml: susunPesanDialog_(pesan, rincian),
    teksOk: 'Selesai'
  });
}

/** Kotak hasil gagal. Dipakai juga saat server menolak permintaan. */
function hasilGagal_(judul, pesan, rincian) {
  return bukaDialog_({
    mode: 'info', nada: 'danger', judul: judul || 'Tindakan Gagal',
    pesanHtml: susunPesanDialog_(pesan, rincian),
    teksOk: 'Tutup'
  });
}

/** Kotak pemberitahuan netral, misalnya ketika data tidak ditemukan. */
function hasilInfo_(judul, pesan, rincian) {
  return bukaDialog_({
    mode: 'info', nada: 'info', judul: judul || 'Informasi',
    pesanHtml: susunPesanDialog_(pesan, rincian),
    teksOk: 'Mengerti'
  });
}

/** Menyusun isi dialog: satu paragraf pesan plus daftar rincian bila ada. */
function susunPesanDialog_(pesan, rincian) {
  var html = '<span class="dialog-text">' + escapeAdmin(pesan || '') + '</span>';
  var daftar = (rincian || []).filter(function(baris) { return baris; });
  if (daftar.length) {
    html += '<ul class="dialog-list">';
    daftar.forEach(function(baris) {
      if (baris && typeof baris === 'object') {
        html += '<li><span>' + escapeAdmin(baris.label) + '</span><b>' + escapeAdmin(baris.nilai) + '</b></li>';
      } else {
        html += '<li><span>' + escapeAdmin(baris) + '</span></li>';
      }
    });
    html += '</ul>';
  }
  return html;
}

/**
 * Menjalankan satu aksi panel dengan alur yang seragam.
 *
 * opsi:
 *   konfirmasi   - teks konfirmasi; bila diisi, dialog muncul lebih dulu
 *   judulKonfirm - judul kotak konfirmasi
 *   nada         - 'warn' (bawaan) atau 'danger' untuk aksi merusak
 *   teksOk       - label tombol utama pada kotak konfirmasi
 *   jalankan     - fungsi async berisi pekerjaan sesungguhnya
 *   judulSukses  - judul kotak hasil
 *   pesanSukses  - teks/fungsi(hasil) untuk kotak hasil
 *   rincian      - array/fungsi(hasil) berisi baris rincian
 *   sesudah      - fungsi async yang dijalankan setelah sukses (refresh data)
 *   diamBilaSukses - true bila tidak perlu kotak hasil (mis. aksi beruntun)
 *
 * Mengembalikan hasil aksi, atau null bila dibatalkan/gagal.
 */
async function aksiPanel_(opsi) {
  if (opsi.konfirmasi) {
    var setuju = await konfirmasi_(opsi.konfirmasi, {
      judul: opsi.judulKonfirm || 'Konfirmasi Tindakan',
      nada: opsi.nada || 'warn',
      teksOk: opsi.teksOk || 'Ya, Lanjutkan'
    });
    if (!setuju) return null;
  }

  try {
    var hasil = await opsi.jalankan();
    // Aksi boleh membatalkan diri sendiri secara sengaja.
    if (hasil && hasil.__batal) return null;

    if (opsi.sesudah) await opsi.sesudah(hasil);

    if (!opsi.diamBilaSukses) {
      var pesan = typeof opsi.pesanSukses === 'function' ? opsi.pesanSukses(hasil) : opsi.pesanSukses;
      var rincian = typeof opsi.rincian === 'function' ? opsi.rincian(hasil) : opsi.rincian;
      await hasilSukses_(opsi.judulSukses, pesan || 'Tindakan berhasil dijalankan.', rincian);
    }
    return hasil;
  } catch (error) {
    await hasilGagal_(opsi.judulGagal || 'Tindakan Gagal',
      (error && error.message) || 'Terjadi kesalahan yang tidak diketahui.');
    return null;
  }
}

/**
 * Memanggil API panel dan melempar Error bila server menolak, sehingga
 * aksiPanel_ dapat menampilkannya sebagai kotak gagal.
 */
async function apiWajib_(action, payload) {
  var hasil = await adminApi(action, payload);
  if (!guardAdminResult(hasil)) {
    var pesan = (hasil && hasil.message) || 'Permintaan ditolak server.';
    var salah = new Error(pesan);
    salah.__sudahDitangani = !!(hasil && hasil.adminSessionInvalid);
    throw salah;
  }
  return hasil;
}

function bindDialogTerpusat_() {
  var el = dialogElemen_();
  if (!el.root) return;
  el.ok.addEventListener('click', function() {
    if (DIALOG_STATE.mode === 'prompt') tutupDialog_(el.input.value);
    else tutupDialog_(true);
  });
  el.cancel.addEventListener('click', function() {
    tutupDialog_(DIALOG_STATE.mode === 'prompt' ? null : false);
  });
  el.root.addEventListener('click', function(event) {
    if (event.target === el.root) tutupDialog_(DIALOG_STATE.mode === 'prompt' ? null : false);
  });
  el.input.addEventListener('keydown', function(event) {
    if (event.key === 'Enter') { event.preventDefault(); tutupDialog_(el.input.value); }
  });
  document.addEventListener('keydown', function(event) {
    if (event.key !== 'Escape' || !el.root.classList.contains('show')) return;
    tutupDialog_(DIALOG_STATE.mode === 'prompt' ? null : false);
  });
}

/**
 * URL Web App yang sebenarnya untuk panel.
 *
 * Di iframe Apps Script, window.location menunjuk ke alamat internal
 * googleusercontent (.../userCodeAppPanel). Membuka alamat itu menghasilkan
 * layar putih, jadi URL asli selalu diambil dari APP_WEB_URL milik server.
 */
function urlAplikasiAdmin_(halaman) {
  var publik = (typeof APP_PUBLIC_URL === 'string' && APP_PUBLIC_URL) ? APP_PUBLIC_URL : '';
  if (publik) {
    if (!halaman) return publik;
    return publik + (publik.indexOf('?') === -1 ? '?' : '&') + 'page=' + halaman;
  }
  var dasar = (typeof APP_WEB_URL === 'string' && APP_WEB_URL) ? APP_WEB_URL : '';
  if (!dasar) {
    var sekarang = String(window.location.href).split('?')[0];
    dasar = /userCodeAppPanel|googleusercontent/i.test(sekarang) ? '' : sekarang;
  }
  if (!dasar) return '';
  return halaman ? (dasar + '?page=' + halaman) : dasar;
}

/** Berpindah halaman dari dalam iframe Apps Script lewat anchor _top. */
/** Apakah panel berjalan di dalam pembungkus (GitHub Pages)? */
function adaPembungkusAdmin_() {
  return !!(typeof APP_PUBLIC_URL === 'string' && APP_PUBLIC_URL);
}

/** Meminta pembungkus mengganti isi bingkainya sendiri. */
function mintaPembungkusPindahAdmin_(targetApp, halaman) {
  if (!adaPembungkusAdmin_()) return false;
  try {
    window.parent.postMessage({
      sumber: 'siado', aksi: 'pindah',
      halaman: halaman || '', url: targetApp || ''
    }, '*');
    return true;
  } catch (error) { return false; }
}

function pindahHalamanAdmin_(target) {
  if (!target) return false;
  var anchor = document.createElement('a');
  anchor.href = target;
  anchor.target = '_top';
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  try { anchor.click(); } catch (error) {}
  window.setTimeout(function() {
    if (anchor.parentNode) anchor.parentNode.removeChild(anchor);
  }, 4000);
  return true;
}

function bindClick_(id, handler) {
  var element = document.getElementById(id);
  if (element) element.addEventListener('click', handler);
}

function bindSubmit_(id, handler) {
  var form = document.getElementById(id);
  if (form) form.addEventListener('submit', function(event) { event.preventDefault(); handler(); });
}

function toggleSidebarMobile_() {
  document.getElementById('adminSidebar').classList.toggle('open');
  document.getElementById('sidebarBackdrop').classList.toggle('show');
}

function closeSidebarMobile_() {
  document.getElementById('adminSidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('show');
}

function buatTokenAcak_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var output = '';
  for (var i = 0; i < 8; i++) output += chars.charAt(Math.floor(Math.random() * chars.length));
  return output;
}

function namaDepanKlien_(nama) {
  var text = String(nama || '').trim();
  if (!text) return '';
  return text.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '');
}

function bindPasswordToggle(buttonId, inputId, label) {
  var button = document.getElementById(buttonId);
  var input = document.getElementById(inputId);
  if (!button || !input) return;
  button.addEventListener('click', function() {
    var currentlyVisible = input.type === 'text';
    input.type = currentlyVisible ? 'password' : 'text';
    this.querySelector('i').className = currentlyVisible ? 'fa-regular fa-eye' : 'fa-regular fa-eye-slash';
    this.setAttribute('aria-label', (currentlyVisible ? 'Tampilkan ' : 'Sembunyikan ') + label);
  });
}

function resetPasswordVisibility(inputId, buttonId, label) {
  var input = document.getElementById(inputId);
  var button = document.getElementById(buttonId);
  if (input) input.type = 'password';
  if (button) {
    button.querySelector('i').className = 'fa-regular fa-eye';
    button.setAttribute('aria-label', 'Tampilkan ' + label);
  }
}

function clearAdminLoginFields_() {
  document.getElementById('adminUsername').value = '';
  document.getElementById('adminPassword').value = '';
  resetPasswordVisibility('adminPassword', 'toggleAdminPassword', 'password admin');
}

/**
 * Menandai panel sedang mengambil data awal.
 *
 * Panel sudah tampil lebih dulu agar tidak berkedip ke layar login, sehingga
 * pengguna tetap perlu tahu bahwa isinya masih dimuat.
 */
function tampilkanMemuatPanel_(sedangMemuat) {
  var shell = document.getElementById('adminShell');
  if (shell) shell.classList.toggle('panel-memuat', !!sedangMemuat);
  var judul = document.getElementById('topbarSubtitle');
  if (!judul) return;
  if (sedangMemuat) {
    judul.dataset.teksAsli = judul.dataset.teksAsli || judul.textContent;
    judul.textContent = 'Memuat data panel...';
  } else if (judul.dataset.teksAsli !== undefined) {
    judul.textContent = judul.dataset.teksAsli;
    delete judul.dataset.teksAsli;
  }
}

function openAdminPanel_() {
  document.getElementById('adminUserDisplay').textContent = ADMIN.nama || ADMIN.username;
  terapkanHakAkses_();
  clearAdminLoginFields_();
  document.getElementById('adminLoginPage').style.display = 'none';
  document.getElementById('adminShell').classList.add('show');
  setAdminLoginMessage('', '');
  startAdminAutoRefresh();
  loadNotifications();
}

function terapkanHakAkses_() {
  ADMIN.isAdmin = String(ADMIN.role || 'ADMIN').toUpperCase() === 'ADMIN';
  document.getElementById('sidebarUserName').textContent = ADMIN.nama || ADMIN.username;
  var roleChip = document.getElementById('sidebarUserRole');
  roleChip.textContent = ADMIN.isAdmin ? 'PROKTOR / ADMIN' : 'GURU MAPEL';
  roleChip.classList.toggle('guru', !ADMIN.isAdmin);
  // Menu dan kartu bertanda data-admin hanya untuk proktor/admin.
  document.querySelectorAll('[data-admin="true"]').forEach(function(element) {
    element.classList.toggle('role-locked', !ADMIN.isAdmin);
  });
  document.querySelectorAll('.admin-only-action').forEach(function(element) {
    element.classList.toggle('role-locked', !ADMIN.isAdmin);
  });
  if (!ADMIN.isAdmin && (ADMIN.activeTab === 'pengguna')) switchAdminTab('soal');
}

async function tryRestoreAdminSession() {
  var raw = getStoredAdminSession_();
  if (!raw) return;
  try {
    var saved;
    try {
      saved = JSON.parse(raw);
      if (!saved.token || !saved.username) throw new Error('Data sesi tidak lengkap.');
    } catch (storageError) {
      storageError.adminSessionInvalid = true;
      throw storageError;
    }
    ADMIN.token = saved.token;
    ADMIN.username = saved.username;
    ADMIN.nama = saved.nama || saved.username;
    ADMIN.role = saved.role || 'ADMIN';
    setAdminLoginMessage('Memulihkan sesi panel...', 'success');
    // Panel langsung dibuka agar pengguna tidak melihat layar login berkedip.
    // Bila token ternyata sudah tidak berlaku, blok catch akan menutupnya lagi.
    openAdminPanel_();
    tampilkanMemuatPanel_(true);
    var restored = false;
    try {
      restored = await loadAdminBootstrap();
    } finally {
      tampilkanMemuatPanel_(false);
    }
    if (!restored) throw new Error('Sesi tidak dapat dipulihkan.');
    // Migrasikan sesi lama/sessionStorage ke localStorage agar refresh tidak logout.
    saveStoredAdminSession_({ token: ADMIN.token, username: ADMIN.username, nama: ADMIN.nama, role: ADMIN.role });
  } catch (error) {
    if (error && error.adminSessionInvalid) {
      ADMIN.token = '';
      ADMIN.username = '';
      clearStoredAdminSession_();
      clearAdminLoginFields_();
      setAdminLoginMessage('Sesi sebelumnya telah berakhir. Silakan login kembali.', 'error');
      return;
    }
    // Gangguan jaringan/server sementara tidak boleh dianggap sebagai logout.
    // Token tetap disimpan dan panel akan mencoba memuat data lagi melalui auto-refresh.
    openAdminPanel_();
    showToast('Sesi admin tetap aktif, tetapi data belum dapat dimuat. Periksa koneksi lalu coba refresh.', 'error');
  }
}

async function loginAdminPanel(event) {
  event.preventDefault();
  var username = document.getElementById('adminUsername').value.trim();
  var password = document.getElementById('adminPassword').value;
  if (!username || !password) {
    setAdminLoginMessage('Username dan password admin wajib diisi.', 'error');
    return;
  }
  document.getElementById('adminLoginButton').disabled = true;
  try {
    var result = await adminApi('loginTerpadu', { username: username, password: password });
    if (!result.success) {
      setAdminLoginMessage(result.message || 'Login gagal.', 'error');
      // REVISI 6: bila salah, kolom dikosongkan kembali (default) dan tidak
      // ada petunjuk username/password yang benar.
      document.getElementById('adminUsername').value = '';
      document.getElementById('adminPassword').value = '';
      document.getElementById('adminUsername').focus();
      return;
    }
    if (result.tipe === 'PESERTA') {
      // Akun peserta tidak boleh masuk panel; arahkan ke ruang ujian.
      setAdminLoginMessage('Akun ini adalah akun peserta. Silakan masuk melalui halaman ujian.', 'error');
      try { sessionStorage.setItem('ao_panel_handoff_v1', JSON.stringify(result)); } catch (error) {}
      var tujuanPeserta = result.redirectUrl || urlAplikasiAdmin_('');
      if (tujuanPeserta) setTimeout(function() { pindahHalamanAdmin_(tujuanPeserta); }, 1200);
      return;
    }
    ADMIN.token = result.adminToken;
    ADMIN.username = result.username;
    ADMIN.nama = result.nama || result.username;
    ADMIN.role = result.role || 'ADMIN';
    // REVISI 2 mapel: simpan daftar mapel yang diampu bila server mengirimnya.
    ADMIN.mapelDiampu = pecahMapelGuru_(result.mapelDiampu || result.mapel || '');
    saveStoredAdminSession_({ token: ADMIN.token, username: ADMIN.username, nama: ADMIN.nama, role: ADMIN.role });
    // Bootstrap satu kali menggantikan tiga request awal (dashboard, soal, pengaturan).
    var bootstrapLoaded = await loadAdminBootstrap();
    if (!bootstrapLoaded) throw new Error('Bootstrap admin gagal.');
    openAdminPanel_();
  } catch (error) {
    if (error && error.adminSessionInvalid) {
      ADMIN.token = '';
      ADMIN.username = '';
      clearStoredAdminSession_();
      clearAdminLoginFields_();
      setAdminLoginMessage('Sesi admin tidak valid. Silakan login kembali.', 'error');
    } else if (ADMIN.token) {
      // Login sudah berhasil; kegagalan bootstrap sementara tidak membatalkan sesi.
      openAdminPanel_();
      showToast('Login berhasil, tetapi data awal belum dapat dimuat. Coba refresh saat koneksi stabil.', 'error');
    } else {
      setAdminLoginMessage('Gagal menghubungi server admin.', 'error');
    }
  } finally {
    document.getElementById('adminLoginButton').disabled = false;
  }
}

async function adminLogout() {
  try { if (ADMIN.token) await adminApi('logoutAdmin', {}); } catch (error) {}
  if (ADMIN.autoRefreshId) clearInterval(ADMIN.autoRefreshId);
  ADMIN.token = '';
  ADMIN.username = '';
  ADMIN.nama = '';
  ADMIN.role = 'ADMIN';
  ADMIN.questions = [];
  ADMIN.teachers = [];
  ADMIN.participants = [];
  ADMIN.notifications = [];
  clearStoredAdminSession_();
  tampilkanMemuatPanel_(false);
  document.getElementById('adminShell').classList.remove('show');
  document.getElementById('adminLoginPage').style.display = 'flex';
  clearAdminLoginFields_();
  setAdminLoginMessage('', '');
}

function startAdminAutoRefresh() {
  if (ADMIN.autoRefreshId) clearInterval(ADMIN.autoRefreshId);
  ADMIN.autoRefreshId = setInterval(function() {
    if (!ADMIN.token) return;
    loadDashboard();
    if (ADMIN.activeTab === 'monitor') loadMonitor();
    if (ADMIN.activeTab === 'pelanggaran') loadViolations();
    if (ADMIN.activeTab === 'hasil') loadResults();
    // Jangan menyegarkan Nilai Uraian selama admin masih mengisi nilai;
    // penyegaran akan berjalan sendiri pada siklus berikutnya setelah disimpan.
    if (ADMIN.activeTab === 'uraian' && !adaNilaiUraianDiedit_()) loadEssays();
    if (ADMIN.activeTab === 'notifikasi') loadNotifications();
    else loadNotificationBadge_();
  }, 10000);
}

function switchAdminTab(tab) {
  if (tab === 'pengguna' && !ADMIN.isAdmin) {
    showToast('Menu akun guru hanya dapat diakses proktor/admin.', 'error');
    return;
  }
  if (tab === 'kartusoal' && !kartuSoalAktif_()) {
    hasilInfo_('Kartu Soal Belum Aktif',
      'Menu Kartu Soal hanya tersedia untuk asesmen STS dan SAS.', [
        { label: 'Jenis ujian saat ini', nilai: labelJenisUjian_(ADMIN.settings && ADMIN.settings.jenisUjian) },
        { label: 'Cara mengaktifkan', nilai: 'Buka Pengaturan, ubah Jenis Ujian ke STS atau SAS, lalu simpan' }
      ]);
    return;
  }
  // Meninggalkan tab Nilai Uraian berarti ketikan yang belum disimpan dibuang,
  // agar tidak muncul lagi sebagai angka basi saat tab dibuka kembali.
  if (tab !== 'uraian') ADMIN.essayDrafts = {};
  ADMIN.activeTab = tab;
  document.querySelectorAll('.sidebar-link').forEach(function(button) { button.classList.toggle('active', button.dataset.tab === tab); });
  document.querySelectorAll('.admin-pane').forEach(function(pane) { pane.classList.toggle('show', pane.id === 'pane-' + tab); });
  var meta = TAB_META[tab] || { judul: 'Panel', sub: '' };
  document.getElementById('topbarTitle').textContent = meta.judul;
  document.getElementById('topbarSubtitle').textContent = meta.sub;
  try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (error) { window.scrollTo(0, 0); }
  if (tab === 'soal') loadQuestions();
  if (tab === 'kartusoal') loadKartuSoal();
  if (tab === 'monitor') loadMonitor();
  if (tab === 'pelanggaran') { loadViolations(); loadDisqualified(); }
  if (tab === 'hasil') loadResults();
  if (tab === 'uraian') loadEssays();
  if (tab === 'rekap') loadRecap();
  if (tab === 'peserta') loadParticipants();
  if (tab === 'pengguna') { loadTeachers(); siapkanFormKelasGuru_(); }
  if (tab === 'notifikasi') loadNotifications();
  if (tab === 'pengaturan') { loadSettings(); muatDaftarPesertaDurasi_(); }
}

function applyDashboardSummary(summary) {
  summary = summary || {};
  document.getElementById('sumSoal').textContent = summary.soalAktif || 0;
  document.getElementById('sumAktif').textContent = summary.pesertaAktif || 0;
  document.getElementById('sumSelesai').textContent = summary.selesai || 0;
  document.getElementById('sumPelanggaran').textContent = summary.pelanggaran || 0;
}

function applySettingsData(setting) {
  ADMIN.settings = setting || {};
  setting = ADMIN.settings;
  // REVISI 2 mapel: server boleh menitipkan daftar mapel yang diampu akun
  // ini pada pengaturan maupun profil; bila tidak ada, dropdown tetap
  // dibangun dari mapel tersimpan + bank soal milik akun.
  var titipan = setting.mapelDiampu || setting.mapelGuru || '';
  if (titipan) ADMIN.mapelDiampu = pecahMapelGuru_(titipan);
  isiPilihanMapelUjian_(setting.mapel || '');
  muatInfoBatasKelasGuru_();
  document.getElementById('sDurasi').value =
    (setting.durasiMenit === '' || setting.durasiMenit === undefined || setting.durasiMenit === null)
      ? '' : setting.durasiMenit;
  document.getElementById('sEmail').value = setting.emailPemilik || '';
  document.getElementById('sTimerMerah').value = setting.batasTimerMerahMenit || 5;
  document.getElementById('sUserPeserta').value = setting.usernamePeserta || '';
  document.getElementById('sAdminUser').value = setting.adminUsername || '';
  var guru = document.getElementById('sGuruMapel');
  if (guru) guru.value = setting.namaGuruMapel || '';
  var kkm = document.getElementById('sKkm');
  if (kkm) kkm.value = setting.kkmDefault || 75;
  var jenis = document.getElementById('sJenisUjian');
  if (jenis) jenis.value = normalisasiJenisUjianKlien_(setting.jenisUjian);
  var semester = document.getElementById('sSemester');
  if (semester) semester.value = normalisasiSemesterKlien_(setting.semester);
  setNilaiInput_('sTahunAjaran', setting.tahunAjaran);
  var sakelarUjian = document.getElementById('sUjianAktif');
  if (sakelarUjian) sakelarUjian.checked = setting.ujianAktif === true;
  // Penegasan bahwa pengaturan ini hanya milik akun yang sedang login.
  var lencana = document.getElementById('sPemilikBadge');
  if (lencana) {
    lencana.textContent = 'milik ' + (setting.pemilikPengaturan || ADMIN.username || 'akun ini');
  }
  setNilaiInput_('sJudulUjian', setting.judulUjian);
  setNilaiInput_('sPetunjukUjian', setting.petunjukUjian);
  // Nama sekolah di sidebar panel mengikuti pengaturan server, supaya tidak
  // lagi menjadi teks statis yang ketinggalan (sebelumnya "SMP LABSCHOOL UNTAD").
  var namaSekolah = document.getElementById('sidebarSchoolName');
  if (namaSekolah && String(setting.sekolah || '').trim()) {
    namaSekolah.textContent = String(setting.sekolah).trim();
  }
  perbaruiJudulUjian_();
  perbaruiMenuKartuSoal_();
}

/** Semester hanya Ganjil atau Genap, sama dengan aturan server. */
function normalisasiSemesterKlien_(nilai) {
  return String(nilai || '').trim().toUpperCase() === 'GENAP' ? 'GENAP' : 'GANJIL';
}

/**
 * Menyusun judul besar ujian secara otomatis. Kolom judul bersifat read-only
 * sehingga operator cukup mengatur jenis ujian, semester, dan tahun ajaran.
 */
function susunJudulUjianKlien_() {
  var jenis = normalisasiJenisUjianKlien_(nilaiInput_('sJenisUjian'));
  var namaJenis = {
    SUMATIF_HARIAN: 'SUMATIF HARIAN',
    STS: 'SUMATIF TENGAH SEMESTER',
    SAS: 'SUMATIF AKHIR SEMESTER',
    UAS: 'UJIAN AKHIR SEKOLAH'
  }[jenis] || 'SUMATIF HARIAN';
  var bagian = [namaJenis, normalisasiSemesterKlien_(nilaiInput_('sSemester'))];
  var tahun = String(nilaiInput_('sTahunAjaran') || '').replace(/\s+/g, ' ').trim();
  if (tahun) bagian.push('TA ' + tahun.toUpperCase());
  return bagian.join(' ');
}

/** Menyegarkan pratinjau judul besar setiap kali salah satu sumbernya berubah. */
function perbaruiJudulUjian_() {
  var kolom = document.getElementById('sJudulUjian');
  if (kolom) kolom.value = susunJudulUjianKlien_();
}

/** Membakukan jenis ujian di sisi klien agar sama dengan server. */
function normalisasiJenisUjianKlien_(nilai) {
  var teks = String(nilai || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (teks === 'STS' || teks === 'SUMATIF_TENGAH_SEMESTER') return 'STS';
  if (teks === 'SAS' || teks === 'SUMATIF_AKHIR_SEMESTER') return 'SAS';
  if (teks === 'UAS' || teks === 'UJIAN_AKHIR_SEKOLAH') return 'UAS';
  return 'SUMATIF_HARIAN';
}

/** Label ramah jenis ujian untuk ditampilkan pada dialog dan header. */
function labelJenisUjian_(nilai) {
  var jenis = normalisasiJenisUjianKlien_(nilai);
  if (jenis === 'STS') return 'Sumatif Tengah Semester (STS)';
  if (jenis === 'SAS') return 'Sumatif Akhir Semester (SAS)';
  if (jenis === 'UAS') return 'Ujian Akhir Sekolah (UAS)';
  return 'Sumatif Harian (SH)';
}

/** Kartu Soal terbuka untuk STS, SAS, dan UAS. */
function kartuSoalAktif_() {
  var jenis = normalisasiJenisUjianKlien_(ADMIN.settings && ADMIN.settings.jenisUjian);
  return jenis === 'STS' || jenis === 'SAS' || jenis === 'UAS';
}

/**
 * Menyembunyikan atau menampilkan menu Kartu Soal mengikuti Jenis Ujian.
 * Bila menu sedang dibuka lalu jenis ujian diubah kembali ke Sumatif
 * Harian, tampilan otomatis kembali ke Kelola Soal.
 */
function perbaruiMenuKartuSoal_() {
  var aktif = kartuSoalAktif_();
  var menu = document.getElementById('menuKartuSoal');
  // Menu tetap disembunyikan pada Sumatif Harian.
  if (menu) menu.classList.toggle('role-locked', !aktif);
  if (!aktif && ADMIN.activeTab === 'kartusoal') switchAdminTab('soal');
}

/** Membaca nilai input/textarea secara aman bila elemen belum ada. */
function nilaiInput_(id) {
  var el = document.getElementById(id);
  return el ? el.value : '';
}

/** Mengisi input tanpa mengganggu pengetikan admin yang sedang berlangsung. */
function setNilaiInput_(id, nilai) {
  var el = document.getElementById(id);
  if (!el) return;
  if (document.activeElement === el) return;
  el.value = nilai === undefined || nilai === null ? '' : String(nilai);
}

async function loadAdminBootstrap() {
  try {
    var result = await adminApi('getBootstrapAdmin', {});
    if (!result || !result.success) {
      guardAdminResult(result);
      var resultError = new Error((result && result.message) || 'Permintaan admin gagal.');
      resultError.adminSessionInvalid = isAdminSessionInvalidMessage_(resultError.message);
      resultError.adminResultHandled = true;
      throw resultError;
    }
    applyDashboardSummary(result.summary);
    ADMIN.questions = result.soal || [];
    DATA_MENTAH.soal = ADMIN.questions;
    terapkanFilterSoal_();
    applySettingsData(result.pengaturan);
    applyBrandingData_(result.branding);
    if (result.profil) {
      ADMIN.nama = result.profil.nama || ADMIN.nama || ADMIN.username;
      ADMIN.role = result.profil.role || ADMIN.role;
      if (result.profil.mapel || result.profil.mapelDiampu) {
        ADMIN.mapelDiampu = pecahMapelGuru_(result.profil.mapelDiampu || result.profil.mapel);
      }
      terapkanHakAkses_();
    }
    ADMIN.tema = result.tema || ADMIN.tema || 'navy';
    if (result.daftarTema && result.daftarTema.length) ADMIN.daftarTema = result.daftarTema;
    isiPilihanTema_(ADMIN.tema);
    terapkanTemaPanel_();
    ADMIN.notifications = result.notifikasi || [];
    applyNotificationBadge_(result.notifikasiBelumDibaca || 0);
    return true;
  } catch (error) {
    if (!error.adminResultHandled) showToast('Data awal admin gagal dimuat.', 'error');
    throw error;
  }
}

async function loadDashboard() {
  if (!ADMIN.token || ADMIN.refreshBusy.dashboard) return;
  ADMIN.refreshBusy.dashboard = true;
  try {
    var result = await adminApi('getDashboardAdmin', {});
    if (!guardAdminResult(result)) return;
    applyDashboardSummary(result.summary);
  } catch (error) { console.warn('Dashboard gagal:', error); }
  finally { ADMIN.refreshBusy.dashboard = false; }
}

/* =============================== SOAL =============================== */
function updateQuestionFormatHelp(prefix) {
  var type = document.getElementById(prefix + 'Tipe').value;
  var help = {
    PG: '<strong>PG Biasa:</strong> tulis 1 opsi per baris. Contoh opsi: Jakarta, Bandung, Palu. Kunci jawaban: <strong>A</strong>. ' +
      '<strong>Rumus:</strong> copy-paste langsung dari Word/AI didukung otomatis, atau tulis <strong>$x^2 + y^2 = z^2$</strong> / <strong>\\frac{a}{b}</strong> — tampil rapi di peserta.',
    PGK: '<strong>PGK Kategori:</strong> susun pada editor tabel di bawah — kategori jawaban dapat dibuat sendiri (tidak harus Benar/Salah) dan setiap pernyataan diberi kunci kategorinya. Peserta memberi tanda centang (√) pada kolom kategori yang sesuai. ' +
      'Rumus pada pernyataan: copy-paste langsung dari Word/AI didukung otomatis.',
    PGK_MCMA: '<strong>PGK MCMA:</strong> tulis 1 opsi per baris. Kunci dapat lebih dari satu, misalnya: <strong>A,C,D</strong>. ' +
      'Rumus boleh ditempel dari Word/AI, atau tulis <strong>$...$</strong> / <strong>\\frac{a}{b}</strong>.',
    MENJODOHKAN: '<strong>Menjodohkan:</strong> isi pasangan <em>pernyataan &rarr; pasangan</em> pada editor tabel di bawah. ' +
      'Kunci jawaban terisi otomatis, dan pilihan pasangan diacak untuk peserta. Rumus boleh ditempel dari Word/AI.',
    ISIAN: '<strong>Isian:</strong> opsi tidak diperlukan. Gunakan tanda <strong>|</strong> untuk jawaban alternatif, misalnya: Jakarta|DKI Jakarta. ' +
      'Jawaban ber-rumus boleh ditempel dari Word/AI atau ditulis <strong>$3\\sqrt{2}$</strong>.',
    URAIAN: '<strong>Uraian:</strong> opsi tidak diperlukan. Isi rubrik/pedoman penilaian pada kolom kunci jawaban.'
  }[type];
  document.getElementById(prefix + 'FormatHelp').innerHTML = help;

  // PGK Kategori & Menjodohkan memakai editor tabel terstruktur; kolom
  // teks opsi/kunci disembunyikan agar tidak membingungkan.
  var struct = type === 'PGK' || type === 'MENJODOHKAN';
  var optionField = document.getElementById(prefix + 'Opsi');
  optionField.disabled = type === 'ISIAN' || type === 'URAIAN' || struct;
  var opsiWrap = document.getElementById(prefix + 'OpsiWrap');
  if (opsiWrap) opsiWrap.style.display = struct ? 'none' : '';
  var pgkBox = document.getElementById(prefix + 'PgkBox');
  var jodohBox = document.getElementById(prefix + 'JodohBox');
  if (pgkBox) pgkBox.hidden = type !== 'PGK';
  if (jodohBox) jodohBox.hidden = type !== 'MENJODOHKAN';
  optionField.placeholder = type === 'PGK' ? 'Pernyataan 1\\nPernyataan 2'
    : (type === 'MENJODOHKAN' ? 'Ibu kota Jawa Tengah = Semarang\\nIbu kota Jawa Barat = Bandung'
       : 'Opsi 1\\nOpsi 2\\nOpsi 3');

  // Kunci jawaban menjodohkan & PGK Kategori dibentuk otomatis dari editor
  // tabel, jadi kolomnya dikunci agar guru tidak perlu mengetik ulang.
  var keyField = document.getElementById(prefix + 'Kunci');
  if (keyField) {
    var otomatis = type === 'MENJODOHKAN' || type === 'PGK';
    keyField.readOnly = otomatis;
    keyField.placeholder = otomatis
      ? 'Terisi otomatis dari editor tabel di atas.'
      : 'Isi berdasarkan petunjuk format di atas.';
    if (type === 'MENJODOHKAN') perbaruiKunciJodoh_(prefix);
    else if (type === 'PGK') perbaruiKunciPgk_(prefix);
    else if (/^\s*\?(\s*\/\s*\?)*\s*$/.test(keyField.value)) {
      // Tipe diisi manual (PG / PGK MCMA / ISIAN / URAIAN): hapus sisa "?"
      // yang sempat terisi otomatis oleh editor PGK saat form dibuka,
      // agar kolom selalu bersih sebelum guru mengetik.
      keyField.value = '';
    }
  }
  if (type === 'PGK') perbaruiPratinjauPgk_(prefix);
}

/**
 * Menyusun ulang pratinjau kunci jawaban menjodohkan setiap kali daftar
 * pasangan diubah, sehingga guru langsung melihat hasilnya.
 */
function perbaruiKunciJodoh_(prefix) {
  var tipe = document.getElementById(prefix + 'Tipe');
  var keyField = document.getElementById(prefix + 'Kunci');
  if (!tipe || !keyField || tipe.value !== 'MENJODOHKAN') return;
  var pasangan = optionsFromField(prefix);
  keyField.value = pasangan.length
    ? pasangan.map(function(item, index) {
        return (index + 1) + '. ' + item.text + ' = ' + item.pasangan;
      }).join('\n')
    : '';
}

/* ==================================================================
 * EDITOR TERSTRUKTUR: PGK KATEGORI & MENJODOHKAN (REVISI 4.0)
 *
 * PGK Kategori mengikuti format gambar: tabel No. | Pernyataan |
 * kolom-kolom kategori; peserta memberi tanda centang (√) pada kolom
 * yang sesuai. Kategori jawaban CUSTOM (tidak harus Benar/Salah).
 * Menjodohkan memakai tabel serupa berisi pasangan pernyataan.
 * ================================================================== */
var PGK_STATE = { f: null, e: null };
var JODOH_STATE = { f: null, e: null };
var RTE_PERTANYAAN = { f: null, e: null };

function pgkStateDefault() {
  return { kategori: ['Informasi Penting', 'Dapat Diabaikan'], rows: [] };
}

function renderPgkKategoriChips(prefix) {
  var state = PGK_STATE[prefix];
  var wrap = document.getElementById(prefix + 'PgkKategori');
  if (!wrap || !state) return;
  wrap.innerHTML = '';
  state.kategori.forEach(function(nama, idx) {
    var chip = document.createElement('span');
    chip.className = 'kategori-chip';
    var inp = document.createElement('input');
    inp.value = nama;
    inp.maxLength = 40;
    inp.setAttribute('aria-label', 'Nama kategori ' + (idx + 1));
    inp.addEventListener('input', function() {
      var lama = state.kategori[idx];
      state.kategori[idx] = this.value;
      state.rows.forEach(function(r) { if (r.kunci === lama) r.kunci = this.value; }, this);
      syncPgkRowSelects(prefix);
      perbaruiKunciPgk_(prefix);
      perbaruiPratinjauPgk_(prefix);
    });
    var del = document.createElement('button');
    del.type = 'button';
    del.title = 'Hapus kategori ini';
    del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    del.addEventListener('click', function() {
      if (state.kategori.length <= 2) { showToast('Minimal dua kategori.', 'error'); return; }
      var buang = state.kategori.splice(idx, 1)[0];
      state.rows.forEach(function(r) { if (r.kunci === buang) r.kunci = ''; });
      renderPgkKategoriChips(prefix);
      syncPgkRowSelects(prefix);
      perbaruiKunciPgk_(prefix);
      perbaruiPratinjauPgk_(prefix);
    });
    chip.appendChild(inp);
    chip.appendChild(del);
    wrap.appendChild(chip);
  });
  var add = document.createElement('button');
  add.type = 'button';
  add.className = 'admin-secondary';
  add.style.minHeight = '30px';
  add.innerHTML = '<i class="fa-solid fa-plus"></i> Kategori';
  add.addEventListener('click', function() {
    if (state.kategori.length >= 5) { showToast('Maksimal lima kategori.', 'error'); return; }
    state.kategori.push('Kategori ' + (state.kategori.length + 1));
    renderPgkKategoriChips(prefix);
    syncPgkRowSelects(prefix);
    perbaruiPratinjauPgk_(prefix);
  });
  wrap.appendChild(add);
}

function syncOnePgkSelect(sel, state, rowState) {
  var val = rowState.kunci;
  sel.innerHTML = '<option value="">Pilih kategori kunci</option>' + state.kategori.map(function(k) {
    return '<option value="' + SRich.escapeHtml(k) + '">' + SRich.escapeHtml(k) + '</option>';
  }).join('');
  if (state.kategori.indexOf(val) !== -1) sel.value = val;
  else { sel.value = ''; rowState.kunci = ''; }
}
function syncPgkRowSelects(prefix) {
  var state = PGK_STATE[prefix];
  var rowsWrap = document.getElementById(prefix + 'PgkRows');
  if (!state || !rowsWrap) return;
  var sels = rowsWrap.querySelectorAll('select');
  state.rows.forEach(function(r, i) { if (sels[i]) syncOnePgkSelect(sels[i], state, r); });
}
function pgkRenumber(prefix, wrapId) {
  var rowsWrap = document.getElementById(wrapId || (prefix + 'PgkRows'));
  var nos = rowsWrap.querySelectorAll('.pgk-no');
  for (var i = 0; i < nos.length; i++) nos[i].textContent = String(i + 1);
}

function pgkAddRow(prefix, html, kunci) {
  var state = PGK_STATE[prefix];
  var rowsWrap = document.getElementById(prefix + 'PgkRows');
  var row = document.createElement('div');
  row.className = 'pgk-row';
  var no = document.createElement('div'); no.className = 'pgk-no';
  var host = document.createElement('div');
  var sel = document.createElement('select');
  sel.title = 'Kunci kategori pernyataan ini';
  var del = document.createElement('button');
  del.type = 'button'; del.className = 'pgk-del';
  del.title = 'Hapus pernyataan';
  del.innerHTML = '<i class="fa-solid fa-trash"></i>';
  row.appendChild(no); row.appendChild(host); row.appendChild(sel); row.appendChild(del);
  rowsWrap.appendChild(row);

  var rowState = { html: html || '', kunci: kunci || '' };
  state.rows.push(rowState);
  var editor = SRich.mountEditor(host, {
    compact: true,
    placeholder: 'Tulis pernyataan (dukung tebal/miring/tabel/rumus)...',
    onChange: function() {
      rowState.html = editor.getHtml();
      perbaruiPratinjauPgk_(prefix);
    }
  });
  rowState._editor = editor;
  editor.setHtml(rowState.html);
  sel.addEventListener('change', function() {
    rowState.kunci = sel.value;
    perbaruiKunciPgk_(prefix);
    perbaruiPratinjauPgk_(prefix);
  });
  del.addEventListener('click', function() {
    if (state.rows.length <= 1) { showToast('Minimal satu pernyataan.', 'error'); return; }
    var i = state.rows.indexOf(rowState);
    state.rows.splice(i, 1);
    if (row.parentNode) row.parentNode.removeChild(row);
    pgkRenumber(prefix);
    perbaruiKunciPgk_(prefix);
    perbaruiPratinjauPgk_(prefix);
  });
  syncOnePgkSelect(sel, state, rowState);
  pgkRenumber(prefix);
  return rowState;
}

function resetPgkEditor(prefix, data) {
  PGK_STATE[prefix] = {
    kategori: (data && data.kategori && data.kategori.length >= 2 ? data.kategori : ['Informasi Penting', 'Dapat Diabaikan']).slice(),
    rows: []
  };
  var rowsWrap = document.getElementById(prefix + 'PgkRows');
  if (rowsWrap) rowsWrap.innerHTML = '';
  renderPgkKategoriChips(prefix);
  var rows = data && data.rows && data.rows.length ? data.rows : [{ html: '', kunci: '' }];
  rows.forEach(function(r) { pgkAddRow(prefix, r.html, r.kunci); });
  perbaruiKunciPgk_(prefix);
  perbaruiPratinjauPgk_(prefix);
}

function perbaruiKunciPgk_(prefix) {
  var tipeEl = document.getElementById(prefix + 'Tipe');
  var keyField = document.getElementById(prefix + 'Kunci');
  var state = PGK_STATE[prefix];
  if (!keyField || !state) return;
  // REVISI 2026-09-24: hanya tipe PGK yang boleh mengisi kolom ini otomatis.
  // Simbol "?" lama dihapus: pernyataan yang belum berkunci TIDAK menampilkan
  // apa pun (placeholder kolom memberi penjelas), sehingga kolom tidak pernah
  // muncul terisi otomatis sebelum guru memilih kunci.
  if (tipeEl && tipeEl.value !== 'PGK') return;
  keyField.value = state.rows.map(function(r) { return r.kunci || ''; }).filter(Boolean).join(' / ');
}

/** Pratinjau persis seperti tampilan peserta (kunci ditandai √ hijau). */
function perbaruiPratinjauPgk_(prefix) {
  var prev = document.getElementById(prefix + 'PgkPreview');
  var state = PGK_STATE[prefix];
  if (!prev || !state) return;
  var jawaban = {};
  state.rows.forEach(function(r, i) { if (r.kunci) jawaban[String(i)] = r.kunci; });
  prev.innerHTML = SRich.pgkTableHtml({
    kategori: state.kategori.slice(),
    statements: state.rows.map(function(r, i) {
      return { id: String(i), html: r.html || '(pernyataan belum ditulis)' };
    }),
    jawaban: jawaban,
    interaksi: false
  });
  SRich.typesetMath(prev);
}

/* ------------------- editor pasangan menjodohkan ------------------- */
function jodohAddRow(prefix, text, pasangan) {
  var state = JODOH_STATE[prefix];
  var wrap = document.getElementById(prefix + 'JodohRows');
  var row = document.createElement('div');
  row.className = 'jodoh-row';
  var no = document.createElement('div'); no.className = 'pgk-no';
  var i1 = document.createElement('input');
  i1.placeholder = 'Pernyataan (kolom kiri)'; i1.maxLength = 500;
  var eq = document.createElement('div'); eq.className = 'jodoh-eq'; eq.textContent = '=';
  var i2 = document.createElement('input');
  i2.placeholder = 'Pasangan (kolom kanan)'; i2.maxLength = 500;
  var del = document.createElement('button');
  del.type = 'button'; del.className = 'pgk-del';
  del.title = 'Hapus pasangan';
  del.innerHTML = '<i class="fa-solid fa-trash"></i>';
  row.appendChild(no); row.appendChild(i1); row.appendChild(eq); row.appendChild(i2); row.appendChild(del);
  wrap.appendChild(row);
  var rowState = { text: text || '', pasangan: pasangan || '' };
  state.rows.push(rowState);
  i1.value = rowState.text;
  i2.value = rowState.pasangan;
  i1.addEventListener('input', function() { rowState.text = this.value; perbaruiKunciJodoh_(prefix); });
  i2.addEventListener('input', function() { rowState.pasangan = this.value; perbaruiKunciJodoh_(prefix); });
  del.addEventListener('click', function() {
    if (state.rows.length <= 1) { showToast('Minimal satu pasangan.', 'error'); return; }
    var i = state.rows.indexOf(rowState);
    state.rows.splice(i, 1);
    if (row.parentNode) row.parentNode.removeChild(row);
    pgkRenumber(prefix, prefix + 'JodohRows');
    perbaruiKunciJodoh_(prefix);
  });
  pgkRenumber(prefix, prefix + 'JodohRows');
  perbaruiKunciJodoh_(prefix);
  return rowState;
}

function resetJodohEditor(prefix, rows) {
  JODOH_STATE[prefix] = { rows: [] };
  var wrap = document.getElementById(prefix + 'JodohRows');
  if (wrap) wrap.innerHTML = '';
  var list = rows && rows.length ? rows : [{ text: '', pasangan: '' }];
  list.forEach(function(r) { jodohAddRow(prefix, r.text, r.pasangan); });
  perbaruiKunciJodoh_(prefix);
}

/** Validasi editor terstruktur & pertanyaan sebelum disimpan. */
function validateSoalStruct_(prefix) {
  var tipe = document.getElementById(prefix + 'Tipe').value;
  var rte = RTE_PERTANYAAN[prefix];
  if (rte && rte.isEmpty()) return 'Pertanyaan wajib diisi (mis. kalimat perintah seperti pada contoh PGK Kategori).';
  if (tipe === 'PGK') {
    var st = PGK_STATE[prefix];
    var unik = [];
    for (var c = 0; c < st.kategori.length; c++) {
      var nm = String(st.kategori[c] || '').trim();
      if (!nm) return 'Nama kategori tidak boleh kosong.';
      if (/[|,]/.test(nm)) return 'Nama kategori tidak boleh mengandung koma atau tanda pipa (|): "' + nm + '".';
      if (unik.indexOf(nm) !== -1) return 'Nama kategori harus berbeda satu sama lain: "' + nm + '".';
      unik.push(nm);
    }
    if (!st.rows.length) return 'Minimal satu pernyataan.';
    for (var j = 0; j < st.rows.length; j++) {
      if (!SRich.stripHtml(st.rows[j].html).trim()) return 'Pernyataan nomor ' + (j + 1) + ' masih kosong.';
      if (!st.rows[j].kunci) return 'Kunci kategori untuk pernyataan nomor ' + (j + 1) + ' belum dipilih.';
    }
  }
  if (tipe === 'MENJODOHKAN') {
    var jd = JODOH_STATE[prefix];
    var valid = jd.rows.filter(function(r) { return r.text.trim() && r.pasangan.trim(); });
    if (valid.length < 2) return 'Menjodohkan membutuhkan minimal dua pasangan pernyataan yang lengkap.';
  }
  return '';
}

function optionsFromField(prefix) {
  var type = document.getElementById(prefix + 'Tipe').value;
  if (type === 'ISIAN' || type === 'URAIAN') return [];
  if (type === 'PGK') {
    var st = PGK_STATE[prefix];
    if (!st) return [];
    return st.rows.map(function(r) { return { text: r.html }; });
  }
  if (type === 'MENJODOHKAN') {
    var jd = JODOH_STATE[prefix];
    if (jd) {
      return jd.rows
        .filter(function(r) { return r.text.trim() && r.pasangan.trim(); })
        .map(function(r) { return { text: r.text.trim(), pasangan: r.pasangan.trim() }; });
    }
  }
  var lines = document.getElementById(prefix + 'Opsi').value.split(/\r?\n/)
    .map(function(line) { return line.trim().replace(/^[A-Ha-h0-9]+[.)\-:]\s*/, ''); })
    .filter(Boolean);
  if (type === 'MENJODOHKAN') {
    // Setiap baris berformat "pernyataan = jawaban". Baris tanpa tanda sama
    // dengan diabaikan agar tidak membentuk pasangan yang tidak lengkap.
    return lines.map(function(line) {
      var bagian = line.split('=');
      if (bagian.length < 2) return null;
      return {
        text: bagian[0].trim(),
        pasangan: bagian.slice(1).join('=').trim()
      };
    }).filter(function(item) { return item && item.text && item.pasangan; });
  }
  return lines.map(function(text) { return { text: text }; });
}

/* ====================== UPLOADER MEDIA MULTI-SUMBER ======================
 * Setiap kotak media (gambar/video) mendukung tiga sumber: komputer, Google
 * Drive, dan URL langsung. Hasil akhirnya selalu satu URL yang tersimpan di
 * input tersembunyi, sehingga admin tidak perlu mengisi kolom link terpisah.
 * ====================================================================== */

var MEDIA_STATE = {};

function initMediaBoxes_() {
  document.querySelectorAll('[data-media-box]').forEach(function(box) {
    var key = box.dataset.mediaBox;
    MEDIA_STATE[key] = { sumber: 'komputer', kind: box.dataset.mediaKind, url: '' };

    box.querySelectorAll('[data-media-tab]').forEach(function(tab) {
      tab.addEventListener('click', function() {
        var target = this.dataset.mediaTab;
        MEDIA_STATE[key].sumber = target;
        box.querySelectorAll('[data-media-tab]').forEach(function(item) { item.classList.remove('active'); });
        this.classList.add('active');
        box.querySelectorAll('[data-media-panel]').forEach(function(panel) {
          panel.classList.toggle('show', panel.dataset.mediaPanel === target);
        });
      });
    });

    var fileInput = box.querySelector('[data-media-file]');
    // Memilih berkas cukup memuat pratinjau; kotak hasil hanya saat ditekan
    // tombol Proses agar tidak mengganggu ketika admin sekadar mengganti file.
    if (fileInput) fileInput.addEventListener('change', function() { prosesMediaBox_(box, true); });
    box.querySelector('[data-media-action="proses"]').addEventListener('click', function() { prosesMediaBox_(box); });
    box.querySelector('[data-media-action="hapus"]').addEventListener('click', function() { mintaKosongkanMedia_(box); });
  });
}

function mediaStatus_(box, text, tone) {
  var element = box.querySelector('[data-media-status]');
  element.className = 'media-status show ' + (tone || 'info');
  element.innerHTML = text;
}

function mediaProgress_(box, percent) {
  var bar = box.querySelector('[data-media-progress]');
  if (percent === null) { bar.classList.remove('show'); bar.querySelector('b').style.width = '0%'; return; }
  bar.classList.add('show');
  bar.querySelector('b').style.width = Math.max(0, Math.min(100, percent)) + '%';
}

/**
 * Membungkus tombol Refresh agar selalu memberi umpan balik.
 *
 * Refresh adalah aksi ringan yang sering ditekan, sehingga sukses cukup
 * ditandai toast ringkas; kegagalan tetap memakai kotak dialog agar terlihat.
 */
function buatRefresh_(namaData, pemuat, penghitung) {
  return async function() {
    try {
      await pemuat();
      var jumlah = null;
      try { jumlah = penghitung ? penghitung() : null; } catch (e) { jumlah = null; }
      showToast(jumlah === null
        ? namaData + ' diperbarui.'
        : namaData + ' diperbarui — ' + jumlah + ' data.', 'success');
    } catch (error) {
      await hasilGagal_('Gagal Memuat ' + namaData,
        (error && error.message) || 'Data tidak dapat dimuat. Periksa koneksi lalu coba lagi.');
    }
  };
}

/** Label sumber media untuk ditampilkan pada kotak dialog. */
function labelSumberMedia_(sumber) {
  return { komputer: 'Komputer', drive: 'Google Drive', url: 'URL langsung' }[sumber] || 'Tidak diketahui';
}

/** Label tipe soal yang ramah dibaca pada kotak dialog. */
function labelTipeSoal_(tipe) {
  return { PG: 'PG Biasa', PGK: 'PGK Kategori', PGK_MCMA: 'PGK MCMA', MENJODOHKAN: 'Menjodohkan',
           ISIAN: 'Isian', URAIAN: 'Uraian' }[String(tipe || '').toUpperCase()] || String(tipe || '-');
}

/**
 * Nama resmi tipe soal untuk dokumen kartu soal, ditulis lengkap agar
 * kartu soal dapat langsung dilampirkan pada berkas kurikulum.
 */
function labelTipeSoalResmi_(tipe) {
  return {
    PG: 'Pilihan Ganda',
    PGK: 'PGK Kategori',
    PGK_MCMA: 'Pilihan Ganda Kompleks (Jawaban Ganda)',
    MENJODOHKAN: 'Menjodohkan',
    ISIAN: 'Isian Singkat',
    URAIAN: 'Uraian'
  }[String(tipe || '').toUpperCase()] || String(tipe || '-');
}

/**
 * Mengosongkan kotak media dengan konfirmasi lebih dulu, supaya media yang
 * sudah diunggah tidak hilang karena salah tekan.
 */
async function mintaKosongkanMedia_(box) {
  var kind = box.dataset.mediaKind;
  var nilai = (box.querySelector('[data-media-value]') || {}).value || '';
  var nama = kind === 'video' ? 'video' : 'gambar';
  if (!nilai) {
    kosongkanMediaBox_(box);
    await hasilInfo_('Kotak Sudah Kosong', 'Belum ada ' + nama + ' yang diproses pada kotak ini.');
    return;
  }
  var setuju = await konfirmasi_('Kosongkan ' + nama + ' stimulus yang sudah diproses? ' +
    'Berkasnya juga akan dihapus dari penyimpanan aplikasi (Supabase Storage) bila tidak dipakai soal lain.',
    { judul: 'Kosongkan ' + (kind === 'video' ? 'Video' : 'Gambar'), nada: 'warn', teksOk: 'Ya, Kosongkan' });
  if (!setuju) return;

  // Berkas dibuang lebih dulu selagi URL-nya masih diketahui.
  var hapus = { dihapus: false, message: '' };
  try {
    /* [SIADO v5] berkas dihapus dari Supabase Storage langsung (siadoHapusMedia, policy RLS storage.objects) */
    hapus = await window.siadoHapusMedia(nilai, {
      jenis: kind, adminToken: ADMIN.token,
      idSoal: (box.dataset && box.dataset.mediaSoalId) || ''
    }) || hapus;
  } catch (error) {
    hapus = { dihapus: false, message: 'Berkas gagal dihapus dari Storage: ' + (error.message || 'kesalahan jaringan') };
  }

  kosongkanMediaBox_(box);
  await hasilSukses_('Kotak Dikosongkan',
    'Media ' + nama + ' pada soal ini telah dilepas.', [
      { label: 'Berkas Storage', nilai: hapus.dihapus
        ? 'Dihapus' + (hapus.nama ? ' — ' + hapus.nama : '') : (hapus.message || 'Tidak ada yang dihapus') }
    ]);
}

function kosongkanMediaBox_(box) {
  var key = box.dataset.mediaBox;
  MEDIA_STATE[key].url = '';
  MEDIA_STATE[key].berkasTerunggah = null;
  MEDIA_STATE[key].urlBerkas = '';
  box.querySelector('[data-media-value]').value = '';
  var fileInput = box.querySelector('[data-media-file]');
  if (fileInput) fileInput.value = '';
  var driveInput = box.querySelector('[data-media-drive]');
  if (driveInput) driveInput.value = '';
  var urlInput = box.querySelector('[data-media-url]');
  if (urlInput) urlInput.value = '';
  var preview = box.querySelector('[data-media-preview]');
  preview.classList.remove('show');
  preview.innerHTML = '';
  box.querySelector('[data-media-status]').className = 'media-status';
  mediaProgress_(box, null);
}

function tampilkanPratinjauMedia_(box, url, kind, caption) {
  var preview = box.querySelector('[data-media-preview]');
  preview.innerHTML = renderMediaPreviewHtml_(url, kind, caption);
  preview.classList.add('show');
}

function renderMediaPreviewHtml_(url, kind, caption) {
  var safeUrl = escapeAdmin(url);
  var body;
  if (kind === 'video') {
    if (/^https:\/\/drive\.google\.com\/file\/d\//i.test(url) || /youtube\.com|youtu\.be/i.test(url)) {
      body = '<iframe src="' + safeUrl + '" allow="autoplay; encrypted-media" allowfullscreen></iframe>';
    } else {
      body = '<video src="' + safeUrl + '" controls playsinline preload="metadata"></video>';
    }
  } else {
    body = '<img src="' + escapeAdmin(urlGambarTampilAdmin_(url)) + '" alt="Pratinjau stimulus" ' +
      'loading="lazy" referrerpolicy="no-referrer">';
  }
  return body + '<small class="media-meta">' + escapeAdmin(caption || url) + '</small>';
}

/**
 * Menyeragamkan URL gambar Drive ke endpoint /thumbnail agar pratinjau admin
 * menampilkan gambar yang sama persis dengan yang dilihat peserta.
 */
function urlGambarTampilAdmin_(url) {
  var teks = String(url || '');
  if (!/^https:\/\//i.test(teks)) return teks;
  if (!/(googleusercontent\.com|drive\.google\.com|docs\.google\.com)/i.test(teks)) return teks;
  var pola = [/\/file\/d\/([a-zA-Z0-9_-]{10,})/, /googleusercontent\.com\/d\/([a-zA-Z0-9_-]{10,})/,
    /[?&]id=([a-zA-Z0-9_-]{10,})/, /\/d\/([a-zA-Z0-9_-]{10,})/];
  for (var i = 0; i < pola.length; i++) {
    var cocok = teks.match(pola[i]);
    if (cocok) return 'https://drive.google.com/thumbnail?id=' + cocok[1] + '&sz=w1600';
  }
  return teks;
}

async function prosesMediaBox_(box, diam) {
  var key = box.dataset.mediaBox;
  var kind = box.dataset.mediaKind;
  var state = MEDIA_STATE[key];
  var sumber = state.sumber;
  try {
    var url = '';
    if (sumber === 'komputer') {
      var file = box.querySelector('[data-media-file]').files[0];
      if (!file) {
        mediaStatus_(box, 'Pilih file terlebih dahulu.', 'err');
        if (!diam) await hasilInfo_('Belum Ada Berkas', 'Pilih berkas dari komputer terlebih dahulu, lalu tekan Proses & Pratinjau.');
        return;
      }
      MEDIA_FOLDER_TERAKHIR = '';
      if (state.berkasTerunggah === file && state.urlBerkas) {
        // Berkas yang sama sudah diunggah saat dipilih (event change) — pakai ulang URL-nya,
        // jangan unggah dua kali ke Storage.
        url = state.urlBerkas;
        MEDIA_FOLDER_TERAKHIR = state.folderBerkas || '';
      } else {
        url = await unggahFileMedia_(box, file, kind);
        state.berkasTerunggah = file;
        state.urlBerkas = url;
        state.folderBerkas = MEDIA_FOLDER_TERAKHIR;
      }
    } else if (sumber === 'drive') {
      var driveLink = box.querySelector('[data-media-drive]').value.trim();
      if (!driveLink) {
        mediaStatus_(box, 'Tempel link Google Drive terlebih dahulu.', 'err');
        if (!diam) await hasilInfo_('Link Drive Kosong', 'Tempel tautan Google Drive terlebih dahulu, lalu tekan Proses & Pratinjau.');
        return;
      }
      mediaStatus_(box, '<i class="fa-solid fa-circle-notch fa-spin"></i> Memeriksa link Google Drive...', 'info');
      var driveResult = await adminApi('periksaMediaUrl', { url: driveLink, jenis: kind });
      if (!driveResult.success) throw new Error(driveResult.message || 'Link Drive tidak dapat digunakan.');
      url = driveResult.url;
    } else {
      var directUrl = box.querySelector('[data-media-url]').value.trim();
      if (!directUrl) {
        mediaStatus_(box, 'Isi URL media terlebih dahulu.', 'err');
        if (!diam) await hasilInfo_('URL Kosong', 'Isi alamat URL media terlebih dahulu, lalu tekan Proses & Pratinjau.');
        return;
      }
      mediaStatus_(box, '<i class="fa-solid fa-circle-notch fa-spin"></i> Memeriksa URL media...', 'info');
      var urlResult = await adminApi('periksaMediaUrl', { url: directUrl, jenis: kind });
      if (!urlResult.success) throw new Error(urlResult.message || 'URL media tidak valid.');
      url = urlResult.url;
    }
    state.url = url;
    box.querySelector('[data-media-value]').value = url;
    tampilkanPratinjauMedia_(box, url, kind, url);
    mediaStatus_(box, '<i class="fa-solid fa-circle-check"></i> Media siap dipakai. Periksa pratinjau di bawah untuk memastikan tampil dengan benar.', 'ok');
    if (diam) return;
    await hasilSukses_(kind === 'video' ? 'Video Siap Dipakai' : 'Gambar Siap Dipakai',
      'Media berhasil diproses. Periksa pratinjau di bawah kotak ini untuk memastikan tampilannya benar, lalu simpan soal.',
      [
        { label: 'Sumber', nilai: labelSumberMedia_(sumber) },
        { label: 'Jenis', nilai: kind === 'video' ? 'Video' : 'Gambar' }
      ].concat(MEDIA_FOLDER_TERAKHIR
        ? [{ label: 'Penyimpanan', nilai: MEDIA_FOLDER_TERAKHIR }] : []));
    MEDIA_FOLDER_TERAKHIR = '';
  } catch (error) {
    mediaProgress_(box, null);
    mediaStatus_(box, '<i class="fa-solid fa-circle-exclamation"></i> ' + escapeAdmin(error.message || 'Media gagal diproses.'), 'err');
    if (diam) return;
    await hasilGagal_(kind === 'video' ? 'Video Gagal Diproses' : 'Gambar Gagal Diproses',
      error.message || 'Media gagal diproses.', [
        { label: 'Sumber', nilai: labelSumberMedia_(sumber) }
      ]);
  }
}

/** Folder Drive tujuan berkas yang baru saja diunggah, untuk ditampilkan di dialog. */
var MEDIA_FOLDER_TERAKHIR = '';

/**
 * Mengunggah file dari komputer. File kecil dikirim inline melalui Apps Script,
 * sedangkan video besar memakai tiket upload resumable langsung ke Google Drive
 * agar batas payload Apps Script tidak terlampaui.
 */
async function unggahFileMedia_(box, file, kind) {
  /* [SIADO v5] Upload langsung ke Supabase Storage (siadoUploadMedia, policy RLS storage.objects — tanpa Edge Function)
   * (pengganti uploadMediaInline / getUploadTicket / finalisasiUploadDrive Google Drive). */
  var maxImageMb = Math.min(25, Math.max(1, Number(ADMIN.settings && ADMIN.settings.maksimumUploadMb || 5)));
  var maxVideoMb = Math.min(50, Math.max(1, Number(ADMIN.settings && ADMIN.settings.maksimumVideoMb || 50)));
  if (kind === 'gambar') {
    if (!/^image\//i.test(file.type)) throw new Error('Pilih berkas gambar (PNG, JPG, GIF, atau WEBP).');
    if (file.size > maxImageMb * 1024 * 1024) throw new Error('Ukuran gambar melebihi ' + maxImageMb + ' MB.');
  } else {
    if (!/^video\//i.test(file.type)) throw new Error('Pilih berkas video (MP4, WEBM, OGG, atau MOV).');
    if (file.size > maxVideoMb * 1024 * 1024) throw new Error('Ukuran video melebihi ' + maxVideoMb + ' MB (batas paket Supabase Free). Unggah ke YouTube (unlisted) lalu tempel tautannya.');
  }
  mediaStatus_(box, '<i class="fa-solid fa-circle-notch fa-spin"></i> Mengunggah ' + escapeAdmin(file.name) + '...', 'info');
  mediaProgress_(box, 30);
  var result = await window.siadoUploadMedia(file, { jenis: kind, adminToken: ADMIN.token });
  mediaProgress_(box, 100);
  setTimeout(function() { mediaProgress_(box, null); }, 700);
  if (!result || !result.success) throw new Error((result && result.message) || 'Upload gagal.');
  MEDIA_FOLDER_TERAKHIR = 'Supabase Storage / ' + (result.bucket || 'media-soal');
  return result.url;
}

function kirimResumable_(box, file, ticket) {
  return new Promise(function(resolve, reject) {
    var request = new XMLHttpRequest();
    request.open('PUT', ticket.uploadUrl, true);
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    request.upload.onprogress = function(event) {
      if (!event.lengthComputable) return;
      var percent = Math.round((event.loaded / event.total) * 100);
      mediaProgress_(box, percent);
      mediaStatus_(box, '<i class="fa-solid fa-cloud-arrow-up"></i> Mengunggah video... ' + percent + '% (' + formatUkuran_(event.loaded) + ' dari ' + formatUkuran_(event.total) + ')', 'info');
    };
    request.onload = function() {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error('Upload ke Google Drive gagal (kode ' + request.status + ').'));
        return;
      }
      try {
        var body = JSON.parse(request.responseText || '{}');
        if (!body.id) throw new Error('Respons Drive tidak berisi ID berkas.');
        resolve(body.id);
      } catch (error) { reject(new Error('Respons upload tidak dikenali.')); }
    };
    request.onerror = function() { reject(new Error('Koneksi terputus saat mengunggah video.')); };
    request.send(file);
  });
}

function formatUkuran_(bytes) {
  var value = Number(bytes) || 0;
  if (value < 1024) return value + ' B';
  if (value < 1048576) return (value / 1024).toFixed(1) + ' KB';
  if (value < 1073741824) return (value / 1048576).toFixed(1) + ' MB';
  return (value / 1073741824).toFixed(2) + ' GB';
}

/* ====================== PAYLOAD SOAL ====================== */
/**
 * Menormalkan nilai "kelas sasaran soal" (tingkat) menjadi VII / VIII / IX /
 * SEMUA. Nilai kosong, tidak dikenal, atau penulisan lain (7, kelas viii,
 * rombel "VIII A") dipetakan ke SEMUA agar bank soal tidak tersimpan dengan
 * label kelas yang tidak dikenali server.
 */
function tingkatDariNilai_(nilai) {
  var teks = String(nilai === undefined || nilai === null ? '' : nilai).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^(VII|7|TUJUH|KETUJUH)$/.test(teks)) return 'VII';
  if (/^(VIII|8|DELAPAN|KEDELAPAN)$/.test(teks)) return 'VIII';
  if (/^(IX|9|SEMBILAN|KESEMBILAN)$/.test(teks)) return 'IX';
  return 'SEMUA';
}

/** Label singkat tingkat untuk rincian hasil simpan. */
function labelTingkat_(tingkat) {
  var bersih = tingkatDariNilai_(tingkat);
  return bersih === 'SEMUA' ? 'Semua Kelas' : 'Kelas ' + bersih;
}

async function buildQuestionPayload(prefix) {
  var media = await resolveQuestionMedia(prefix);
  var tipe = document.getElementById(prefix + 'Tipe').value;
  // Pertanyaan kini berupa HTML kaya dari editor; untuk PGK Kategori daftar
  // kategori disematkan sebagai penanda tersembunyi agar tampilan peserta
  // selalu sama dengan susunan di panel.
  var rte = RTE_PERTANYAAN[prefix];
  var pertanyaanHtml = rte ? rte.getHtml() : document.getElementById(prefix + 'Pertanyaan').value;
  if (tipe === 'PGK') {
    pertanyaanHtml = SRich.pgkMarkerEmbed(pertanyaanHtml, (PGK_STATE[prefix] || { kategori: [] }).kategori);
  } else {
    pertanyaanHtml = String(pertanyaanHtml)
      .replace(/<div[^>]*data-siado-pgk-kategori[^>]*>\s*<\/div>/gi, '')
      .replace(/<span[^>]*data-siado-pgk-kategori[^>]*>\s*<\/span>/gi, '');
  }
  var kunci = document.getElementById(prefix + 'Kunci').value;
  if (tipe === 'PGK') {
    kunci = (PGK_STATE[prefix] || { rows: [] }).rows.map(function(r) { return r.kunci; }).join(',');
  }
  var hasil = {
    id_soal: prefix === 'e' ? document.getElementById('eId').value : undefined,
    tipe: tipe,
    poin: document.getElementById(prefix + 'Poin').value,
    pertanyaan: pertanyaanHtml,
    opsi: optionsFromField(prefix),
    kunci_jawaban: kunci,
    stimulus_deskripsi: nilaiInput_(prefix + 'DeskripsiStimulus'),
    stimulus_gambar: media.gambar,
    stimulus_alt: document.getElementById(prefix + 'ImageAlt').value,
    stimulus_video: media.video,
    stimulus_video_alt: document.getElementById(prefix + 'VideoAlt').value,
    /* Kelas sasaran soal ini saja. Dikirim eksplisit setiap simpan supaya
       server tidak perlu menebak/mewarisi tingkat soal lain. */
    tingkat: tingkatDariNilai_(nilaiInput_(prefix + 'Tingkat')),
    aktif: document.getElementById(prefix + 'Aktif').checked
  };
  /* REVISI pindah mapel: kunci `mapel` hanya dikirim saat modal edit
     benar-benar mengubah mapel (payload tambah soal & edit-tanpa-ubah
     mapel tetap identik seperti sebelumnya). */
  if (prefix === 'e') {
    var elMapelSoal = document.getElementById('eMapel');
    var mapelSoalBaru = elMapelSoal ? String(elMapelSoal.value || '').trim() : '';
    var mapelSoalLama = String(EDIT_MAPEL_LAMA_ || '').trim();
    if (mapelSoalBaru && mapelSoalBaru.toLowerCase() !== mapelSoalLama.toLowerCase()) {
      hasil.mapel = mapelSoalBaru;
    }
  }
  return hasil;
}

/**
 * Untuk form tambah, URL sudah tersedia dari kotak uploader. Untuk form edit,
 * file yang baru dipilih diunggah lebih dulu agar admin cukup satu klik simpan.
 */
async function resolveQuestionMedia(prefix) {
  if (prefix === 'f') {
    return {
      gambar: document.getElementById('fImageLink').value.trim(),
      video: document.getElementById('fVideoLink').value.trim()
    };
  }

  var gambar = document.getElementById('eHapusGambar').checked ? '' : document.getElementById('eImageLink').value.trim();
  var video = document.getElementById('eHapusVideo').checked ? '' : document.getElementById('eVideoLink').value.trim();

  var imageFile = document.getElementById('eImageFile').files[0];
  if (imageFile && !document.getElementById('eHapusGambar').checked) {
    gambar = await unggahMediaEdit_(imageFile, 'gambar');
    document.getElementById('eImageLink').value = gambar;
  }
  var videoFile = document.getElementById('eVideoFile').files[0];
  if (videoFile && !document.getElementById('eHapusVideo').checked) {
    video = await unggahMediaEdit_(videoFile, 'video');
    document.getElementById('eVideoLink').value = video;
  }
  return { gambar: gambar, video: video };
}

async function unggahMediaEdit_(file, kind) {
  var pseudoBox = {
    dataset: { mediaBox: 'edit', mediaKind: kind },
    querySelector: function(selector) {
      if (selector === '[data-media-status]') return document.getElementById('eMediaStatus');
      if (selector === '[data-media-progress]') return document.getElementById('eUploadProgress');
      return null;
    }
  };
  return unggahFileMedia_(pseudoBox, file, kind);
}

async function previewEditMedia() {
  var imagePreview = document.getElementById('eImagePreview');
  var videoPreview = document.getElementById('eVideoPreview');
  var status = document.getElementById('eMediaStatus');
  status.className = 'media-status show info';
  status.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Memeriksa media soal...';
  try {
    var media = await resolveQuestionMedia('e');
    if (media.gambar) {
      imagePreview.innerHTML = renderMediaPreviewHtml_(media.gambar, 'gambar', media.gambar);
      imagePreview.classList.add('show');
    } else { imagePreview.classList.remove('show'); imagePreview.innerHTML = ''; }
    if (media.video) {
      videoPreview.innerHTML = renderMediaPreviewHtml_(media.video, 'video', media.video);
      videoPreview.classList.add('show');
    } else { videoPreview.classList.remove('show'); videoPreview.innerHTML = ''; }
    status.className = 'media-status show ' + (media.gambar || media.video ? 'ok' : 'info');
    status.innerHTML = media.gambar || media.video
      ? '<i class="fa-solid fa-circle-check"></i> Media dimuat. Pastikan tampil benar sebelum menyimpan.'
      : 'Soal ini belum memiliki media stimulus.';
  } catch (error) {
    status.className = 'media-status show err';
    status.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> ' + escapeAdmin(error.message || 'Media gagal diperiksa.');
  }
}

async function saveNewQuestion() {
  if (ADMIN.operationBusy.addQuestion) return;
  var galatStruktur = validateSoalStruct_('f');
  if (galatStruktur) {
    await hasilGagal_('Soal Gagal Disimpan', galatStruktur);
    return;
  }
  ADMIN.operationBusy.addQuestion = true;
  setFormBusy('addQuestionForm', true);
  try {
    var payload = await buildQuestionPayload('f');
    var result = await apiWajib_('tambahSoal', payload);
    clearQuestionForm('f');
    await segarkanSenyap_([loadQuestions, loadDashboard]);
    await hasilSukses_('Soal Tersimpan', result.message || 'Soal baru berhasil ditambahkan ke bank soal.', [
      { label: 'Mapel', nilai: mapelDiujikan_() || '-' },
      { label: 'Tipe soal', nilai: labelTipeSoal_(payload.tipe) },
      { label: 'Kelas sasaran', nilai: labelTingkat_(payload.tingkat) },
      { label: 'Poin', nilai: String(payload.poin || '-') },
      { label: 'Status', nilai: payload.aktif ? 'Aktif' : 'Nonaktif' }
    ]);
  } catch (error) {
    await hasilGagal_('Soal Gagal Disimpan', error.message || 'Soal gagal disimpan.');
  } finally {
    ADMIN.operationBusy.addQuestion = false;
    setFormBusy('addQuestionForm', false);
  }
}

function clearQuestionForm(prefix) {
  document.getElementById(prefix + 'Poin').value = '10';
  document.getElementById(prefix + 'Pertanyaan').value = '';
  if (RTE_PERTANYAAN[prefix]) RTE_PERTANYAAN[prefix].setHtml('');
  resetPgkEditor(prefix, null);
  resetJodohEditor(prefix, null);
  updateQuestionFormatHelp(prefix);
  var tingkat = document.getElementById(prefix + 'Tingkat');
  if (tingkat) tingkat.value = 'SEMUA';
  var deskripsi = document.getElementById(prefix + 'DeskripsiStimulus');
  if (deskripsi) deskripsi.value = '';
  document.getElementById(prefix + 'Opsi').value = '';
  document.getElementById(prefix + 'Kunci').value = '';
  document.getElementById(prefix + 'ImageAlt').value = '';
  document.getElementById(prefix + 'VideoAlt').value = '';
  document.getElementById(prefix + 'Aktif').checked = true;
  document.querySelectorAll('[data-media-box]').forEach(function(box) {
    if (box.dataset.mediaBox.charAt(0) === prefix) kosongkanMediaBox_(box);
  });
}

async function loadQuestions() {
  if (!ADMIN.token || ADMIN.refreshBusy.questions) return;
  ADMIN.refreshBusy.questions = true;
  try {
    var result = await adminApi('getAllSoal', {});
    if (!guardAdminResult(result)) return;
    ADMIN.questions = result.soal || result.data || [];
    // Sumber data filter ikut diperbarui, supaya daftar yang tampil dan daftar yang dipakai
    // tombol Edit/Hapus selalu sama (sebelumnya filter memakai salinan lama dari bootstrap).
    DATA_MENTAH.soal = ADMIN.questions;
    terapkanFilterSoal_();
    // REVISI 2 mapel: segarkan kandidat dropdown mapel aktif + spanduk info
    // tanpa mengubah pilihan mapel yang sedang tampil di Pengaturan.
    isiPilihanMapelUjian_(mapelAktifTerpilih_() || (ADMIN.settings && ADMIN.settings.mapel) || '');
  } catch (error) {
    setTableMessage('questionTable', 'Gagal memuat bank soal.', 'fa-triangle-exclamation');
  } finally { ADMIN.refreshBusy.questions = false; }
}

/** Menyaring bank soal berdasarkan kata kunci, tipe, kelas sasaran, dan status. */
function terapkanFilterSoal_() {
  var kueri = kueriFilter_('cariSoal');
  var tipe = nilaiFilter_('filterSoalTipe');
  var status = nilaiFilter_('filterSoalStatus');
  var tingkat = nilaiFilter_('filterSoalTingkat');
  // REVISI 2 mapel: pilihan filter mapel dibangun dari bank soal termuat.
  isiFilterMapel_('filterSoalMapel', DATA_MENTAH.soal, function(q) { return q.mapel; });
  var mapel = nilaiFilter_('filterSoalMapel');
  var rows = DATA_MENTAH.soal.slice();
  if (tipe) rows = rows.filter(function(q) { return String(q.tipe || '') === tipe; });
  if (status) rows = rows.filter(function(q) { return status === 'aktif' ? !!q.aktif : !q.aktif; });
  // Filter kelas sasaran bersifat per soal: soal tanpa tingkat dianggap SEMUA.
  if (tingkat) rows = rows.filter(function(q) { return tingkatDariNilai_(q.tingkat) === tingkat; });
  if (mapel) rows = rows.filter(function(q) { return cocokFilterMapel_(q.mapel, mapel); });
  rows = saringKata_(rows, kueri, function(q) {
    return [q.id_soal, q.tipe, SRich.stripHtml(q.pertanyaan), q.mapel, readableKey(q), optionSummary(q), q.stimulus_deskripsi,
      tingkatDariNilai_(q.tingkat)].join(' ');
  });
  if (!rows.length && adaFilterAktif_(kueri, tipe, status, tingkat, mapel)) {
    tampilTidakDitemukan_('questionTable', kueri, DATA_MENTAH.soal.length + ' soal tersimpan di bank soal.');
    return;
  }
  renderQuestionTable(rows);
}

function renderQuestionTable(rows) {
  if (!rows.length) {
    setTableMessage('questionTable', 'Belum ada soal. Tambahkan soal pertama Anda.', 'fa-inbox');
    return;
  }
  var html = '<table class="admin-table"><thead><tr><th>ID</th><th>Tipe</th><th>Mapel</th><th>Pertanyaan</th><th>Kelas</th><th>Opsi / Kunci</th><th>Stimulus</th><th>Poin</th><th>Status</th><th>Aksi</th></tr></thead><tbody>';
  rows.forEach(function(question) {
    var tingkatSoal = tingkatDariNilai_(question.tingkat);
    html += '<tr><td><strong>#' + escapeAdmin(question.id_soal) + '</strong></td>' +
      '<td>' + typeBadge(question.tipe) + '</td>' +
      '<td><div class="cell-wrap">' + badge(question.mapel || '-', 'blue') + '</div></td>' +
      '<td><div class="cell-wrap">' + escapeAdmin(truncate(SRich.stripHtml(question.pertanyaan), 150)) + '</div></td>' +
      // Kolom kelas sasaran: memudahkan memastikan satu perubahan kelas tidak
      // ikut menyeret soal nomor lain.
      '<td>' + badge(tingkatSoal === 'SEMUA' ? 'SEMUA' : tingkatSoal, tingkatSoal === 'SEMUA' ? 'gray' : 'blue') + '</td>' +
      '<td><div class="cell-wrap"><strong>Opsi:</strong> ' + escapeAdmin(optionSummary(question)) + '<br><strong>Kunci:</strong> ' + escapeAdmin(readableKey(question)) + '</div></td>' +
      '<td>' + stimulusBadges_(question) + '</td>' +
      '<td>' + escapeAdmin(question.poin) + '</td>' +
      '<td>' + (question.aktif ? '<span class="badge green">Aktif</span>' : '<span class="badge gray">Nonaktif</span>') + '</td>' +
      '<td><div class="row-actions"><button class="mini-button edit" data-edit-question="' + escapeAdmin(question.id_soal) + '" type="button"><i class="fa-solid fa-pen"></i> Edit</button><button class="mini-button delete" data-delete-question="' + escapeAdmin(question.id_soal) + '" type="button"><i class="fa-solid fa-trash"></i></button></div></td></tr>';
  });
  html += '</tbody></table>';
  document.getElementById('questionTable').innerHTML = html;
  document.querySelectorAll('[data-edit-question]').forEach(function(button) { button.addEventListener('click', function() { openEditQuestion(this.dataset.editQuestion); }); });
  document.querySelectorAll('[data-delete-question]').forEach(function(button) { button.addEventListener('click', function() { deleteQuestion(this.dataset.deleteQuestion); }); });
}

function openEditQuestion(id) {
  var question = ADMIN.questions.concat(DATA_MENTAH.soal || []).filter(function(item) { return String(item.id_soal) === String(id); })[0];
  if (!question) {
    hasilGagal_('Soal Tidak Ditemukan', 'Data soal #' + id + ' tidak ada pada daftar. Tekan Refresh lalu coba lagi.');
    return;
  }
  document.getElementById('eId').value = question.id_soal;
  document.getElementById('eTipe').value = question.tipe;
  document.getElementById('ePoin').value = question.poin;
  document.getElementById('eTingkat').value = tingkatDariNilai_(question.tingkat);
  // REVISI pindah mapel: isi kolom mapel + saran datalist.
  EDIT_MAPEL_LAMA_ = String(question.mapel || '').trim();
  isiDatalistMapelSoal_();
  var elMapelEdit = document.getElementById('eMapel');
  if (elMapelEdit) elMapelEdit.value = EDIT_MAPEL_LAMA_ || mapelDiujikan_();
  document.getElementById('ePertanyaan').value = question.pertanyaan;
  if (RTE_PERTANYAAN.e) RTE_PERTANYAAN.e.setHtml(question.pertanyaan);
  setNilaiInput_('eDeskripsiStimulus', question.stimulus_deskripsi || '');
  // Isi editor terstruktur PGK Kategori & Menjodohkan dari data soal tersimpan.
  var tipeSoal = String(question.tipe || '').toUpperCase();
  if (tipeSoal === 'PGK') {
    var infoKat = SRich.pgkCategories(question);
    var kunciObj = tryJson(question.kunci_jawaban, question.kunci_jawaban);
    var rowsData = (question.opsi || []).map(function(op, idx) {
      var k = '';
      if (kunciObj && typeof kunciObj === 'object' && !Array.isArray(kunciObj)) {
        k = String(kunciObj[op.id !== undefined ? op.id : String(idx)] || '');
      }
      if (!k && typeof question.kunci_jawaban === 'string' && question.kunci_jawaban.indexOf(',') !== -1) {
        k = String(question.kunci_jawaban.split(',')[idx] || '').trim();
      }
      return { html: op.text || '', kunci: k };
    });
    resetPgkEditor('e', { kategori: infoKat.kategori, rows: rowsData.length ? rowsData : null });
  }
  if (tipeSoal === 'MENJODOHKAN') {
    resetJodohEditor('e', (question.opsi || []).map(function(op) {
      return { text: SRich.stripHtml(op.text || ''), pasangan: SRich.stripHtml(op.pasangan || '') };
    }));
  }
  document.getElementById('eOpsi').value = optionsToLines(question);
  document.getElementById('eKunci').value = editableKey(question);
  document.getElementById('eImageLink').value = question.stimulus_gambar || '';
  document.getElementById('eImageFile').value = '';
  document.getElementById('eImageAlt').value = question.stimulus_alt || '';
  document.getElementById('eVideoLink').value = question.stimulus_video || '';
  document.getElementById('eVideoFile').value = '';
  document.getElementById('eVideoAlt').value = question.stimulus_video_alt || '';
  document.getElementById('eAktif').checked = !!question.aktif;
  document.getElementById('eHapusGambar').checked = false;
  document.getElementById('eHapusVideo').checked = false;
  document.getElementById('eMediaStatus').className = 'media-status';
  document.getElementById('eUploadProgress').classList.remove('show');
  updateQuestionFormatHelp('e');
  previewEditMedia();
  document.getElementById('editQuestionModal').classList.add('show');
}

function closeEditQuestion() { document.getElementById('editQuestionModal').classList.remove('show'); }

async function saveEditedQuestion() {
  if (ADMIN.operationBusy.editQuestion) return;
  var galatStruktur = validateSoalStruct_('e');
  if (galatStruktur) {
    await hasilGagal_('Perubahan Gagal Disimpan', galatStruktur);
    return;
  }
  // REVISI pindah mapel: mapel soal tidak boleh kosong.
  var elMapelWajib = document.getElementById('eMapel');
  if (elMapelWajib && !String(elMapelWajib.value || '').trim()) {
    await hasilInfo_('Mapel Soal Wajib Diisi', 'Kolom Mapel soal tidak boleh kosong. Pilih salah satu mapel milik akun ini.');
    return;
  }
  ADMIN.operationBusy.editQuestion = true;
  setFormBusy('editQuestionForm', true);
  try {
    var payload = await buildQuestionPayload('e');
    var elMapelTujuan = document.getElementById('eMapel');
    var mapelTujuan = elMapelTujuan ? String(elMapelTujuan.value || '').trim() : '';
    var result = await apiWajib_('updateSoal', payload);
    closeEditQuestion();
    await segarkanSenyap_([loadQuestions, loadDashboard]);
    // REVISI pindah mapel: pastikan server benar-benar menerapkan mapel baru.
    var tersimpan = (DATA_MENTAH.soal || []).filter(function(x) { return String(x.id_soal) === String(payload.id_soal); })[0];
    var mapelAktual = tersimpan ? String(tersimpan.mapel || '').trim() : mapelTujuan;
    var rincianUbah = [
      { label: 'Nomor soal', nilai: '#' + String(payload.id_soal || '-') },
      { label: 'Mapel', nilai: mapelAktual || '-' },
      { label: 'Tipe soal', nilai: labelTipeSoal_(payload.tipe) },
      { label: 'Kelas sasaran', nilai: labelTingkat_(payload.tingkat) + ' (hanya soal ini)' },
      { label: 'Status', nilai: payload.aktif ? 'Aktif' : 'Nonaktif' }
    ];
    if (EDIT_MAPEL_LAMA_ && mapelTujuan && EDIT_MAPEL_LAMA_.toLowerCase() !== mapelTujuan.toLowerCase()) {
      rincianUbah.splice(2, 0, { label: 'Dipindahkan dari', nilai: EDIT_MAPEL_LAMA_ });
    }
    if (tersimpan && mapelTujuan && mapelAktual.toLowerCase() !== mapelTujuan.toLowerCase()) {
      await hasilInfo_('Mapel Belum Berpindah',
        'Perubahan soal lainnya tersimpan, tetapi mapel soal masih "' + (mapelAktual || '-') +
        '". Server belum menerapkan kolom mapel pada pembaruan soal. ' +
        'Solusi sementara: salin isi soal ini, hapus soal, aktifkan mapel "' + mapelTujuan +
        '" di Pengaturan, lalu buat ulang / import via CSV dengan kolom mapel.',
        rincianUbah);
    } else {
      await hasilSukses_('Perubahan Tersimpan', result.message || 'Perubahan soal berhasil disimpan.', rincianUbah);
    }
  } catch (error) {
    await hasilGagal_('Perubahan Gagal Disimpan', error.message || 'Perubahan soal gagal disimpan.');
  } finally {
    ADMIN.operationBusy.editQuestion = false;
    setFormBusy('editQuestionForm', false);
  }
}

async function deleteQuestion(id) {
  var setuju = await konfirmasi_('Soal #' + id + ' akan dihapus beserta berkas gambar/video-nya di Google Drive. ' +
    'Bila soal sedang dipakai peserta aktif, sistem hanya menonaktifkannya demi menjaga ujian yang berjalan.',
    { judul: 'Hapus Soal', nada: 'danger', teksOk: 'Ya, Hapus Soal' });
  if (!setuju) return;
  try {
    var result = await apiWajib_('hapusSoal', { id_soal: id });
    await segarkanSenyap_([loadQuestions, loadDashboard]);
    var rincianHapus = [{ label: 'Nomor soal', nilai: '#' + String(id) }];
    if (result.berkasDihapus && result.berkasDihapus.length) {
      rincianHapus.push({ label: 'Berkas Storage dihapus', nilai: result.berkasDihapus.join(', ') });
    }
    if (result.berkasDilewati && result.berkasDilewati.length) {
      rincianHapus.push({ label: 'Tidak ikut dihapus', nilai: result.berkasDilewati.join('; ') });
    }
    await hasilSukses_('Soal Dihapus', result.message || 'Soal berhasil dihapus.', rincianHapus);
  } catch (error) {
    await hasilGagal_('Soal Gagal Dihapus', error.message || 'Soal gagal dihapus.');
  }
}

function stimulusBadges_(question) {
  var badges = [];
  if (question.stimulus_gambar) badges.push('<span class="badge blue"><i class="fa-regular fa-image"></i> Gambar</span>');
  if (question.stimulus_video) badges.push('<span class="badge blue"><i class="fa-solid fa-film"></i> Video</span>');
  return badges.length ? badges.join(' ') : '<span class="badge gray">-</span>';
}

function optionsToLines(question) {
  return (question.opsi || []).map(function(option) {
    // Menjodohkan disajikan ulang dalam format "pernyataan = jawaban".
    // stripHtml: bila opsi tersimpan sebagai HTML (mis. rumus [data-tex]),
    // ditampilkan sebagai teks LaTeX polos agar bisa disunting ulang.
    if (option.pasangan) return SRich.stripHtml(option.text || '') + ' = ' + SRich.stripHtml(option.pasangan || '');
    return SRich.stripHtml(option.text || '');
  }).join('\n');
}
function readableKey(question) {
  var type = question.tipe;
  if (type === 'PGK_MCMA') {
    var choices = tryJson(question.kunci_jawaban, []);
    return Array.isArray(choices) ? choices.join(', ') : String(question.kunci_jawaban || '-');
  }
  if (type === 'PGK') {
    var object = tryJson(question.kunci_jawaban, {});
    return Object.keys(object).map(function(key) { return object[key]; }).join(' / ');
  }
  if (type === 'MENJODOHKAN') {
    var jodoh = tryJson(question.kunci_jawaban, {});
    var daftar = Array.isArray(question.opsi) ? question.opsi : [];
    if (daftar.length) {
      return daftar.map(function(option, index) {
        return (index + 1) + '. ' + truncate(option.text || '', 30) + ' = ' + (jodoh[option.id] || '-');
      }).join('\n');
    }
    return Object.keys(jodoh).map(function(key) { return key + ' = ' + jodoh[key]; }).join('\n');
  }
  return String(question.kunci_jawaban || '-');
}
function editableKey(question) { return readableKey(question); }
function optionSummary(question) {
  if (!question.opsi || !question.opsi.length) return '-';
  return question.opsi.map(function(option, index) {
    var marker = option.label || option.id || String(index + 1);
    var teks = truncate(SRich.stripHtml(option.text || ''), 45);
    // Menjodohkan menampilkan pasangannya sekaligus agar mudah diperiksa.
    if (option.pasangan) teks += ' = ' + truncate(SRich.stripHtml(option.pasangan), 35);
    return marker + '. ' + teks;
  }).join(' | ');
}

/* =============================== MONITOR =============================== */
async function loadMonitor() {
  if (!ADMIN.token || ADMIN.refreshBusy.monitor) return;
  ADMIN.refreshBusy.monitor = true;
  try {
    var result = await adminApi('getSesiAktif', {});
    if (!guardAdminResult(result)) return;
    DATA_MENTAH.monitor = result.data || [];
    terapkanFilterMonitor_();
  } catch (error) { setTableMessage('monitorTable', 'Gagal memuat monitor peserta.', 'fa-triangle-exclamation'); }
  finally { ADMIN.refreshBusy.monitor = false; }
}

/** Menyaring daftar peserta aktif berdasarkan nama, username, atau kelas. */
function terapkanFilterMonitor_() {
  var kueri = kueriFilter_('cariMonitor');
  // REVISI 2 mapel: filter mapel untuk akun yang memegang 2 mapel.
  isiFilterMapel_('filterMonitorMapel', DATA_MENTAH.monitor, function(r) { return r.mapel; });
  var mapel = nilaiFilter_('filterMonitorMapel');
  var rows = saringKata_(DATA_MENTAH.monitor, kueri, function(r) {
    return [r.nama, r.username, r.kelas, r.mapel, r.status].join(' ');
  });
  if (mapel) rows = rows.filter(function(r) { return cocokFilterMapel_(r.mapel, mapel); });
  if (!rows.length && adaFilterAktif_(kueri, mapel)) {
    tampilTidakDitemukan_('monitorTable', kueri, DATA_MENTAH.monitor.length + ' peserta sedang aktif.');
    return;
  }
  renderMonitor(rows);
}

function renderMonitor(rows) {
  if (!rows.length) { setTableMessage('monitorTable', 'Tidak ada peserta aktif saat ini.', 'fa-user-clock'); return; }
  var html = '<table class="admin-table"><thead><tr><th>Peserta</th><th>Kelas</th><th>Mapel</th><th>Status</th><th>Sisa Waktu</th><th>Pelanggaran / Tab</th><th>Terakhir Aktif</th><th>Aksi</th></tr></thead><tbody>';
  rows.forEach(function(row) {
    html += '<tr><td><strong>' + escapeAdmin(row.nama) + '</strong><br><span style="color:#71879c;font-size:11px">' + escapeAdmin(row.username) + '</span></td>' +
      '<td>' + badge(row.kelas, 'blue') + '</td><td>' + escapeAdmin(row.mapel) + '</td>' +
      '<td>' + statusBadge(row.status) + '<br>' + badge(row.online ? 'Terhubung' : 'Tidak respons', row.online ? 'green' : 'red') + '</td><td><strong>' + formatSeconds(row.remaining_seconds) + '</strong></td>' +
      '<td>' + badge('Total ' + row.jumlah_pelanggaran, row.jumlah_pelanggaran >= 2 ? 'red' : (row.jumlah_pelanggaran ? 'amber' : 'green')) + '<br>' + badge('Tab ' + (row.jumlah_pindah_tab || 0) + '/3', (row.jumlah_pindah_tab || 0) >= 2 ? 'red' : 'blue') + '</td>' +
      '<td>' + escapeAdmin(formatDate(row.last_seen)) + '</td><td><button class="mini-button disqualify" type="button" data-dq-session="' + escapeAdmin(row.session_id) + '"><i class="fa-solid fa-ban"></i> Diskualifikasi</button></td></tr>';
  });
  html += '</tbody></table>';
  document.getElementById('monitorTable').innerHTML = html;
  document.querySelectorAll('[data-dq-session]').forEach(function(button) { button.addEventListener('click', function() { disqualifySession(this.dataset.dqSession); }); });
}

async function disqualifySession(sessionId) {
  var reason = await tanya_('Peserta akan dikeluarkan dari ujian dan tidak dapat melanjutkan.',
    { judul: 'Diskualifikasi Peserta', nada: 'danger', label: 'Alasan diskualifikasi',
      placeholder: 'Contoh: terbukti membuka aplikasi lain', teksOk: 'Diskualifikasi' });
  if (reason === null) return;
  if (!reason.trim()) {
    await hasilInfo_('Alasan Wajib Diisi', 'Alasan diskualifikasi wajib diisi agar tercatat pada log audit. Silakan ulangi.');
    return;
  }
  try {
    var result = await apiWajib_('diskualifikasiPeserta', { sessionId: sessionId, alasan: reason });
    await segarkanSenyap_([loadMonitor, loadDashboard, loadViolations]);
    await hasilSukses_('Peserta Didiskualifikasi', result.message || 'Peserta telah dikeluarkan dari ujian.', [
      { label: 'Alasan', nilai: reason.trim() },
      { label: 'Tindak lanjut', nilai: 'Dapat dipulihkan di menu Pelanggaran' }
    ]);
  } catch (error) {
    await hasilGagal_('Diskualifikasi Gagal', error.message || 'Diskualifikasi gagal diproses.');
  }
}

/* ============================= PELANGGARAN ============================= */
async function loadViolations() {
  if (!ADMIN.token || ADMIN.refreshBusy.violations) return;
  ADMIN.refreshBusy.violations = true;
  try {
    var result = await adminApi('getPelanggaran', {});
    if (!guardAdminResult(result)) return;
    DATA_MENTAH.pelanggaran = result.data || [];
    terapkanFilterPelanggaran_();
  } catch (error) { setTableMessage('violationTable', 'Gagal memuat data pelanggaran.', 'fa-triangle-exclamation'); }
  finally { ADMIN.refreshBusy.violations = false; }
}

/** Menyaring log pelanggaran berdasarkan peserta, kelas, atau jenis. */
function terapkanFilterPelanggaran_() {
  var kueri = kueriFilter_('cariPelanggaran');
  var rows = saringKata_(DATA_MENTAH.pelanggaran, kueri, function(r) {
    return [r.nama, r.username, r.kelas, r.jenis_label, r.detail, r.tindakan].join(' ');
  });
  if (!rows.length && kueri) {
    tampilTidakDitemukan_('violationTable', kueri, DATA_MENTAH.pelanggaran.length + ' pelanggaran tercatat.');
    return;
  }
  renderViolationTable(rows);
}

/** Badge jenis pelanggaran; indikasi AI disorot khusus untuk pengawas. */
function badgeJenisPelanggaran_(row) {
  var jenis = String(row.jenis || '');
  var label = String(row.jenis_label || jenis.replace(/_/g, ' ') || '-');
  if (/indikasi_ai|indikasi ai/i.test(jenis + label)) {
    return '<span class="badge red"><i class="fa-solid fa-robot"></i> INDIKASI AI</span> ' + escapeAdmin(label);
  }
  return escapeAdmin(label);
}

/* REVISI rata tengah: sel deskripsi rata kiri-kanan bila panjang (>80 karakter),
   rata tengah bila singkat. */
function selDeskripsiTengah_(teks) {
  var isi = (teks === null || teks === undefined || teks === '') ? '-' : String(teks);
  var kelas = isi.length > 80 ? ' class="sel-justify"' : '';
  return '<td' + kelas + '><div class="cell-wrap">' + escapeAdmin(isi) + '</div></td>';
}

function renderViolationTable(rows) {
  if (!rows.length) { setTableMessage('violationTable', 'Belum ada pelanggaran tercatat.', 'fa-shield-heart'); return; }
  var html = '<table class="admin-table"><thead><tr><th>Waktu</th><th>Peserta</th><th>Kelas</th><th>Jenis Pelanggaran</th><th>Detail</th><th>Ke-</th><th>Tindakan</th><th>Email</th></tr></thead><tbody>';
  rows.forEach(function(row) {
    html += '<tr><td>' + escapeAdmin(formatDate(row.timestamp)) + '</td><td><strong>' + escapeAdmin(row.nama) + '</strong><br><span style="font-size:11px;color:#71879c">' + escapeAdmin(row.username) + '</span></td>' +
      '<td>' + badge(row.kelas, 'blue') + '</td><td><div class="cell-wrap">' + badgeJenisPelanggaran_(row) + '</div></td>' + selDeskripsiTengah_(row.detail) + '' +
      '<td>' + badge(String(row.jumlah), row.jumlah >= 3 ? 'red' : 'amber') + '</td><td>' + statusBadge(row.tindakan) + '</td><td><div class="cell-wrap">' + escapeAdmin(row.email_status || '-') + '</div></td></tr>';
  });
  html += '</tbody></table>';
  document.getElementById('violationTable').innerHTML = html;
}

/* ====================== PEMULIHAN DISKUALIFIKASI ====================== */
async function loadDisqualified() {
  if (!ADMIN.token) return;
  try {
    var result = await adminApi('getDaftarDiskualifikasi', {});
    if (!guardAdminResult(result)) return;
    renderDisqualifiedTable(result.data || []);
  } catch (error) {
    setTableMessage('diskualifikasiTable', 'Gagal memuat data diskualifikasi.', 'fa-triangle-exclamation');
  }
}

function renderDisqualifiedTable(rows) {
  if (!rows.length) {
    setTableMessage('diskualifikasiTable', 'Tidak ada peserta yang terdiskualifikasi.', 'fa-shield-heart');
    return;
  }
  var html = '<table class="admin-table"><thead><tr><th>Waktu</th><th>Peserta</th><th>Kelas</th><th>Alasan</th><th>Status</th><th>Tindakan</th></tr></thead><tbody>';
  rows.forEach(function(row) {
    var tombol = row.aktif ?
      '<button class="mini-button restore" type="button" data-restore="' + escapeAdmin(row.identityKey) +
        '" data-nama="' + escapeAdmin(row.nama) + '"><i class="fa-solid fa-unlock"></i> Pulihkan</button>' :
      '<span style="font-size:11px;color:#71879c">Sudah dipulihkan</span>';
    html += '<tr><td>' + escapeAdmin(formatDate(row.timestamp)) + '</td>' +
      '<td><strong>' + escapeAdmin(row.nama) + '</strong><br><span style="font-size:11px;color:#71879c">' +
      escapeAdmin(row.username) + '</span></td>' +
      '<td>' + badge(row.kelas, 'blue') + '</td>' +
      '' + selDeskripsiTengah_(row.alasan) + '' +
      '<td>' + badge(row.aktif ? 'DIBLOKIR' : 'AKTIF KEMBALI', row.aktif ? 'red' : 'green') + '</td>' +
      '<td>' + tombol + '</td></tr>';
  });
  html += '</tbody></table>';
  document.getElementById('diskualifikasiTable').innerHTML = html;
  document.querySelectorAll('[data-restore]').forEach(function(button) {
    button.addEventListener('click', function() {
      pulihkanPeserta(this.dataset.restore, this.dataset.nama || 'Peserta');
    });
  });
}

function modePemulihanTerpilih_() {
  var pilih = document.getElementById('modePemulihan');
  return pilih && pilih.value === 'lanjut' ? 'lanjut' : 'ulang';
}

async function pulihkanPeserta(identityKey, nama) {
  var mode = modePemulihanTerpilih_();
  var penjelasan = mode === 'lanjut' ?
    'Peserta melanjutkan sesi lama beserta jawaban dan sisa waktunya.' :
    'Sesi lama dibatalkan. Peserta mengulang ujian dari awal dengan waktu penuh.';
  var alasan = await tanya_(nama + ' akan dapat login dan mengikuti ujian kembali. ' + penjelasan,
    { judul: 'Pulihkan Peserta', nada: 'warn', label: 'Alasan pemulihan',
      placeholder: 'Contoh: kendala jaringan, sudah diklarifikasi pengawas', teksOk: 'Pulihkan' });
  if (alasan === null) return;
  try {
    var result = await apiWajib_('pulihkanDiskualifikasi',
      { identityKey: identityKey, mode: mode, alasan: alasan });
    await segarkanSenyap_([loadDisqualified, loadMonitor]);
    await hasilSukses_('Peserta Dipulihkan', result.message || 'Peserta dapat mengikuti ujian kembali.', [
      { label: 'Peserta', nilai: nama },
      { label: 'Mode', nilai: mode === 'lanjut' ? 'Lanjutkan sesi lama' : 'Ulang dari awal' },
      { label: 'Alasan', nilai: (alasan || '-').trim() || '-' }
    ]);
  } catch (error) {
    await hasilGagal_('Pemulihan Gagal', error.message || 'Pemulihan peserta gagal diproses.');
  }
}

/** Hapus SEMUA catatan diskualifikasi sekaligus (daftar + blokir bersih). */
async function resetDataDiskualifikasi() {
  var setuju = await konfirmasi_(
    'SEMUA catatan diskualifikasi akan dihapus permanen (daftar + blokir). ' +
    'Sesi peserta yang masih terblokir dikembalikan ke JEDA dengan waktu penuh. ' +
    'Tindakan ini TIDAK bisa dibatalkan.',
    { judul: 'Reset Data Diskualifikasi', nada: 'danger', teksOk: 'Ya, Reset Data' });
  if (!setuju) return;
  try {
    var result = await apiWajib_('resetDataDiskualifikasi', {});
    await segarkanSenyap_([loadDisqualified, loadMonitor]);
    await hasilSukses_('Reset Data Selesai', result.message || 'Data diskualifikasi berhasil di-reset.', [
      { label: 'Catatan dihapus', nilai: String(result.jumlahCatatan !== undefined ? result.jumlahCatatan : '-') },
      { label: 'Sesi dikembalikan', nilai: String(result.jumlahSesi !== undefined ? result.jumlahSesi : '-') }
    ]);
  } catch (error) {
    await hasilGagal_('Reset Data Gagal', error.message || 'Reset data diskualifikasi gagal diproses.');
  }
}

async function pulihkanSemuaPeserta() {
  var mode = modePemulihanTerpilih_();
  var setuju = await konfirmasi_('Semua peserta yang terdiskualifikasi akan dapat login kembali dengan mode ' +
    (mode === 'lanjut' ? 'lanjutkan sesi' : 'ulang dari awal') + '.',
    { judul: 'Pulihkan Semua Peserta', nada: 'danger', teksOk: 'Pulihkan Semua' });
  if (!setuju) return;
  try {
    var result = await apiWajib_('pulihkanSemuaDiskualifikasi', { mode: mode });
    await segarkanSenyap_([loadDisqualified, loadMonitor]);
    await hasilSukses_('Pemulihan Massal Selesai', result.message || 'Seluruh peserta terdiskualifikasi telah dipulihkan.', [
      { label: 'Mode', nilai: mode === 'lanjut' ? 'Lanjutkan sesi lama' : 'Ulang dari awal' },
      { label: 'Peserta dipulihkan', nilai: String(result.jumlah !== undefined ? result.jumlah : '-') }
    ]);
  } catch (error) {
    await hasilGagal_('Pemulihan Massal Gagal', error.message || 'Pemulihan massal gagal diproses.');
  }
}

/* ================================ HASIL ================================ */
async function loadResults() {
  if (!ADMIN.token || ADMIN.refreshBusy.results) return;
  ADMIN.refreshBusy.results = true;
  try {
    var result = await adminApi('getHasilUjian', { kelas: document.getElementById('filterHasilKelas').value.trim() });
    if (!guardAdminResult(result)) return;
    DATA_MENTAH.hasil = result.data || [];
    terapkanFilterHasil_();
  } catch (error) { setTableMessage('resultTable', 'Gagal memuat hasil ujian.', 'fa-triangle-exclamation'); }
  finally { ADMIN.refreshBusy.results = false; }
}

/** Menyaring hasil ujian berdasarkan nama atau username peserta. */
function terapkanFilterHasil_() {
  var kueri = kueriFilter_('cariHasil');
  var kelas = kueriFilter_('filterHasilKelas');
  // REVISI 2 mapel: filter mapel untuk akun yang memegang 2 mapel.
  isiFilterMapel_('filterHasilMapel', DATA_MENTAH.hasil, function(r) { return r.mapel; });
  var mapel = nilaiFilter_('filterHasilMapel');
  var rows = saringKata_(DATA_MENTAH.hasil, kueri, function(r) {
    return [r.nama, r.username, r.kelas, r.mapel, r.status_kelulusan].join(' ');
  });
  if (mapel) rows = rows.filter(function(r) { return cocokFilterMapel_(r.mapel, mapel); });
  if (!rows.length && adaFilterAktif_(kueri, kelas, mapel)) {
    tampilTidakDitemukan_('resultTable', kueri || kelas, DATA_MENTAH.hasil.length + ' hasil termuat untuk filter kelas saat ini.');
    return;
  }
  renderResultTable(rows);
}

function renderResultTable(rows) {
  if (!rows.length) { setTableMessage('resultTable', 'Belum ada hasil ujian sesuai filter.', 'fa-inbox'); return; }
  var html = '<table class="admin-table"><thead><tr><th>Peserta</th><th>Kelas</th><th>Kehadiran</th><th>Mapel</th><th>Status</th><th>Skor</th><th>KKM</th><th>Ketuntasan</th><th>Benar/Salah</th><th>Uraian</th><th>Pelanggaran</th><th>Selesai</th></tr></thead><tbody>';
  rows.forEach(function(row) {
    html += '<tr><td><strong>' + escapeAdmin(row.nama) + '</strong><br><span style="font-size:11px;color:#71879c">' + escapeAdmin(row.username) + '</span></td><td>' + badge(row.kelas, 'blue') + '</td>' +
      '<td>' + lencanaKehadiran_(row.kehadiran) + '</td>' +
      '<td>' + escapeAdmin(row.mapel) + '</td><td>' + statusBadge(row.status) + '</td><td><strong>' + numberDisplay(row.persen) + '%</strong><br><span style="font-size:11px;color:#71879c">' + numberDisplay(row.total_nilai) + '/' + numberDisplay(row.total_poin) + '</span></td>' +
      '<td>' + numberDisplay(row.kkm || 75) + '</td><td>' + kelulusanBadge_(row.status_kelulusan) + '</td>' +
      '<td>' + numberDisplay(row.benar) + ' / ' + numberDisplay(row.salah) + '</td><td>' + badge(String(row.belum_dinilai), row.belum_dinilai ? 'amber' : 'gray') + '</td><td>' + badge(String(row.jumlah_pelanggaran), row.jumlah_pelanggaran >= 3 ? 'red' : (row.jumlah_pelanggaran ? 'amber' : 'green')) + '</td>' +
      '<td>' + escapeAdmin(formatDate(row.finished_at)) + '</td></tr>';
  });
  html += '</tbody></table>';
  document.getElementById('resultTable').innerHTML = html;
}

function kelulusanBadge_(status) {
  var value = String(status || '').toUpperCase();
  if (value === 'TUNTAS') return badge('TUNTAS', 'green');
  if (value === 'REMEDIAL') return badge('REMEDIAL', 'red');
  return badge('MENUNGGU NILAI', 'amber');
}

/* =============================== URAIAN =============================== */
async function loadEssays() {
  if (!ADMIN.token || ADMIN.refreshBusy.essays) return;
  ADMIN.refreshBusy.essays = true;
  try {
    var result = await adminApi('getJawabanUraian', {
      kelas: document.getElementById('filterUraianKelas').value.trim(),
      hanyaPending: document.getElementById('filterUraianPending').checked
    });
    if (!guardAdminResult(result)) return;
    DATA_MENTAH.uraian = result.data || [];
    terapkanFilterUraian_();
  } catch (error) {
    setTableMessage('essayTable', 'Gagal memuat jawaban uraian.', 'fa-triangle-exclamation');
  } finally {
    ADMIN.refreshBusy.essays = false;
  }
}

/* ==================================================================
 * NILAI URAIAN — DRAFT KETIKAN ADMIN
 *
 * Tabel Nilai Uraian disegarkan otomatis setiap 10 detik. Sebelumnya
 * renderEssayTable() menulis ulang innerHTML tabel, sehingga angka yang
 * sedang diketik admin lenyap dan kembali ke nilai tersimpan di server
 * (0 bila belum dinilai) — bahkan sebelum tombol Simpan ditekan.
 * Ketikan kini disimpan sebagai draft per jawaban dan dipulihkan setiap
 * kali tabel digambar ulang. Penyegaran otomatis 10 detik juga dilewati
 * selama masih ada nilai yang belum disimpan.
 * ================================================================== */

/** Kunci unik satu baris jawaban uraian. */
function kunciBarisUraian_(sessionId, idSoal) {
  return String(sessionId === undefined || sessionId === null ? '' : sessionId) +
    '#' + String(idSoal === undefined || idSoal === null ? '' : idSoal);
}

/** Benar bila ada kolom nilai yang sedang diketik atau belum disimpan. */
function adaNilaiUraianDiedit_() {
  var aktif = document.activeElement;
  if (aktif && aktif.classList && aktif.classList.contains('essay-score')) return true;
  return Object.keys(ADMIN.essayDrafts || {}).length > 0;
}

/** Memasang kembali ketikan admin setelah tabel digambar ulang. */
function pulihkanDraftUraian_() {
  var draft = ADMIN.essayDrafts || {};
  if (!Object.keys(draft).length) return;
  document.querySelectorAll('#essayTable tbody tr').forEach(function(tr) {
    var tombol = tr.querySelector('[data-grade-session]');
    var input = tr.querySelector('.essay-score');
    if (!tombol || !input) return;
    var kunci = kunciBarisUraian_(tombol.dataset.gradeSession, tombol.dataset.gradeQuestion);
    if (!(kunci in draft)) return;
    input.value = draft[kunci];
    tr.classList.add('essay-row-draft');
    var penanda = tr.querySelector('.essay-draft-flag');
    if (penanda) penanda.style.display = 'inline';
  });
}

/** Membuang draft satu jawaban setelah nilainya tersimpan di server. */
function hapusDraftUraian_(sessionId, idSoal) {
  delete ADMIN.essayDrafts[kunciBarisUraian_(sessionId, idSoal)];
}

/** Menyaring jawaban uraian berdasarkan nama atau username peserta. */
function terapkanFilterUraian_() {
  var kueri = kueriFilter_('cariUraian');
  var kelas = kueriFilter_('filterUraianKelas');
  var rows = saringKata_(DATA_MENTAH.uraian, kueri, function(r) {
    return [r.nama, r.username, r.kelas, r.pertanyaan].join(' ');
  });
  if (!rows.length && adaFilterAktif_(kueri, kelas)) {
    tampilTidakDitemukan_('essayTable', kueri || kelas, DATA_MENTAH.uraian.length + ' jawaban uraian termuat untuk filter saat ini.');
    return;
  }
  renderEssayTable(rows);
}

function renderEssayTable(rows) {
  if (!rows.length) {
    setTableMessage('essayTable', 'Tidak ada jawaban uraian sesuai filter.', 'fa-pen-ruler');
    return;
  }
  var html = '<table class="admin-table"><thead><tr><th>Peserta</th><th>Soal / Rubrik</th><th>Jawaban</th><th>Status</th><th>Nilai</th><th>Aksi</th></tr></thead><tbody>';
  rows.forEach(function(row) {
    // Nilai yang belum diisi (null/undefined/kosong) harus tampil KOSONG.
    // Sebelumnya Number(null) menghasilkan 0 sehingga kolom nilai seolah
    // sudah berisi 0 padahal jawabannya belum dinilai.
    var nilaiTersimpan = row.nilai;
    var numericScore = (nilaiTersimpan === null || nilaiTersimpan === undefined ||
      String(nilaiTersimpan).trim() === '')
      ? ''
      : (isFinite(Number(nilaiTersimpan)) ? Number(nilaiTersimpan) : '');
    html += '<tr><td><strong>' + escapeAdmin(row.nama) + '</strong><br>' + badge(row.kelas, 'blue') + '<br><span style="font-size:11px;color:#71879c">' + escapeAdmin(row.username) + '</span></td>' +
      '<td><div class="essay-question"><strong>Soal #' + escapeAdmin(row.id_soal) + '</strong><br>' + escapeAdmin(SRich.stripHtml(row.pertanyaan)) + '</div><div class="essay-rubric"><strong>Rubrik:</strong><br>' + escapeAdmin(row.rubrik || '-') + '</div></td>' +
      '<td><div class="essay-answer">' + escapeAdmin(row.jawaban || '-') + '</div></td><td>' + statusBadge(row.status) + '</td>' +
      '<td><input class="admin-input essay-score" type="number" min="0" max="' + escapeAdmin(row.poin_maksimal) + '" step="0.01" value="' + escapeAdmin(numericScore) + '" inputmode="decimal" autocomplete="off" aria-label="Nilai uraian maksimal ' + escapeAdmin(row.poin_maksimal) + '"><br><small>Maks. ' + escapeAdmin(row.poin_maksimal) + '</small> <small class="essay-draft-flag" style="display:none;color:#b45309;font-weight:700">belum disimpan</small></td>' +
      '<td><button class="mini-button edit" type="button" data-grade-session="' + escapeAdmin(row.session_id) + '" data-grade-question="' + escapeAdmin(row.id_soal) + '"><i class="fa-solid fa-floppy-disk"></i> Simpan</button></td></tr>';
  });
  html += '</tbody></table>';
  document.getElementById('essayTable').innerHTML = html;
  document.querySelectorAll('[data-grade-session]').forEach(function(button) {
    button.addEventListener('click', function() { saveEssayScore(this); });
  });
  // Rekam setiap ketikan sebagai draft, lalu pasang kembali draft yang ada.
  document.querySelectorAll('#essayTable .essay-score').forEach(function(input) {
    input.addEventListener('input', function() {
      var baris = input.closest('tr');
      var tombol = baris ? baris.querySelector('[data-grade-session]') : null;
      if (!tombol) return;
      var kunci = kunciBarisUraian_(tombol.dataset.gradeSession, tombol.dataset.gradeQuestion);
      if (String(input.value).trim() === '') delete ADMIN.essayDrafts[kunci];
      else ADMIN.essayDrafts[kunci] = String(input.value);
      baris.classList.add('essay-row-draft');
      var penanda = baris.querySelector('.essay-draft-flag');
      if (penanda) penanda.style.display = 'inline';
    });
  });
  pulihkanDraftUraian_();
}

async function saveEssayScore(button) {
  if (button.disabled) return;
  var input = button.closest('tr').querySelector('.essay-score');
  var score = Number(input.value);
  var max = Number(input.max);
  if (input.value === '' || !isFinite(score) || score < 0 || score > max) {
    await hasilInfo_('Nilai Tidak Valid',
      'Nilai uraian harus berupa angka antara 0 sampai ' + max + '. Perbaiki isian lalu simpan kembali.');
    input.focus();
    return;
  }
  button.disabled = true;
  try {
    var result = await adminApi('nilaiJawabanUraian', {
      sessionId: button.dataset.gradeSession,
      idSoal: button.dataset.gradeQuestion,
      nilai: score
    });
    if (!guardAdminResult(result)) return;
    hapusDraftUraian_(button.dataset.gradeSession, button.dataset.gradeQuestion);
    showToast(result.message || 'Nilai tersimpan.', 'success');
    await segarkanSenyap_([loadEssays, loadResults, loadRecap, loadDashboard]);
  } catch (error) {
    showToast('Nilai uraian gagal disimpan.', 'error');
  } finally {
    button.disabled = false;
  }
}

/* ================================ REKAP ================================ */
async function loadRecap() {
  if (!ADMIN.token || ADMIN.refreshBusy.recap) return;
  ADMIN.refreshBusy.recap = true;
  try {
    var result = await adminApi('getRekapKelas', {});
    if (!guardAdminResult(result)) return;
    DATA_MENTAH.rekap = result.data || [];
    terapkanFilterRekap_();
  } catch (error) { document.getElementById('recapList').innerHTML = '<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat rekap kelas.</div>'; }
  finally { ADMIN.refreshBusy.recap = false; }
}

/** Menyaring rekap per kelas berdasarkan nama kelas. */
function terapkanFilterRekap_() {
  var kueri = kueriFilter_('cariRekap');
  var groups = saringKata_(DATA_MENTAH.rekap, kueri, function(g) { return String(g.kelas || ''); });
  if (!groups.length && kueri) {
    tampilTidakDitemukan_('recapList', kueri, DATA_MENTAH.rekap.length + ' kelas memiliki rekap hasil.');
    return;
  }
  renderRecap(groups);
}

function renderRecap(groups) {
  if (!groups.length) { document.getElementById('recapList').innerHTML = '<div class="empty-state"><i class="fa-solid fa-chart-pie"></i> Belum ada hasil ujian selesai untuk direkap.</div>'; return; }
  var html = '';
  groups.forEach(function(group) {
    html += '<section class="class-recap"><header class="class-recap-head"><div><h3>Kelas ' + escapeAdmin(group.kelas) + '</h3><p>' + group.jumlahPeserta + ' peserta · Rata-rata ' + numberDisplay(group.rataRata) + '%</p></div><button class="admin-danger" type="button" data-reset-class="' + escapeAdmin(group.kelas) + '"><i class="fa-solid fa-rotate-left"></i> Reset Kelas</button></header>' +
      '<div class="table-scroll"><table class="admin-table"><thead><tr><th>No</th><th>Nama</th><th>Kehadiran</th><th>Nilai</th><th>Benar/Salah</th><th>Uraian</th><th>Persentase</th><th>Selesai</th></tr></thead><tbody>';
    group.peserta.forEach(function(student, index) {
      var pct = Math.max(0, Math.min(100, Number(student.persen || 0)));
      html += '<tr><td>' + (index + 1) + '</td><td><strong>' + escapeAdmin(student.nama) + '</strong></td><td>' + lencanaKehadiran_(student.kehadiran) + '</td><td>' + numberDisplay(student.nilai) + '/' + numberDisplay(student.total_poin) + '</td><td>' + numberDisplay(student.benar) + '/' + numberDisplay(student.salah) + '</td><td>' + numberDisplay(student.belum_dinilai) + '</td>' +
        '<td><div style="display:flex;align-items:center;gap:8px"><div class="progress-bar"><b style="width:' + pct + '%"></b></div><strong>' + numberDisplay(pct) + '%</strong></div></td><td>' + escapeAdmin(formatDate(student.finished_at)) + '</td></tr>';
    });
    html += '</tbody></table></div></section>';
  });
  document.getElementById('recapList').innerHTML = html;
  document.querySelectorAll('[data-reset-class]').forEach(function(button) { button.addEventListener('click', function() { resetClassData(this.dataset.resetClass); }); });
}

async function resetClassData(kelas) {
  var confirmation = await tanya_('Sesi, jawaban, hasil, pelanggaran, dan blokir diskualifikasi kelas ' + kelas + ' akan dihapus permanen. Bank soal tidak terpengaruh.',
    { judul: 'Reset Data Kelas', nada: 'danger', label: 'Ketik persis untuk memastikan',
      placeholder: 'RESET ' + kelas.toUpperCase(),
      hint: 'Ketik: RESET ' + kelas.toUpperCase(), teksOk: 'Reset Kelas' });
  if (confirmation === null) return;
  try {
    var result = await apiWajib_('resetKelas', { kelas: kelas, konfirmasi: confirmation });
    await segarkanSenyap_([loadRecap, loadResults, loadMonitor, loadViolations, loadDashboard]);
    await hasilSukses_('Data Kelas Direset', result.message || 'Data kelas berhasil dihapus.', [
      { label: 'Kelas', nilai: kelas },
      { label: 'Bank soal', nilai: 'Tidak terpengaruh' }
    ]);
  } catch (error) {
    await hasilGagal_('Reset Kelas Gagal', error.message || 'Reset kelas gagal.');
  }
}

/* =========================== HAPUS HISTORY =========================== */
async function clearViolationHistory() {
  // Dijalankan langsung tanpa konfirmasi ketik. Frasa konfirmasi tetap dikirim
  // otomatis karena server masih mensyaratkannya sebagai pengaman API.
  var confirmation = 'HAPUS PELANGGARAN';
  var button = document.getElementById('clearViolationHistory');
  button.disabled = true;
  try {
    var result = await apiWajib_('hapusHistoryPelanggaran', { konfirmasi: confirmation });
    await segarkanSenyap_([loadViolations, loadDashboard]);
    await hasilSukses_('History Pelanggaran Dihapus',
      result.message || 'Seluruh log pelanggaran telah dihapus permanen.', [
        { label: 'Data terhapus', nilai: 'Log pelanggaran' },
        { label: 'Hasil ujian', nilai: 'Tidak terpengaruh' }
      ]);
  } catch (error) {
    await hasilGagal_('Gagal Menghapus History', error.message || 'History pelanggaran gagal dihapus.');
  } finally {
    button.disabled = false;
  }
}

async function clearEssayHistory() {
  var confirmation = 'RESET NILAI URAIAN';
  var button = document.getElementById('clearEssayHistory');
  button.disabled = true;
  try {
    var result = await apiWajib_('hapusHistoryUraian', { konfirmasi: confirmation });
    await segarkanSenyap_([loadEssays, loadResults, loadRecap, loadDashboard]);
    await hasilSukses_('Nilai Uraian Direset',
      result.message || 'Seluruh nilai uraian dikembalikan menjadi belum dinilai.', [
        { label: 'Status baru', nilai: 'Menunggu penilaian' },
        { label: 'Jawaban peserta', nilai: 'Tetap tersimpan' }
      ]);
  } catch (error) {
    await hasilGagal_('Reset Nilai Gagal', error.message || 'History nilai uraian gagal direset.');
  } finally {
    button.disabled = false;
  }
}

async function clearRecapHistory() {
  var confirmation = 'HAPUS REKAP';
  var button = document.getElementById('clearRecapHistory');
  button.disabled = true;
  try {
    var result = await apiWajib_('hapusHistoryRekap', { konfirmasi: confirmation });
    await segarkanSenyap_([loadRecap, loadResults, loadEssays, loadMonitor, loadDashboard]);
    await hasilSukses_('Rekap Dihapus', result.message || 'Seluruh sesi, jawaban, dan hasil ujian telah dihapus.', [
      { label: 'Data terhapus', nilai: 'Sesi, jawaban, hasil' },
      { label: 'Bank soal & peserta', nilai: 'Tidak terpengaruh' }
    ]);
  } catch (error) {
    await hasilGagal_('Gagal Menghapus Rekap', error.message || 'History rekap gagal dihapus.');
  } finally {
    button.disabled = false;
  }
}

/* ============================= PENGATURAN ============================= */
async function loadSettings() {
  if (!ADMIN.token || ADMIN.refreshBusy.settings) return;
  ADMIN.refreshBusy.settings = true;
  try {
    var result = await adminApi('getPengaturanAdmin', {});
    if (!guardAdminResult(result)) return;
    applySettingsData(result.data);
    applyBrandingData_(result.branding);
    if (result.data && result.data.loginBackground) applyBackgroundData_(result.data.loginBackground);
  } catch (error) { showToast('Pengaturan gagal dimuat.', 'error'); }
  finally { ADMIN.refreshBusy.settings = false; }
}

async function saveSettings() {
  if (ADMIN.operationBusy.settings) return;
  // REVISI 2 mapel: mapel aktif dibaca dari dropdown (+ kotak manual).
  var mapelLama = String((ADMIN.settings && ADMIN.settings.mapel) || '').trim();
  var mapelBaruAwal = mapelAktifTerpilih_();
  if (!mapelBaruAwal) {
    await hasilInfo_('Mapel Belum Dipilih',
      kunciMapelGuru_() ? 'Mapel akun Anda belum ditetapkan admin. Hubungi admin.' :
      'Pilih mapel yang diujikan pada dropdown, atau pilih "+ Mapel lain" lalu ketik namanya.');
    return;
  }
  if (mapelBaruAwal.length > 150) {
    await hasilInfo_('Nama Mapel Terlalu Panjang', 'Nama mapel maksimal 150 karakter.');
    return;
  }
  if (mapelLama && mapelBaruAwal.toLowerCase() !== mapelLama.toLowerCase()) {
    var ganti = await konfirmasi_(
      'Mapel aktif akan diganti dari "' + mapelLama + '" ke "' + mapelBaruAwal + '". ' +
      'Peserta yang login berikutnya akan mengerjakan "' + mapelBaruAwal + '". ' +
      'Bank soal "' + mapelLama + '" tetap tersimpan dan tidak terhapus. ' +
      'Pastikan tidak ada peserta yang sedang mengerjakan mapel lama sebelum berganti.',
      { judul: 'Ganti Mapel Aktif', nada: 'warn', teksOk: 'Ya, Ganti Mapel' });
    if (!ganti) return;
  }
  ADMIN.operationBusy.settings = true;
  setFormBusy('settingsForm', true);
  try {
    var result = await adminApi('updatePengaturanUjian', {
      mapel: mapelBaruAwal,
      jenisUjian: nilaiInput_('sJenisUjian'),
      semester: nilaiInput_('sSemester'),
      tahunAjaran: nilaiInput_('sTahunAjaran'),
      ujianAktif: (document.getElementById('sUjianAktif') || {}).checked === true,
      durasiMenit: document.getElementById('sDurasi').value,
      emailPemilik: document.getElementById('sEmail').value,
      batasTimerMerahMenit: document.getElementById('sTimerMerah').value,
      usernamePeserta: document.getElementById('sUserPeserta').value,
      passwordPesertaBaru: document.getElementById('sPassPeserta').value,
      namaGuruMapel: document.getElementById('sGuruMapel').value,
      kkmDefault: document.getElementById('sKkm').value,
      petunjukUjian: nilaiInput_('sPetunjukUjian'),
      terapkanPesertaAktif: document.getElementById('sApplyActive').checked
    });
    if (!guardAdminResult(result)) throw new Error(result.message || 'Pengaturan gagal disimpan.');
    var mapelBaru = mapelBaruAwal;
    var durasiBaru = document.getElementById('sDurasi').value;
    document.getElementById('sPassPeserta').value = '';
    resetPasswordVisibility('sPassPeserta', 'toggleParticipantNewPassword', 'password peserta');
    await loadSettings();
    await hasilSukses_('Pengaturan Tersimpan', result.message || 'Pengaturan ujian berhasil disimpan.', [
      { label: 'Mapel aktif', nilai: mapelBaru || 'Belum diisi' },
      { label: 'Berlaku untuk', nilai: 'Akun ' + (ADMIN.username || '-') + ' saja' },
      { label: 'Judul besar ujian', nilai: nilaiInput_('sJudulUjian') || 'Belum terbentuk' },
      { label: 'Status ujian', nilai: (document.getElementById('sUjianAktif') || {}).checked
        ? 'Dibuka — peserta dapat memilihnya saat login' : 'Ditutup — belum tampil bagi peserta' },
      { label: 'Durasi ujian', nilai: durasiBaru ? (durasiBaru + ' menit') : 'Belum diisi (memakai 40 menit)' },
      { label: 'Peserta aktif', nilai: document.getElementById('sApplyActive').checked ? 'Ikut disesuaikan' : 'Tidak diubah' }
    ]);
  } catch (error) {
    await hasilGagal_('Pengaturan Gagal Disimpan', error.message || 'Pengaturan gagal disimpan.');
  } finally {
    ADMIN.operationBusy.settings = false;
    setFormBusy('settingsForm', false);
  }
}

function setBrandingMessage_(message, type) {
  var element = document.getElementById('brandingLogoMessage');
  if (!element) return;
  element.textContent = message || '';
  element.className = 'branding-message' + (type ? ' ' + type : '');
}

function applyBrandingData_(branding) {
  if (!branding || !branding.version) return;
  ADMIN.brandingVersion = String(branding.version);
  document.querySelectorAll('.brand-logo img').forEach(function(image) {
    image.src = branding.logoUiDataUri;
  });
  var favicon = document.querySelector('link[rel="icon"]');
  if (favicon) favicon.href = branding.faviconDataUri;
  var appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
  if (appleIcon) appleIcon.href = branding.logoEmailDataUri;

  var fileInput = document.getElementById('brandingLogoFile');
  var preview = document.getElementById('brandingLogoPreview');
  if (preview && (!fileInput || !fileInput.files || !fileInput.files.length)) {
    preview.src = branding.logoEmailDataUri;
  }
  var status = document.getElementById('brandingLogoStatus');
  if (status) {
    var custom = branding.source === 'custom';
    status.classList.toggle('custom', custom);
    status.innerHTML = '<i class="fa-solid fa-circle-check"></i> ' + (custom ? 'Logo kustom aktif' : 'Logo bawaan aktif');
    if (custom && branding.updatedAt) {
      status.title = 'Diperbarui: ' + new Date(branding.updatedAt).toLocaleString('id-ID');
    } else {
      status.removeAttribute('title');
    }
  }
}

function startBrandingSync_() {
  if (ADMIN.brandingSyncId) clearInterval(ADMIN.brandingSyncId);
  ADMIN.brandingSyncId = setInterval(syncBranding_, 10000);
  setTimeout(syncBranding_, 800);
}

async function syncBranding_() {
  if (ADMIN.brandingBusy || document.hidden) return;
  ADMIN.brandingBusy = true;
  try {
    var result = await adminApi('getBrandingPublik', { knownVersion: ADMIN.brandingVersion || '' });
    if (result && result.success && result.changed && result.branding) applyBrandingData_(result.branding);
  } catch (error) {
    console.warn('Sinkronisasi logo admin tertunda:', error);
  } finally {
    ADMIN.brandingBusy = false;
  }
}

function validateBrandingFile_(file) {
  var allowed = ['image/png', 'image/jpeg', 'image/webp'];
  if (!file) throw new Error('Pilih file logo terlebih dahulu.');
  if (allowed.indexOf(String(file.type || '').toLowerCase()) === -1) {
    throw new Error('Logo harus berupa PNG, JPEG, atau WebP.');
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('Ukuran file logo maksimum 5 MB.');
}

function readBrandingImage_(file) {
  validateBrandingFile_(file);
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function() { reject(new Error('File logo tidak dapat dibaca.')); };
    reader.onload = function() {
      var image = new Image();
      image.onerror = function() { reject(new Error('Isi file bukan gambar yang valid.')); };
      image.onload = function() {
        if (image.naturalWidth < 128 || image.naturalHeight < 128) {
          reject(new Error('Resolusi logo minimal 128×128 piksel.'));
          return;
        }
        if (image.naturalWidth * image.naturalHeight > 36000000) {
          reject(new Error('Resolusi logo terlalu besar. Gunakan gambar maksimum sekitar 6000×6000 piksel.'));
          return;
        }
        resolve({ image: image, sourceDataUri: String(reader.result) });
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function createBrandingAsset_(image, size, requestedMime, quality) {
  var canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  var context = canvas.getContext('2d');
  context.clearRect(0, 0, size, size);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  var scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
  var width = Math.max(1, Math.round(image.naturalWidth * scale));
  var height = Math.max(1, Math.round(image.naturalHeight * scale));
  context.drawImage(image, Math.round((size - width) / 2), Math.round((size - height) / 2), width, height);
  var dataUri = canvas.toDataURL(requestedMime, quality);
  var match = /^data:(image\/(?:png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUri);
  if (!match) throw new Error('Browser gagal memproses aset logo.');
  return { mime: match[1], base64: match[2], dataUri: dataUri };
}

async function previewSelectedBrandingLogo_() {
  var input = document.getElementById('brandingLogoFile');
  var file = input.files && input.files[0];
  if (!file) return;
  try {
    var loaded = await readBrandingImage_(file);
    document.getElementById('brandingLogoPreview').src = loaded.sourceDataUri;
    setBrandingMessage_('Pratinjau siap. Klik Terapkan Logo untuk menyimpan perubahan.', '');
  } catch (error) {
    input.value = '';
    setBrandingMessage_(error.message, 'error');
  }
}

async function updateBrandingLogo(event) {
  event.preventDefault();
  if (!ADMIN.token || ADMIN.operationBusy.branding) return;
  var input = document.getElementById('brandingLogoFile');
  var file = input.files && input.files[0];
  var applyButton = document.getElementById('applyBrandingLogo');
  var resetButton = document.getElementById('resetBrandingLogo');
  ADMIN.operationBusy.branding = true;
  applyButton.disabled = true;
  resetButton.disabled = true;
  setBrandingMessage_('Memproses dan mengunggah logo...', '');
  try {
    /* [SIADO v5] Logo diverifikasi/dinormalisasi di browser (seperti versi lama), lalu
     * berkas WEBP 256x256 diunggah ke bucket "branding" langsung (siadoUploadMedia, khusus ADMIN).
     * Server menyimpan URL-nya di pengaturan (Branding_Logo_Url) — bukan base64 lagi. */
    if (!file) throw new Error('Pilih berkas logo terlebih dahulu.');
    var loaded = await readBrandingImage_(file);
    var ui = createBrandingAsset_(loaded.image, 256, 'image/webp', 0.9);
    var blob = await (await fetch(ui.dataUri)).blob();
    var berkas = new File([blob], 'logo-' + Date.now() + '.webp', { type: ui.mime });
    var unggah = await window.siadoUploadMedia(berkas, { jenis: 'logo', adminToken: ADMIN.token });
    if (!unggah || !unggah.success) throw new Error((unggah && unggah.message) || 'Logo gagal diunggah.');
    var result = unggah.branding ? { success: true, branding: unggah.branding } : await adminApi('getBrandingPublik', {
      knownVersion: '', knownBgVersion: (ADMIN.background && ADMIN.background.version) || ''
    });
    if (!guardAdminResult(result)) {
      setBrandingMessage_((result && result.message) || 'Logo gagal diterapkan.', 'error');
      return;
    }
    input.value = '';
    applyBrandingData_(result.branding);
    setBrandingMessage_('Logo diperbarui.', 'success');
    await hasilSukses_('Logo Diterapkan',
      'Logo baru langsung dipakai pada halaman login, panel, dan layar ujian.', [
        { label: 'Ukuran', nilai: '256 × 256 piksel (WEBP)' },
        { label: 'Penyimpanan', nilai: 'Supabase Storage / bucket branding' }
      ]);
  } catch (error) {
    setBrandingMessage_(error.message || 'Logo gagal diproses.', 'error');
    await hasilGagal_('Logo Gagal Diterapkan', error.message || 'Logo gagal diproses.');
  } finally {
    ADMIN.operationBusy.branding = false;
    applyButton.disabled = false;
    resetButton.disabled = false;
  }
}

async function resetBrandingLogo() {
  if (!ADMIN.token || ADMIN.operationBusy.branding) return;
  var setujuLogo = await konfirmasi_('Logo aplikasi akan dikembalikan ke logo bawaan sekolah.',
    { judul: 'Kembalikan Logo', nada: 'warn', teksOk: 'Ya, Kembalikan' });
  if (!setujuLogo) return;
  var applyButton = document.getElementById('applyBrandingLogo');
  var resetButton = document.getElementById('resetBrandingLogo');
  ADMIN.operationBusy.branding = true;
  applyButton.disabled = true;
  resetButton.disabled = true;
  setBrandingMessage_('Mengembalikan logo bawaan...', '');
  try {
    var result = await adminApi('resetBrandingLogo', {});
    if (!guardAdminResult(result)) {
      setBrandingMessage_((result && result.message) || 'Logo gagal direset.', 'error');
      return;
    }
    document.getElementById('brandingLogoFile').value = '';
    applyBrandingData_(result.branding);
    setBrandingMessage_(result.message, 'success');
    showToast(result.message, 'success');
  } catch (error) {
    setBrandingMessage_('Logo bawaan gagal dipulihkan.', 'error');
  } finally {
    ADMIN.operationBusy.branding = false;
    applyButton.disabled = false;
    resetButton.disabled = false;
  }
}

async function resetDefaultSettings() {
  var confirmation = await tanya_('Pengaturan, akun, logo, dan background akan kembali ke nilai awal. Admin menjadi admin / Admin123! dan peserta menjadi peserta / Ujian123!. Bank soal dan data ujian tidak dihapus.',
    { judul: 'Reset Aplikasi ke Default', nada: 'danger', label: 'Ketik persis untuk memastikan',
      placeholder: 'RESET DEFAULT', hint: 'Ketik: RESET DEFAULT', teksOk: 'Reset Aplikasi' });
  if (confirmation === null) return;
  var button = document.getElementById('resetDefaultButton');
  button.disabled = true;
  try {
    var result = await adminApi('resetDefaultAplikasi', { konfirmasi: confirmation });
    if (!guardAdminResult(result)) {
      button.disabled = false;
      await hasilGagal_('Reset Gagal', (result && result.message) || 'Reset default gagal diproses.');
      return;
    }
    await hasilSukses_('Aplikasi Dikembalikan ke Default',
      result.message || 'Pengaturan aplikasi telah dikembalikan ke nilai awal.', [
        { label: 'Akun admin', nilai: 'admin / Admin123!' },
        { label: 'Peserta cadangan', nilai: 'peserta / Ujian123!' },
        { label: 'Bank soal & hasil', nilai: 'Tidak dihapus' },
        { label: 'Langkah berikutnya', nilai: 'Anda akan keluar otomatis' }
      ]);
    adminLogout();
  } catch (error) {
    await hasilGagal_('Reset Gagal', error.message || 'Reset default gagal diproses.');
    button.disabled = false;
  }
}

async function changeAdminCredential() {
  if (ADMIN.operationBusy.credential) return;
  ADMIN.operationBusy.credential = true;
  setFormBusy('adminCredentialForm', true);
  try {
    var result = await adminApi('ubahKredensialAdmin', {
      usernameBaru: document.getElementById('sAdminUser').value,
      passwordSaatIni: document.getElementById('sCurrentAdminPass').value,
      passwordBaru: document.getElementById('sNewAdminPass').value,
      konfirmasiPassword: document.getElementById('sConfirmAdminPass').value
    });
    if (!guardAdminResult(result)) throw new Error(result.message || 'Kredensial admin gagal diubah.');
    var userBaru = document.getElementById('sAdminUser').value;
    document.getElementById('sCurrentAdminPass').value = '';
    document.getElementById('sNewAdminPass').value = '';
    document.getElementById('sConfirmAdminPass').value = '';
    resetPasswordVisibility('sNewAdminPass', 'toggleNewAdminPassword', 'password admin baru');
    resetPasswordVisibility('sConfirmAdminPass', 'toggleConfirmAdminPassword', 'konfirmasi password admin');
    await hasilSukses_('Kredensial Admin Diubah',
      result.message || 'Kredensial admin berhasil diperbarui.', [
        { label: 'Username baru', nilai: userBaru },
        { label: 'Sesi lama', nilai: 'Diputus di semua perangkat' },
        { label: 'Langkah berikutnya', nilai: 'Login ulang dengan kredensial baru' }
      ]);
    adminLogout();
  } catch (error) {
    await hasilGagal_('Kredensial Gagal Diubah', error.message || 'Kredensial admin gagal diubah.');
  } finally {
    ADMIN.operationBusy.credential = false;
    setFormBusy('adminCredentialForm', false);
  }
}

/* ============================== UTILITAS ============================== */
/* ==================================================================
 * STATUS MASSAL DAN IMPORT SOAL
 * ================================================================== */
async function setAllQuestionStatus(aktif) {
  var mapelStatus = ADMIN.isAdmin ? '' : mapelDiujikan_();
  var batasStatus = ADMIN.isAdmin ? ''
    : (mapelStatus ? ' Hanya soal milik Anda pada mapel "' + mapelStatus + '" yang diubah.'
       : ' Hanya soal milik Anda yang diubah.');
  var pesan = (aktif
    ? 'Aktifkan SEMUA soal di bank soal? Soal akan langsung tersedia untuk peserta baru.'
    : 'Nonaktifkan SEMUA soal sekaligus? Peserta yang belum memulai ujian tidak akan menerima soal apa pun sampai ada soal yang diaktifkan kembali.') + batasStatus;
  var setujuStatus = await konfirmasi_(pesan,
    { judul: aktif ? 'Aktifkan Semua Soal' : 'Nonaktifkan Semua Soal', nada: aktif ? 'warn' : 'danger',
      teksOk: aktif ? 'Ya, Aktifkan Semua' : 'Ya, Nonaktifkan Semua' });
  if (!setujuStatus) return;
  if (ADMIN.operationBusy.bulkStatus) return;
  ADMIN.operationBusy.bulkStatus = true;
  try {
    var payloadStatus = { aktif: !!aktif };
    if (mapelStatus) payloadStatus.mapel = mapelStatus;
    var result = await apiWajib_('setStatusSemuaSoal', payloadStatus);
    await segarkanSenyap_([loadQuestions, loadDashboard]);
    await hasilSukses_(aktif ? 'Semua Soal Diaktifkan' : 'Semua Soal Dinonaktifkan',
      result.message || 'Status seluruh soal berhasil diperbarui.', [
        { label: 'Status baru', nilai: aktif ? 'Aktif' : 'Nonaktif' },
        { label: 'Jumlah soal', nilai: String(result.jumlah !== undefined ? result.jumlah : (ADMIN.questions || []).length) }
      ]);
  } catch (error) {
    await hasilGagal_('Status Soal Gagal Diubah', error.message || 'Status soal gagal diubah.');
  } finally { ADMIN.operationBusy.bulkStatus = false; }
}

/**
 * REVISI 2026-09-22 — Hapus SEMUA soal per peran.
 * Admin: seluruh bank soal dari semua mapel. Guru: hanya soal sendiri
 * pada mapel yang diujikan (soal mapel lain dilewati; soal milik akun
 * lain tetap ditolak server). Setiap soal dihapus lewat aksi hapusSoal
 * yang sudah ada. Dua tahap konfirmasi agar tidak terpicu tanpa sengaja.
 */
/* ==================================================================
 * REVISI 2026-09-22 — SATU AKUN GURU, DUA MAPEL BERGANTIAN
 *
 * Satu akun guru dapat memegang maksimal 2 mapel (mis. Informatika dan
 * KKA) yang diujikan TIDAK bersamaan. Admin menetapkan kedua mapel pada
 * akun guru; guru memilih salah satu sebagai MAPEL AKTIF di Pengaturan.
 * Hanya mapel aktif yang tampil di login peserta dan mengeluarkan soal.
 * Bank soal mapel yang sedang nonaktif tetap tersimpan utuh.
 *
 * Penyimpanan: kolom `mapel` akun guru berisi gabungan
 * "Mapel 1 | Mapel 2" (tanpa backend baru; satu baris teks biasa).
 * Akun lama berisi 1 mapel tetap terbaca sebagai [mapel tunggal].
 * ================================================================== */

/** Nilai khusus pilihan "ketik mapel lain secara manual". */
var MAPEL_MANUAL_ = '__MANUAL__';

/** Mengurai "Mapel 1 | Mapel 2" menjadi array (maks. 2, tanpa duplikat). */
function pecahMapelGuru_(nilai) {
  var daftar = [];
  String(nilai || '').split('|').forEach(function(potong) {
    var bersih = String(potong || '').trim();
    if (!bersih) return;
    var ada = daftar.some(function(x) { return x.toLowerCase() === bersih.toLowerCase(); });
    if (!ada) daftar.push(bersih);
  });
  return daftar.slice(0, 2);
}

/** Menggabung 2 mapel menjadi satu string simpanan ("A | B" / "A"). */
function gabungMapelGuru_(mapel1, mapel2) {
  var m1 = String(mapel1 || '').trim();
  var m2 = String(mapel2 || '').trim();
  if (m1 && m2 && m1.toLowerCase() !== m2.toLowerCase()) return m1 + ' | ' + m2;
  return m1 || m2;
}

/** Menampilkan mapel yang diampu sebagai "Mapel1/Mapel2". */
function teksMapelGuru_(nilai) {
  var daftar = pecahMapelGuru_(nilai);
  if (!daftar.length) return '-';
  return escapeAdmin(daftar.join('/'));
}

/**
 * Daftar kandidat mapel aktif: mapel tersimpan + mapel yang diampu akun
 * + mapel yang sudah ada di bank soal milik akun (huruf dinormalisasi).
 */
/** true bila akun ini (guru/proktor) dikunci ke mapel penetapan admin. */
function kunciMapelGuru_() {
  return !ADMIN.isAdmin;
}

function daftarMapelMilik_(terpilih) {
  var daftar = [];
  function tambah(nilai) {
    var bersih = String(nilai || '').trim();
    if (!bersih) return;
    var ada = daftar.some(function(x) { return x.toLowerCase() === bersih.toLowerCase(); });
    if (!ada) daftar.push(bersih);
  }
  if (kunciMapelGuru_()) {
    pecahMapelGuru_(terpilih).forEach(tambah);
  } else {
    tambah(terpilih);
  }
  (ADMIN.mapelDiampu || []).forEach(tambah);
  if (!kunciMapelGuru_()) {
    (DATA_MENTAH.soal || []).forEach(function(soal) { tambah(soal && soal.mapel); });
  }
  return daftar;
}

/**
 * REVISI kunci mapel: guru memuat mapel kanonik + batas kelasnya (read-only).
 * Sumber: RPC info_mapel_guru. Diam bila gagal (server lama) atau bila admin.
 */
/**
 * REVISI info guru: kotak info mengikuti pilihan dropdown mapel aktif.
 * Memakai medan kelasMapel1/2 (migrasi 2b); jatuh-balik ke kelasAktif.
 */
function perbaruiInfoBatasKelasGuru_() {
  var kotak = document.getElementById('infoBatasKelasGuru');
  var info = ADMIN.infoMapelGuru_ || null;
  if (!kotak || !info) return;
  var dipilih = String(mapelAktifTerpilih_() || '').trim();
  var kanon = pecahMapelGuru_(String(info.mapelAkun || ''));
  var slot = 0;
  for (var i = 0; i < kanon.length; i++) {
    if (dipilih && kanon[i].toLowerCase() === dipilih.toLowerCase()) { slot = i + 1; break; }
  }
  var daftar = [];
  if (slot === 1 && Array.isArray(info.kelasMapel1)) daftar = info.kelasMapel1;
  else if (slot === 2 && Array.isArray(info.kelasMapel2)) daftar = info.kelasMapel2;
  else if (Array.isArray(info.kelasAktif)) daftar = info.kelasAktif;
  daftar = daftar.filter(function(k) { return String(k || '').trim(); });
  var html = '<strong>Mapel aktif:</strong> ' + escapeAdmin(dipilih || '-') +
    '<br><strong>Kelas yang boleh mengikuti ujian:</strong> ' +
    escapeAdmin(daftar.length ? daftar.join(' / ') : 'Semua kelas');
  var tersimpan = String(info.mapelAktif || '').trim();
  var slotTersimpan = 0;
  for (var j = 0; j < kanon.length; j++) {
    if (tersimpan && kanon[j].toLowerCase() === tersimpan.toLowerCase()) { slotTersimpan = j + 1; break; }
  }
  if (tersimpan && !slotTersimpan) {
    html += '<br><span style="color:#b42318"><strong>Perhatian:</strong> mapel aktif tersimpan ("' +
      escapeAdmin(tersimpan) + '") tidak cocok dengan mapel penetapan admin. ' +
      'Pilih salah satu mapel di atas lalu Simpan Pengaturan.</span>';
  }
  html += '<br><span style="font-size:11px">Ditetapkan oleh admin dan tidak dapat diubah dari akun ini.</span>';
  kotak.innerHTML = html;
  kotak.style.display = '';
}

async function muatInfoBatasKelasGuru_() {
  var kotak = document.getElementById('infoBatasKelasGuru');
  if (ADMIN.isAdmin) { if (kotak) kotak.style.display = 'none'; return; }
  var namaAkun = String(ADMIN.username || '').trim();
  if (!namaAkun) return;
  var hasil = null;
  try {
    hasil = await rpcBatasKelas_('info_mapel_guru', { p_username: namaAkun });
  } catch (galat) { hasil = null; }
  if (!hasil || !hasil.success || !hasil.data) return;
  var info = hasil.data || {};
  var kanon = String(info.mapelAkun || '').trim();
  if (kanon) {
    var pecah = pecahMapelGuru_(kanon);
    var kini = (ADMIN.mapelDiampu || []).join('|').toLowerCase();
    if (pecah.join('|').toLowerCase() !== kini) {
      ADMIN.mapelDiampu = pecah;
      try { isiPilihanMapelUjian_(mapelAktifTerpilih_() || (ADMIN.settings && ADMIN.settings.mapel) || ''); } catch (abaikan) {}
    }
  }
  ADMIN.infoMapelGuru_ = info;
  perbaruiInfoBatasKelasGuru_();
}

/** Membangun dropdown #sMapel dan menyinkronkan kotak ketik manual. */
function isiPilihanMapelUjian_(terpilih) {
  var pilih = document.getElementById('sMapel');
  if (!pilih) return;
  var terkunci = kunciMapelGuru_();
  var daftar = daftarMapelMilik_(terpilih);
  var html = daftar.map(function(m) {
    return '<option value="' + escapeAdmin(m) + '">' + escapeAdmin(m) + '</option>';
  }).join('');
  if (!terkunci) {
    html += '<option value="' + MAPEL_MANUAL_ + '">+ Mapel lain (ketik manual)...</option>';
  } else if (!daftar.length) {
    html += '<option value="">Belum ditetapkan admin</option>';
  }
  pilih.innerHTML = html;
  var aktif = String(terpilih || '').trim();
  var cocok = daftar.filter(function(m) { return m.toLowerCase() === aktif.toLowerCase(); })[0];
  pilih.value = cocok || daftar[0] || (terkunci ? '' : MAPEL_MANUAL_);
  var manual = document.getElementById('sMapelManual');
  if (manual && !terkunci && !cocok && aktif) manual.value = aktif;
  tampilManualMapel_(!terkunci && pilih.value === MAPEL_MANUAL_);
  perbaruiInfoMapelSoal_();
}

/** Menampilkan / menyembunyikan kotak ketik mapel manual. */
function tampilManualMapel_(tampil) {
  var bungkus = document.getElementById('sMapelManualWrap');
  if (bungkus) bungkus.style.display = tampil ? '' : 'none';
  if (tampil) {
    var manual = document.getElementById('sMapelManual');
    if (manual) window.setTimeout(function() { try { manual.focus(); } catch (abaikan) {} }, 60);
  }
}

/** Pembaca tunggal mapel aktif dari dropdown Pengaturan. */
function mapelAktifTerpilih_() {
  var pilih = document.getElementById('sMapel');
  if (!pilih) return String((ADMIN.settings && ADMIN.settings.mapel) || '').trim();
  if (pilih.value === MAPEL_MANUAL_) {
    var manual = document.getElementById('sMapelManual');
    return manual ? String(manual.value || '').trim() : '';
  }
  return String(pilih.value || '').trim();
}

/**
 * Mengisi dropdown filter mapel dari data yang termuat, pilihan lama
 * dipertahankan bila nilainya masih ada.
 */
function isiFilterMapel_(id, rows, ambil) {
  var el = document.getElementById(id);
  if (!el) return;
  var sebelum = String(el.value || '');
  var daftar = [];
  (rows || []).forEach(function(r) {
    var bersih = String(ambil(r) || '').trim();
    if (!bersih) return;
    var ada = daftar.some(function(x) { return x.toLowerCase() === bersih.toLowerCase(); });
    if (!ada) daftar.push(bersih);
  });
  daftar.sort(function(a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
  el.innerHTML = '<option value="">Semua Mapel</option>' + daftar.map(function(m) {
    return '<option value="' + escapeAdmin(m) + '">' + escapeAdmin(m) + '</option>';
  }).join('');
  var cocok = daftar.filter(function(m) { return m.toLowerCase() === sebelum.toLowerCase(); })[0];
  el.value = cocok || '';
}

/** Menyaring satu baris terhadap filter mapel (cocok persis, abaikan huruf). */
function cocokFilterMapel_(nilaiBaris, filter) {
  if (!filter) return true;
  return String(nilaiBaris || '').trim().toLowerCase() === String(filter).trim().toLowerCase();
}

/**
 * Spanduk info pada "Tambah Soal Baru": menegaskan soal baru & import
 * masuk ke mapel aktif, plus ringkasan isi bank soal per mapel.
 */
function perbaruiInfoMapelSoal_() {
  var el = document.getElementById('mapelAktifInfo');
  if (!el) return;
  var aktif = mapelAktifTerpilih_() || String((ADMIN.settings && ADMIN.settings.mapel) || '').trim();
  var hitung = {};
  (DATA_MENTAH.soal || []).forEach(function(q) {
    var m = String((q && q.mapel) || '').trim() || '(tanpa mapel)';
    hitung[m] = (hitung[m] || 0) + 1;
  });
  var kunci = Object.keys(hitung).sort(function(a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
  var ringkas = kunci.length
    ? kunci.map(function(k) { return escapeAdmin(k) + ' (' + hitung[k] + ' soal)'; }).join(' · ')
    : 'bank soal masih kosong';
  el.innerHTML = '<i class="fa-solid fa-circle-info" style="color:#1f6feb"></i> ' +
    'Soal baru &amp; import tanpa kolom mapel akan masuk ke mapel aktif: <b>' +
    escapeAdmin(aktif || 'belum dipilih') + '</b><br>' +
    '<span style="font-size:11px">Bank soal milik akun ini &mdash; ' + ringkas +
    '. Untuk menambah soal mapel lain, ganti dulu mapel aktif di Pengaturan lalu simpan.</span>';
}

/* ==================================================================
 * REVISI 2026-09-22 (lanjutan) — PINDAH MAPEL SOAL DARI MODAL EDIT
 *
 * Kolom "Mapel soal" pada Edit Soal Realtime memungkinkan guru
 * memindahkan satu soal ke mapel lain milik akunnya (mis. soal yang
 * tersimpan sebagai KKA dipindah ke Informatika). Kunci `mapel` hanya
 * dikirim ke server bila nilainya berubah, sehingga perilaku tambah
 * soal dan edit-tanpa-ubah-mapel tetap identik seperti sebelumnya.
 * ================================================================== */

/** Mapel soal sebelum diubah pada modal edit (acuan perbandingan). */
var EDIT_MAPEL_LAMA_ = '';

/** Mengisi datalist saran mapel pada modal edit soal. */
function isiDatalistMapelSoal_() {
  var daftar = document.getElementById('daftarMapelSoal');
  if (!daftar) return;
  daftar.innerHTML = daftarMapelMilik_('').map(function(m) {
    return '<option value="' + escapeAdmin(m) + '"></option>';
  }).join('');
}

/* ==================================================================
 * REVISI 2026-09-22 (lanjutan) — BATAS KELAS PER MAPEL (ditetapkan admin)
 *
 * Tiap mapel yang diampu guru boleh dibatasi rombelnya, mis. Mapel 1
 * (Informatika) hanya VII Kihajar Dewantara + VII Ahmad Dahlan, Mapel 2
 * (KKA) hanya VIII Agus Salim + VIII Sis Al Jufri. Daftar kosong berarti
 * TIDAK DIBATASI (boleh semua kelas) — kompatibel mundur: guru yang
 * belum diatur batasnya berperilaku seperti sebelum revisi.
 * Penyimpanan & penegakan di server diatur file migrasi SQL; panel ini
 * mengirim/membaca kolom kelasMapel1 & kelasMapel2, dan memperingatkan
 * bila server belum mendukungnya.
 * ================================================================== */

/** Normalisasi daftar kelas: menerima array / string koma / string pipa. */
function normalisasiKelas_(nilai) {
  var daftar = [];
  function tambah(v) {
    var bersih = String(v || '').trim();
    if (!bersih) return;
    var ada = daftar.some(function(x) { return x.toLowerCase() === bersih.toLowerCase(); });
    if (!ada) daftar.push(bersih);
  }
  if (Array.isArray(nilai)) nilai.forEach(tambah);
  else if (nilai !== undefined && nilai !== null) String(nilai).split(/[|,]/).forEach(tambah);
  return daftar;
}

/** Teks ringkas kelas per mapel untuk sel tabel guru. */
function teksKelasGuru_(guru) {
  var nMapel = Math.max(1, pecahMapelGuru_(guru && guru.mapel).length);
  var grup = [normalisasiKelas_(guru && guru.kelasMapel1), normalisasiKelas_(guru && guru.kelasMapel2)];
  var teks = [];
  for (var i = 0; i < nMapel; i++) {
    teks.push(grup[i].length ? grup[i].join(', ') : 'Semua kelas');
  }
  return teks.join(' / ');
}

/** Memastikan daftar rombel tersedia untuk form akun guru. */
async function muatRombelUntukFormGuru_() {
  if ((ADMIN.rombel || []).length) return true;
  try {
    var result = await adminApi('getDataPeserta', { rombel: '' });
    if (!guardAdminResult(result)) return false;
    ADMIN.rombel = result.rombel || [];
    return true;
  } catch (error) { return false; }
}

/** Merender kotak centang rombel; centangan yang ada dipertahankan. */
function renderKotakKelas_(boxId, dicentang) {
  var box = document.getElementById(boxId);
  if (!box) return;
  var rombel = ADMIN.rombel || [];
  if (!rombel.length) {
    box.innerHTML = '<span class="form-help">Daftar rombel kosong. Tambahkan rombel di menu Data Peserta.</span>';
    return;
  }
  var tetap = {};
  box.querySelectorAll('input[type="checkbox"]').forEach(function(c) {
    if (c.checked) tetap[String(c.value).toLowerCase()] = true;
  });
  (dicentang || []).forEach(function(v) { tetap[String(v).toLowerCase()] = true; });
  box.innerHTML = rombel.map(function(item) {
    var nama = String(item.rombel || '').trim();
    if (!nama) return '';
    var cek = tetap[nama.toLowerCase()] ? ' checked' : '';
    return '<label><input type="checkbox" value="' + escapeAdmin(nama) + '"' + cek + '> ' + escapeAdmin(nama) + '</label>';
  }).join('');
}

/** Membaca rombel yang dicentang pada satu kotak. */
function bacaKotakKelas_(boxId) {
  var box = document.getElementById(boxId);
  if (!box) return [];
  var hasil = [];
  box.querySelectorAll('input[type="checkbox"]:checked').forEach(function(c) { hasil.push(c.value); });
  return normalisasiKelas_(hasil);
}

/** Menyiapkan kotak kelas pada form tambah akun guru. */
async function siapkanFormKelasGuru_() {
  var ok = await muatRombelUntukFormGuru_();
  if (!ok) {
    ['kelasMapel1Box', 'kelasMapel2Box'].forEach(function(id) {
      var box = document.getElementById(id);
      if (box) box.innerHTML = '<span class="form-help">Gagal memuat rombel. Buka menu Data Peserta sekali, lalu kembali.</span>';
    });
    return;
  }
  renderKotakKelas_('kelasMapel1Box');
  renderKotakKelas_('kelasMapel2Box');
  perbaruiLabelKelasGuru_();
}

/** Label dinamis "Kelas untuk: <nama mapel>" mengikuti ketikan admin. */
function perbaruiLabelKelasGuru_() {
  var pasang = [['gMapel1', 'lblKelasMapel1', 'Mapel 1'], ['gMapel2', 'lblKelasMapel2', 'Mapel 2'],
                ['egMapel1', 'lblEgKelasMapel1', 'Mapel 1'], ['egMapel2', 'lblEgKelasMapel2', 'Mapel 2']];
  pasang.forEach(function(p) {
    var sumber = document.getElementById(p[0]);
    var label = document.getElementById(p[1]);
    if (label) label.textContent = (sumber && String(sumber.value || '').trim()) || p[2];
  });
}

/** Membandingkan dua daftar kelas sebagai himpunan (abaikan huruf/urut). */
function himpunanKelasSama_(a, b) {
  var x = normalisasiKelas_(a).map(function(v) { return v.toLowerCase(); }).sort();
  var y = normalisasiKelas_(b).map(function(v) { return v.toLowerCase(); }).sort();
  return x.length === y.length && x.every(function(v, i) { return v === y[i]; });
}

/** Peringatan bila server belum menyimpan batas kelas (migrasi SQL belum jalan). */
/* REVISI batas kelas (backend): RPC langsung ke fungsi SQL baru. */
function rpcBatasKelas_(namaFn, args) {
  return new Promise(function(selesai, gagal) {
    try {
      var klien = window.siadoClient;
      if (!klien || typeof klien.rpc !== 'function') {
        gagal(new Error('Klien Supabase belum siap.'));
        return;
      }
      klien.rpc(namaFn, args || {}).then(function(res) {
        if (!res) { gagal(new Error('Server tidak memberi respons.')); return; }
        if (res.error) { gagal(res.error); return; }
        selesai(res.data);
      }, function(galat) { gagal(galat || new Error('RPC gagal.')); });
    } catch (galat) { gagal(galat); }
  });
}

/** true bila galat berarti fungsi SQL belum terpasang / tak terjangkau. */
function rpcBelumTerpasang_(galat) {
  if (!galat) return false;
  var teks = String(galat.code || '') + ' ' + String(galat.message || galat.details || galat.hint || galat);
  return teks.indexOf('PGRST202') !== -1 || teks.indexOf('PGRST204') !== -1 ||
    teks.indexOf('404') !== -1 || teks.indexOf('Could not find the function') !== -1 ||
    teks.indexOf('Failed to fetch') !== -1 || teks.indexOf('belum siap') !== -1;
}

/**
 * Menyimpan batas kelas akun guru via RPC simpan_batas_kelas.
 * Mengembalikan teks status singkat untuk dialog (tidak pernah melempar).
 */
async function simpanBatasKelasGuru_(username, daftar1, daftar2, mapelGabung) {
  try {
    var hasil = await rpcBatasKelas_('simpan_batas_kelas', {
      p_admin_token: ADMIN.token,
      p_username: username,
      p_kelas1: daftar1 || [],
      p_kelas2: daftar2 || [],
      p_mapel: mapelGabung || ''
    });
    if (hasil && hasil.success) return 'Tersimpan';
    return 'Gagal: ' + ((hasil && hasil.message) || 'respons server tidak dikenal');
  } catch (galat) {
    if (rpcBelumTerpasang_(galat)) return 'Belum aktif \u2014 jalankan migrasi SQL dahulu';
    return 'Gagal: ' + (galat && galat.message ? galat.message : String(galat));
  }
}

/** Membaca peta batas kelas semua guru; null bila server belum mendukung. */
async function bacaPetaBatasKelas_() {
  if (!ADMIN.token || !ADMIN.isAdmin) return null;
  try {
    var hasil = await rpcBatasKelas_('baca_batas_kelas', { p_admin_token: ADMIN.token });
    if (hasil && hasil.success && hasil.data) return hasil.data;
  } catch (galat) { /* server lama: abaikan */ }
  return null;
}

var SINKRON_BATAS_KELAS_JALAN_ = false;

/** Menggabungkan batas kelas server ke daftar guru lalu menggambar ulang. */
async function sinkronBatasKelasPanel_() {
  if (!ADMIN.token || !ADMIN.isAdmin || SINKRON_BATAS_KELAS_JALAN_) return false;
  SINKRON_BATAS_KELAS_JALAN_ = true;
  try {
    var peta = await bacaPetaBatasKelas_();
    if (!peta) return false;
    var berubah = false;
    (ADMIN.teachers || []).forEach(function(g) {
      var kunci = null;
      var daftarKunci = Object.keys(peta);
      for (var i = 0; i < daftarKunci.length; i++) {
        if (daftarKunci[i].toLowerCase() === String(g.username || '').toLowerCase()) { kunci = daftarKunci[i]; break; }
      }
      var b = kunci ? peta[kunci] : null;
      var kanon = (b && String(b.mapelAdmin || '').trim()) || '';
      if (kanon && String(g.mapel || '').trim() !== kanon) { g.mapel = kanon; berubah = true; }
      var b1 = normalisasiKelas_(b && b.kelasMapel1);
      var b2 = normalisasiKelas_(b && b.kelasMapel2);
      if (!himpunanKelasSama_(normalisasiKelas_(g.kelasMapel1), b1) ||
          !himpunanKelasSama_(normalisasiKelas_(g.kelasMapel2), b2)) {
        g.kelasMapel1 = b1;
        g.kelasMapel2 = b2;
        berubah = true;
      }
    });
    if (berubah) terapkanFilterGuru_();
    return berubah;
  } catch (galat) { return false; }
  finally { SINKRON_BATAS_KELAS_JALAN_ = false; }
}

async function verifikasiBatasKelas_(username, kirim1, kirim2) {
  var namaKunci = String(username || '').toLowerCase();
  var peta = await bacaPetaBatasKelas_();
  if (!peta) return; // tak dapat memverifikasi; mengandalkan baris status dialog
  var b = null;
  var daftarKunci = Object.keys(peta);
  for (var i = 0; i < daftarKunci.length; i++) {
    if (daftarKunci[i].toLowerCase() === namaKunci) { b = peta[daftarKunci[i]]; break; }
  }
  if (!b) return;
  var simpan1 = normalisasiKelas_(b.kelasMapel1);
  var simpan2 = normalisasiKelas_(b.kelasMapel2);
  var g = (ADMIN.teachers || []).filter(function(x) {
    return String(x.username || '').toLowerCase() === namaKunci;
  })[0];
  if (g && (!himpunanKelasSama_(normalisasiKelas_(g.kelasMapel1), simpan1) ||
      !himpunanKelasSama_(normalisasiKelas_(g.kelasMapel2), simpan2))) {
    g.kelasMapel1 = simpan1;
    g.kelasMapel2 = simpan2;
    terapkanFilterGuru_();
  }
  var kanon = String(b.mapelAdmin || '').trim();
  if (g && kanon && String(g.mapel || '').trim() !== kanon) {
    g.mapel = kanon;
    terapkanFilterGuru_();
  }
  if (himpunanKelasSama_(simpan1, kirim1) && himpunanKelasSama_(simpan2, kirim2)) return;
  await hasilInfo_('Batas Kelas Belum Aktif',
    'Akun tersimpan, tetapi server belum menyimpan daftar kelas (kolom batas kelas belum ada di database). ' +
    'Jalankan file migrasi SQL batas kelas di Supabase, lalu ulangi penyimpanan akun ini.',
    [{ label: 'Akun', nilai: String(username) }]);
}

function mapelDiujikan_() {
  var s = ADMIN.settings || {};
  var m = mapelAktifTerpilih_();
  if (!m) m = String(s.mapel || '').trim();
  return m;
}

function soalSeMapelUjian_(soal, mapelUjian) {
  if (!mapelUjian) return true;
  var m = String((soal && soal.mapel) || '').trim();
  if (!m) return true;
  return m.toLowerCase() === String(mapelUjian).toLowerCase();
}
async function deleteAllQuestions() {
  var semua = (DATA_MENTAH.soal || []).slice();
  if (!semua.length) {
    await hasilInfo_('Bank Soal Kosong', 'Tidak ada soal yang dapat dihapus.');
    return;
  }
  var mapelUjian = ADMIN.isAdmin ? '' : mapelDiujikan_();
  var target = semua.filter(function(q) { return ADMIN.isAdmin || soalSeMapelUjian_(q, mapelUjian); });
  var dilewati = semua.length - target.length;
  if (!target.length) {
    await hasilInfo_('Tidak Ada Soal Dalam Cakupan',
      'Tidak ada soal mapel "' + mapelUjian + '" milik Anda. ' + semua.length + ' soal mapel lain tidak dihapus.');
    return;
  }
  var cakupan = ADMIN.isAdmin
    ? 'SELURUH bank soal (' + target.length + ' soal dari semua mapel)'
    : 'Soal milik Anda pada mapel "' + (mapelUjian || 'yang diujikan') + '" (' + target.length + ' soal)';
  var setuju = await konfirmasi_(cakupan + ' akan dihapus permanen, ' +
    'termasuk berkas gambar/video-nya di penyimpanan aplikasi. Soal yang sedang dipakai peserta aktif ' +
    'hanya dinonaktifkan demi menjaga ujian yang berjalan.' +
    (dilewati ? ' ' + dilewati + ' soal mapel lain dilewati (tidak dihapus).' : '') +
    ' Tindakan ini TIDAK dapat dibatalkan.',
    { judul: 'Hapus Semua Soal', nada: 'danger', teksOk: 'Lanjutkan' });
  if (!setuju) return;
  var ketik = await tanya_('Ketik <b>HAPUS</b> (huruf besar) untuk mengkonfirmasi penghapusan ' + escapeAdmin(cakupan.toLowerCase()) + '.',
    { judul: 'Konfirmasi Akhir', label: 'Ketik HAPUS', placeholder: 'HAPUS', teksOk: 'Hapus Permanen' });
  if (ketik === null || String(ketik).trim() !== 'HAPUS') {
    await hasilInfo_('Hapus Dibatalkan', 'Konfirmasi tidak cocok. Bank soal tidak diubah.');
    return;
  }
  if (ADMIN.operationBusy.deleteAll) return;
  ADMIN.operationBusy.deleteAll = true;
  var berhasil = 0;
  var gagalList = [];
  try {
    for (var i = 0; i < target.length; i++) {
      try {
        var payloadHapus = { id_soal: target[i].id_soal };
        if (mapelUjian) payloadHapus.mapel_scope = mapelUjian;
        var r = await adminApi('hapusSoal', payloadHapus);
        if (r && r.success) berhasil += 1;
        else gagalList.push('#' + target[i].id_soal + ': ' + ((r && r.message) || 'ditolak server'));
      } catch (error) {
        gagalList.push('#' + target[i].id_soal + ': ' + (error.message || error));
      }
    }
    await segarkanSenyap_([loadQuestions, loadDashboard]);
    var sisa = (DATA_MENTAH.soal || []).length;
    var rincianHapus = [
      { label: 'Dihapus', nilai: String(berhasil) },
      { label: 'Sisa soal', nilai: String(sisa) }
    ];
    if (dilewati) rincianHapus.splice(1, 0, { label: 'Dilewati (mapel lain)', nilai: String(dilewati) });
    if (!gagalList.length) {
      await hasilSukses_('Hapus Massal Selesai', berhasil + ' soal dihapus permanen.', rincianHapus);
    } else {
      await hasilGagal_('Hapus Selesai Sebagian',
        berhasil + ' soal terhapus; ' + gagalList.length + ' gagal. ' + gagalList.slice(0, 5).join('; '));
    }
  } finally {
    ADMIN.operationBusy.deleteAll = false;
  }
}

function unduhTemplateSoal() {
  var rows = [
    ['tipe', 'pertanyaan', 'opsi', 'kunci_jawaban', 'poin', 'tingkat', 'aktif', 'stimulus_gambar', 'stimulus_video'],
    ['PG', 'Ibu kota Provinsi Sulawesi Tengah adalah', 'Palu|Poso|Donggala|Morowali', 'A', '10', 'VII', 'YA', '', ''],
    ['PGK', 'Tentukan kategori setiap informasi berikut dengan memberi tanda centang pada kolom yang sesuai', 'Alamat lengkap penerima paket|Warna kardus pembungkus paket|Berat paket', 'Informasi Penting,Dapat Diabaikan,Informasi Penting', '10', 'VIII', 'YA', '', ''],
    ['PGK', 'Tentukan benar atau salah pernyataan berikut', 'Air mendidih pada 100 derajat Celsius|Es mencair pada 50 derajat Celsius', 'BENAR,SALAH', '10', 'VIII', 'YA', '', ''],
    ['PGK_MCMA', 'Pilih bilangan genap berikut', '2|3|4|5', 'A,C', '10', 'VIII', 'YA', '', ''],
    ['MENJODOHKAN', 'Jodohkan provinsi dengan ibu kotanya',
     'Sulawesi Tengah = Palu|Sulawesi Selatan = Makassar|Sulawesi Utara = Manado', '', '10', 'IX', 'YA', '', ''],
    ['ISIAN', 'Hasil dari 12 x 3 adalah', '', '36', '5', 'IX', 'YA', '', ''],
    ['URAIAN', 'Jelaskan proses terjadinya hujan', '', 'Menyebutkan evaporasi, kondensasi, presipitasi', '20', 'SEMUA', 'YA', '', '']
  ];
  unduhCsv_(rows, 'template-import-soal.csv');
  hasilSukses_('Template Soal Diunduh',
    'Berkas template tersimpan di folder unduhan perangkat Anda. Isi datanya lalu simpan kembali sebagai CSV UTF-8 sebelum diimport.', [
      { label: 'Nama berkas', nilai: 'template-import-soal.csv' },
      { label: 'Pemisah opsi', nilai: 'tanda | (pipa)' },
      { label: 'Kolom tingkat', nilai: 'VII / VIII / IX / SEMUA (kosong = SEMUA)' },
      { label: 'Menjodohkan', nilai: 'tulis pasangan sebagai pernyataan = jawaban, kunci otomatis' },
      { label: 'PGK Kategori', nilai: 'kolom kunci_jawaban berisi nama kategori per pernyataan dipisah koma (mis. Informasi Penting,Dapat Diabaikan,...)' },
      { label: 'Contoh baris', nilai: String(rows.length - 1) + ' contoh soal' }
    ]);
}

function unduhTemplatePeserta() {
  var rows = [
    ['nama', 'rombel', 'nis'],
    ['Ahmad Fauzan Ramadhan', 'VII A', '2024001'],
    ['Siti Aisyah Putri', 'VII A', '2024002'],
    ['Bagus Prakoso', 'VIII B', '2023015']
  ];
  unduhCsv_(rows, 'template-import-peserta.csv');
  hasilSukses_('Template Peserta Diunduh',
    'Berkas template tersimpan di folder unduhan perangkat Anda. Isi kolom nama, rombel, dan NIS lalu simpan sebagai CSV UTF-8.', [
      { label: 'Nama berkas', nilai: 'template-import-peserta.csv' },
      { label: 'Kolom wajib', nilai: 'nama, rombel' },
      { label: 'Kolom opsional', nilai: 'nis' }
    ]);
}

function unduhCsv_(rows, fileName) {
  var csv = rows.map(function(row) {
    return row.map(function(cell) {
      var text = String(cell === undefined || cell === null ? '' : cell);
      return /[",\n;]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    }).join(',');
  }).join('\r\n');
  unduhBlob_(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }), fileName);
}

function unduhBlob_(blob, fileName) {
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(function() { URL.revokeObjectURL(url); }, 4000);
}

/**
 * Membaca CSV sederhana (mendukung tanda kutip dan pemisah koma/titik koma).
 */
function parseCsv_(text) {
  var content = String(text || '').replace(/^\ufeff/, '');
  var delimiter = (content.split('\n')[0].split(';').length > content.split('\n')[0].split(',').length) ? ';' : ',';
  var rows = [];
  var row = [];
  var value = '';
  var inQuote = false;
  for (var i = 0; i < content.length; i++) {
    var char = content.charAt(i);
    if (inQuote) {
      if (char === '"') {
        if (content.charAt(i + 1) === '"') { value += '"'; i++; }
        else inQuote = false;
      } else value += char;
      continue;
    }
    if (char === '"') { inQuote = true; continue; }
    if (char === delimiter) { row.push(value); value = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(value); rows.push(row); row = []; value = ''; continue; }
    value += char;
  }
  if (value !== '' || row.length) { row.push(value); rows.push(row); }
  return rows.filter(function(item) { return item.some(function(cell) { return String(cell).trim() !== ''; }); });
}

function bacaFileTeks_(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() { resolve(reader.result); };
    reader.onerror = function() { reject(new Error('Berkas tidak dapat dibaca.')); };
    reader.readAsText(file, 'UTF-8');
  });
}

function barisKeObjek_(rows) {
  if (!rows.length) return [];
  var header = rows[0].map(function(cell) {
    return String(cell || '').trim().toLowerCase().replace(/\s+/g, '_');
  });
  return rows.slice(1).map(function(row) {
    var item = {};
    header.forEach(function(key, index) { if (key) item[key] = String(row[index] === undefined ? '' : row[index]).trim(); });
    return item;
  });
}

function setImportMessage_(id, text, tone) {
  var element = document.getElementById(id);
  element.className = 'media-status show ' + (tone || 'info');
  element.innerHTML = text;
}

async function importSoalDariFile() {
  var input = document.getElementById('importSoalFile');
  var file = input.files[0];
  if (!file) {
    setImportMessage_('importSoalResult', 'Pilih berkas CSV terlebih dahulu.', 'err');
    await hasilInfo_('Berkas Belum Dipilih', 'Pilih berkas CSV hasil template terlebih dahulu, lalu tekan Import Sekarang.');
    return;
  }
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    setImportMessage_('importSoalResult', 'Berkas Excel terdeteksi. Simpan sebagai <b>CSV UTF-8</b> di Excel/Spreadsheet lalu import kembali agar isi terbaca sempurna.', 'err');
    await hasilInfo_('Format Belum Sesuai',
      'Berkas Excel belum dapat dibaca langsung. Buka berkas di Excel atau Google Spreadsheet, lalu pilih Simpan Sebagai / Download dengan format CSV UTF-8.', [
        { label: 'Berkas dipilih', nilai: file.name }
      ]);
    return;
  }
  if (ADMIN.operationBusy.importSoal) return;
  ADMIN.operationBusy.importSoal = true;
  setImportMessage_('importSoalResult', '<i class="fa-solid fa-circle-notch fa-spin"></i> Membaca dan mengirim data soal...', 'info');
  try {
    var objects = barisKeObjek_(parseCsv_(await bacaFileTeks_(file)));
    if (!objects.length) throw new Error('Berkas tidak berisi data soal.');
    var payload = objects.map(function(item) {
      return {
        tipe: String(item.tipe || item.jenis || 'PG').toUpperCase().replace(/[\s-]+/g, '_'),
        pertanyaan: item.pertanyaan || item.soal || '',
        opsi: item.opsi || item.pilihan || '',
        kunci_jawaban: item.kunci_jawaban || item.kunci || '',
        poin: item.poin || item.skor || 10,
        mapel: item.mapel || '',
        stimulus_gambar: item.stimulus_gambar || item.gambar || '',
        stimulus_video: item.stimulus_video || item.video || '',
        // Kolom opsional: kelas sasaran per baris. Baris tanpa kolom ini
        // menjadi SEMUA, sehingga import tidak mengubah kelas soal lain.
        tingkat: tingkatDariNilai_(item.tingkat || item.kelas || item.kelas_sasaran || ''),
        aktif: !/^(tidak|no|0|nonaktif|false)$/i.test(String(item.aktif || 'YA').trim())
      };
    });
    var result = await apiWajib_('importSoalBatch', { rows: payload });
    var pesan = '<i class="fa-solid fa-circle-check"></i> ' + escapeAdmin(result.message || ('Import selesai. ' + (result.berhasil || 0) + ' soal ditambahkan.'));
    if (result.gagal && result.gagal.length) {
      pesan += '<br><b>Baris yang dilewati:</b><br>' + result.gagal.slice(0, 15).map(function(item) {
        return '• ' + escapeAdmin(typeof item === 'string' ? item : (item.baris + ': ' + item.alasan));
      }).join('<br>');
    }
    setImportMessage_('importSoalResult', pesan, result.gagal && result.gagal.length ? 'info' : 'ok');
    input.value = '';
    await segarkanSenyap_([loadQuestions, loadDashboard]);
    var jumlahGagal = (result.gagal || []).length;
    await (jumlahGagal ? hasilInfo_ : hasilSukses_)(
      jumlahGagal ? 'Import Selesai Sebagian' : 'Import Soal Berhasil',
      jumlahGagal
        ? 'Sebagian baris tidak dapat diproses. Rincian baris yang dilewati tampil di bawah tombol Import.'
        : 'Seluruh baris pada berkas berhasil ditambahkan ke bank soal.',
      [ { label: 'Baris dibaca', nilai: String(payload.length) },
        { label: 'Berhasil', nilai: String(result.berhasil || 0) },
        { label: 'Dilewati', nilai: String(jumlahGagal) } ]);
  } catch (error) {
    setImportMessage_('importSoalResult', '<i class="fa-solid fa-circle-exclamation"></i> ' + escapeAdmin(error.message || 'Import soal gagal.'), 'err');
    await hasilGagal_('Import Soal Gagal', error.message || 'Import soal gagal.');
  } finally { ADMIN.operationBusy.importSoal = false; }
}

/* ==================================================================
 * EXPORT LAPORAN
 * ================================================================== */
async function exportLaporanFile(format) {
  if (ADMIN.operationBusy.export) return;
  ADMIN.operationBusy.export = true;
  var status = document.getElementById('exportStatus');
  var namaFormat = format === 'pdf' ? 'PDF' : 'Excel';
  status.className = 'media-status show info';
  status.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Menyusun laporan ' + namaFormat + '. Proses ini bisa memakan waktu beberapa detik...';
  try {
    /*
     * Backend Supabase mengembalikan data laporan (hasil/pelanggaran), bukan
     * base64 seperti backend Google Apps Script lama. Kedua bentuk respons
     * tetap didukung agar frontend ini kompatibel saat dipindahkan.
     */
    var result = await apiWajib_('exportLaporan', {
      format: format,
      kelas: document.getElementById('exportKelas').value.trim()
    });
    var fileName;
    if (result.base64 && result.fileName) {
      // Kompatibilitas backend GAS lama.
      unduhBlob_(base64KeBlob_(result.base64, result.mimeType), result.fileName);
      fileName = result.fileName;
    } else {
      var laporan = siapkanDataLaporan_(result, document.getElementById('exportKelas').value.trim());
      if (!laporan.nilai.length && !laporan.pelanggaran.length) {
        throw new Error('Belum ada data nilai atau pelanggaran untuk diexport.');
      }
      var blob = format === 'pdf' ? buatPdfLaporan_(laporan) : await buatExcelLaporan_(laporan);
      fileName = namaBerkasLaporan_(format, laporan.filterKelas);
      unduhBlob_(blob, fileName);
    }
    status.className = 'media-status show ok';
    status.innerHTML = '<i class="fa-solid fa-circle-check"></i> Laporan <b>' + escapeAdmin(fileName) + '</b> berhasil diunduh.';
    var kelasDipilih = document.getElementById('exportKelas').value.trim();
    await hasilSukses_('Laporan Berhasil Diunduh',
      'Berkas laporan tersimpan di folder unduhan perangkat Anda.', [
        { label: 'Nama berkas', nilai: fileName || '-' },
        { label: 'Format', nilai: namaFormat },
        { label: 'Cakupan', nilai: kelasDipilih ? ('Kelas ' + kelasDipilih) : 'Semua Kelas' }
      ]);
  } catch (error) {
    status.className = 'media-status show err';
    status.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> ' + escapeAdmin(error.message || 'Laporan gagal dibuat.');
    await hasilGagal_('Laporan Gagal Dibuat', error.message || 'Laporan gagal dibuat.', [
      { label: 'Format diminta', nilai: namaFormat }
    ]);
  } finally { ADMIN.operationBusy.export = false; }
}

/* ==================================================================
 * EXPORT BROWSER (Supabase)
 *
 * Fungsi SQL export_laporan sengaja hanya mengirim data JSON agar tidak
 * menyimpan berkas sementara di server. SheetJS dan jsPDF yang dimuat lokal
 * oleh admin.html membentuk berkas .xlsx / .pdf asli di browser.
 * ================================================================== */
function siapkanDataLaporan_(result, filterKelas) {
  var info = (result && result.info) || {};
  var ujian = info.ujian || {};
  var nilai = Array.isArray(result && result.hasil) ? result.hasil : [];
  var pelanggaran = Array.isArray(result && result.pelanggaran) ? result.pelanggaran : [];
  var rekap = Array.isArray(result && result.rekap) ? result.rekap : [];
  return {
    sekolah: String(info.sekolah || 'SMP LABSCHOOL UNTAD PALU'),
    mapel: String(ujian.mapel || ''),
    guru: String(ujian.namaGuruMapel || ujian.namaPemilik || info.oleh || ''),
    kkm: angkaLaporan_(ujian.kkm, 75),
    dibuat: info.dibuat || new Date().toISOString(),
    filterKelas: String(filterKelas || ''),
    nilai: nilai,
    pelanggaran: pelanggaran,
    rekap: rekap
  };
}

function angkaLaporan_(nilai, fallback) {
  var n = Number(nilai);
  return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
}

function teksLaporan_(nilai, fallback) {
  if (nilai === null || nilai === undefined || nilai === '') return fallback === undefined ? '' : fallback;
  return String(nilai);
}

function labelKehadiranLaporan_(nilai) {
  var v = teksLaporan_(nilai, 'HADIR').replace(/_/g, ' ').toLowerCase();
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : 'Hadir';
}

function labelKelulusanLaporan_(row, kkmDefault) {
  var status = teksLaporan_(row && row.status_kelulusan, '').replace(/_/g, ' ').toUpperCase();
  if (status) return status;
  if (angkaLaporan_(row && row.belum_dinilai, 0) > 0) return 'MENUNGGU PENILAIAN';
  return angkaLaporan_(row && row.persen, 0) >= angkaLaporan_(row && row.kkm, kkmDefault) ? 'TUNTAS' : 'REMEDIAL';
}

function labelPelanggaranLaporan_(row) {
  if (row && (row.jenis_label || row.label)) return teksLaporan_(row.jenis_label || row.label);
  var labels = {
    INDIKASI_AI: 'Indikasi jawaban dari aplikasi AI (tersembunyi dari peserta)',
    PINDAH_TAB: 'Berpindah tab / aplikasi',
    KELUAR_FULLSCREEN: 'Keluar layar penuh',
    CETAK_HALAMAN: 'Mencetak halaman',
    TANGKAPAN_LAYAR: 'Tangkapan layar',
    DEVTOOLS: 'Membuka alat pengembang',
    DISKUALIFIKASI: 'Didiskualifikasi'
  };
  var jenis = teksLaporan_(row && row.jenis, '').toUpperCase();
  return labels[jenis] || jenis.replace(/_/g, ' ') || '-';
}

function waktuLaporan_(nilai, denganDetik) {
  if (!nilai) return '-';
  var date = new Date(nilai);
  if (isNaN(date.getTime())) return String(nilai);
  var opsi = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' };
  if (denganDetik) opsi.second = '2-digit';
  return date.toLocaleString('id-ID', opsi).replace(/\./g, ':');
}

function infoLaporan_(laporan) {
  return 'Mata Pelajaran: ' + (laporan.mapel || '-') + ' | Guru: ' + (laporan.guru || '-') +
    ' | KKM: ' + laporan.kkm + ' | Kelas: ' + (laporan.filterKelas || 'Semua') +
    ' | Dicetak: ' + waktuLaporan_(laporan.dibuat, false);
}

function dataNilaiLaporan_(laporan) {
  return laporan.nilai.map(function(row, index) {
    var kkm = angkaLaporan_(row.kkm, laporan.kkm);
    return [
      index + 1,
      teksLaporan_(row.nama), teksLaporan_(row.kelas), teksLaporan_(row.username),
      labelKehadiranLaporan_(row.kehadiran), teksLaporan_(row.mapel, laporan.mapel),
      teksLaporan_(row.guru_mapel, laporan.guru), angkaLaporan_(row.benar, 0),
      angkaLaporan_(row.salah, 0), angkaLaporan_(row.total_nilai, 0),
      angkaLaporan_(row.total_poin, 0), angkaLaporan_(row.persen, 0), kkm,
      labelKelulusanLaporan_(row, laporan.kkm), angkaLaporan_(row.jumlah_pelanggaran, 0),
      waktuLaporan_(row.finished_at, false)
    ];
  });
}

function dataPelanggaranLaporan_(laporan) {
  return laporan.pelanggaran.map(function(row, index) {
    return [
      index + 1, waktuLaporan_(row.timestamp || row.created_at, true), teksLaporan_(row.nama),
      teksLaporan_(row.kelas), teksLaporan_(row.username), labelPelanggaranLaporan_(row),
      teksLaporan_(row.detail, '-'), angkaLaporan_(row.jumlah_ke || row.jumlah, 0),
      teksLaporan_(row.tindakan, '-').replace(/_/g, ' '), teksLaporan_(row.email_status, '-')
    ];
  });
}

function dataRekapLaporan_(laporan) {
  return laporan.rekap.map(function(row, index) {
    return [
      index + 1, teksLaporan_(row.kelas), teksLaporan_(row.mapel, laporan.mapel),
      angkaLaporan_(row.jumlah_peserta, 0), angkaLaporan_(row.selesai, 0),
      angkaLaporan_(row.tuntas, 0), angkaLaporan_(row.remedial, 0),
      angkaLaporan_(row.menunggu_penilaian, 0), angkaLaporan_(row.rata_rata, 0),
      angkaLaporan_(row.tertinggi, 0), angkaLaporan_(row.terendah, 0), angkaLaporan_(row.pelanggaran, 0)
    ];
  });
}

function namaBerkasLaporan_(format, filterKelas) {
  var sekarang = new Date();
  var pad = function(n) { return String(n).padStart(2, '0'); };
  var stamp = sekarang.getFullYear() + pad(sekarang.getMonth() + 1) + pad(sekarang.getDate()) + '-' +
    pad(sekarang.getHours()) + pad(sekarang.getMinutes());
  var kelas = teksLaporan_(filterKelas).replace(/[^a-z0-9_-]+/gi, '').slice(0, 30);
  return 'Laporan-Ujian-' + (kelas ? kelas + '-' : '') + stamp + '.' + (format === 'pdf' ? 'pdf' : 'xlsx');
}

async function buatExcelLaporan_(laporan) {
  /*
   * SheetJS CE membentuk .xlsx dengan baik, tetapi tidak menjamin penulisan
   * style sel. ExcelJS dipakai di sini agar warna, font, border, lebar kolom,
   * freeze pane, filter, dan tata cetak benar-benar tersimpan di Excel.
   */
  if (!window.ExcelJS || !window.ExcelJS.Workbook) {
    throw new Error('Pustaka ExcelJS belum dimuat. Unggah exceljs.min.js di root repository bersama admin.html.');
  }
  var ExcelJS = window.ExcelJS;
  var workbook = new ExcelJS.Workbook();
  workbook.creator = 'SIADO — Sistem Informasi Asesmen Digitalisasi Online';
  workbook.lastModifiedBy = laporan.guru || 'SIADO';
  workbook.created = new Date(laporan.dibuat || Date.now());
  workbook.modified = new Date();
  workbook.properties.title = 'Laporan Ujian ' + laporan.sekolah;
  workbook.properties.subject = laporan.mapel || 'Laporan Ujian';
  workbook.properties.description = 'Laporan nilai, pelanggaran, dan rekap hasil ujian.';

  var headerNilai = ['No', 'Nama Peserta', 'Kelas', 'Username', 'Kehadiran', 'Mata Pelajaran', 'Guru Mapel',
    'Benar', 'Salah', 'Nilai', 'Poin Maks', 'Persen (%)', 'KKM', 'Status', 'Pelanggaran', 'Selesai'];
  var headerPelanggaran = ['No', 'Waktu', 'Nama Peserta', 'Kelas', 'Username', 'Jenis Pelanggaran',
    'Detail', 'Pelanggaran Ke', 'Tindakan', 'Status Email'];
  var headerRekap = ['No', 'Kelas', 'Mata Pelajaran', 'Peserta', 'Selesai', 'Tuntas', 'Remedial',
    'Menunggu Penilaian', 'Rata-rata (%)', 'Tertinggi (%)', 'Terendah (%)', 'Pelanggaran'];

  tambahSheetExcelProfesional_(workbook, {
    nama: 'Nilai',
    judul: 'LAPORAN NILAI UJIAN',
    laporan: laporan,
    header: headerNilai,
    rows: dataNilaiLaporan_(laporan),
    warnaUtama: 'FF1F4E78',
    warnaAksen: 'FFD9EAF7',
    lebar: [6, 29, 18, 18, 15, 23, 23, 9, 9, 11, 12, 13, 9, 23, 14, 21],
    tipe: 'nilai'
  });
  tambahSheetExcelProfesional_(workbook, {
    nama: 'Pelanggaran',
    judul: 'LAPORAN PELANGGARAN UJIAN',
    laporan: laporan,
    header: headerPelanggaran,
    rows: dataPelanggaranLaporan_(laporan),
    warnaUtama: 'FF9E2A2B',
    warnaAksen: 'FFFBE1E1',
    lebar: [6, 22, 29, 18, 18, 30, 48, 16, 23, 18],
    tipe: 'pelanggaran'
  });
  tambahSheetExcelProfesional_(workbook, {
    nama: 'Rekap',
    judul: 'REKAP HASIL UJIAN',
    laporan: laporan,
    header: headerRekap,
    rows: dataRekapLaporan_(laporan),
    warnaUtama: 'FF0B6E69',
    warnaAksen: 'FFD8F0EC',
    lebar: [6, 18, 23, 12, 12, 12, 13, 23, 17, 17, 17, 15],
    tipe: 'rekap'
  });

  var output = await workbook.xlsx.writeBuffer();
  return new Blob([output], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

/* Palet SIADO yang konsisten pada seluruh worksheet Excel. */
var GAYA_EXCEL_LAPORAN = {
  putih: 'FFFFFFFF',
  teks: 'FF183B56',
  teksSekunder: 'FF5D7285',
  garis: 'FFD5E2EC',
  garisLembut: 'FFE8EFF5',
  abuMuda: 'FFF4F8FB',
  hijau: 'FFE2F3E8',
  teksHijau: 'FF147A3D',
  merah: 'FFFBE5E5',
  teksMerah: 'FFB42318',
  kuning: 'FFFFF3D6',
  teksKuning: 'FF9A6700'
};

function warnaPolaExcel_(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb } };
}

function garisExcel_(warna) {
  var sisi = { style: 'thin', color: { argb: warna || GAYA_EXCEL_LAPORAN.garis } };
  return { top: sisi, left: sisi, bottom: sisi, right: sisi };
}

function tambahSheetExcelProfesional_(workbook, opsi) {
  var sheet = workbook.addWorksheet(opsi.nama, {
    properties: { defaultRowHeight: 19 },
    pageSetup: {
      orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 }
    },
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }]
  });
  var panjang = opsi.header.length;
  var akhirKolom = nomorKolomExcel_(panjang);
  sheet.columns = opsi.lebar.map(function(lebar) { return { width: lebar }; });
  sheet.mergeCells(1, 1, 1, panjang);
  sheet.mergeCells(2, 1, 2, panjang);

  var selJudul = sheet.getCell('A1');
  selJudul.value = opsi.judul + ' — ' + opsi.laporan.sekolah;
  selJudul.font = { name: 'Aptos Display', size: 16, bold: true, color: { argb: GAYA_EXCEL_LAPORAN.putih } };
  selJudul.fill = warnaPolaExcel_(opsi.warnaUtama);
  selJudul.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 33;

  var selInfo = sheet.getCell('A2');
  selInfo.value = infoLaporan_(opsi.laporan);
  selInfo.font = { name: 'Aptos', size: 10, italic: true, color: { argb: GAYA_EXCEL_LAPORAN.teksSekunder } };
  selInfo.fill = warnaPolaExcel_(opsi.warnaAksen);
  selInfo.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  sheet.getRow(2).height = 25;
  sheet.getRow(3).height = 9;

  var headerRow = sheet.getRow(4);
  headerRow.values = opsi.header;
  headerRow.height = 34;
  headerRow.eachCell(function(cell) {
    cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: GAYA_EXCEL_LAPORAN.putih } };
    cell.fill = warnaPolaExcel_(opsi.warnaUtama);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = garisExcel_(opsi.warnaUtama);
  });

  var rows = opsi.rows || [];
  if (!rows.length) {
    var kosong = sheet.addRow(['Belum ada data pada laporan ini.']);
    sheet.mergeCells(5, 1, 5, panjang);
    kosong.height = 28;
    kosong.getCell(1).font = { name: 'Aptos', size: 10, italic: true, color: { argb: GAYA_EXCEL_LAPORAN.teksSekunder } };
    kosong.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    kosong.getCell(1).fill = warnaPolaExcel_(GAYA_EXCEL_LAPORAN.abuMuda);
    kosong.getCell(1).border = garisExcel_();
  } else {
    rows.forEach(function(data, index) {
      var row = sheet.addRow(data);
      row.height = 22;
      row.eachCell(function(cell, nomor) {
        cell.font = { name: 'Aptos', size: 10, color: { argb: GAYA_EXCEL_LAPORAN.teks } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = garisExcel_(GAYA_EXCEL_LAPORAN.garisLembut);
        if (index % 2 === 1) cell.fill = warnaPolaExcel_(GAYA_EXCEL_LAPORAN.abuMuda);
        /* REVISI rata tengah: seluruh sel baris sudah rata tengah (baris di atas). */
      });
      formatBarisExcelLaporan_(row, opsi.tipe, data, index);
    });
  }

  var barisAkhir = 4 + Math.max(rows.length, 1);
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: panjang } };
  var ringkasan = ringkasanExcelLaporan_(opsi.tipe, rows);
  var summaryRow = sheet.addRow([ringkasan]);
  sheet.mergeCells(summaryRow.number, 1, summaryRow.number, panjang);
  summaryRow.height = 26;
  var summaryCell = summaryRow.getCell(1);
  summaryCell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: GAYA_EXCEL_LAPORAN.teks } };
  summaryCell.fill = warnaPolaExcel_(opsi.warnaAksen);
  summaryCell.alignment = { horizontal: 'center', vertical: 'middle' };
  summaryCell.border = garisExcel_(opsi.warnaUtama);

  var catatan = sheet.addRow(['Dokumen dibuat otomatis oleh SIADO • Sistem Informasi Asesmen Digitalisasi Online']);
  sheet.mergeCells(catatan.number, 1, catatan.number, panjang);
  catatan.height = 21;
  catatan.getCell(1).font = { name: 'Apts', size: 9, italic: true, color: { argb: GAYA_EXCEL_LAPORAN.teksSekunder } };
  catatan.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };

  sheet.pageSetup.printTitlesRow = '1:4';
  sheet.pageSetup.printArea = 'A1:' + akhirKolom + catatan.number;
  sheet.headerFooter.oddFooter = '&L' + opsi.nama + '&C&D &T&RHalaman &P dari &N';
  sheet.getColumn(1).alignment = { horizontal: 'center', vertical: 'middle' };
  return sheet;
}

function formatBarisExcelLaporan_(row, tipe, data) {
  /* Kolom angka disejajarkan serta diberi format angka yang bersih. */
  if (tipe === 'nilai') {
    [8, 9, 10, 11, 12, 13, 15].forEach(function(kolom) {
      row.getCell(kolom).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    [10, 11, 12].forEach(function(kolom) { row.getCell(kolom).numFmt = '0.00'; });
    [8, 9, 13, 15].forEach(function(kolom) { row.getCell(kolom).numFmt = '0'; });
    var kehadiran = teksLaporan_(data[4]).toUpperCase();
    var status = teksLaporan_(data[13]).toUpperCase();
    if (kehadiran !== 'HADIR') {
      row.getCell(5).fill = warnaPolaExcel_(GAYA_EXCEL_LAPORAN.kuning);
      row.getCell(5).font = { name: 'Aptos', size: 10, bold: true, color: { argb: GAYA_EXCEL_LAPORAN.teksKuning } };
    }
    if (status === 'TUNTAS') {
      row.getCell(14).fill = warnaPolaExcel_(GAYA_EXCEL_LAPORAN.hijau);
      row.getCell(14).font = { name: 'Aptos', size: 10, bold: true, color: { argb: GAYA_EXCEL_LAPORAN.teksHijau } };
    } else if (status === 'REMEDIAL') {
      row.getCell(14).fill = warnaPolaExcel_(GAYA_EXCEL_LAPORAN.merah);
      row.getCell(14).font = { name: 'Aptos', size: 10, bold: true, color: { argb: GAYA_EXCEL_LAPORAN.teksMerah } };
    } else {
      row.getCell(14).fill = warnaPolaExcel_(GAYA_EXCEL_LAPORAN.kuning);
      row.getCell(14).font = { name: 'Aptos', size: 10, bold: true, color: { argb: GAYA_EXCEL_LAPORAN.teksKuning } };
    }
    if (angkaLaporan_(data[14], 0) > 0) {
      row.getCell(15).fill = warnaPolaExcel_(GAYA_EXCEL_LAPORAN.merah);
      row.getCell(15).font = { name: 'Aptos', size: 10, bold: true, color: { argb: GAYA_EXCEL_LAPORAN.teksMerah } };
    }
  } else if (tipe === 'pelanggaran') {
    [1, 8].forEach(function(kolom) { row.getCell(kolom).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
    if (teksLaporan_(data[8]).toUpperCase().indexOf('DISKUALIFIKASI') !== -1) {
      row.getCell(9).fill = warnaPolaExcel_(GAYA_EXCEL_LAPORAN.merah);
      row.getCell(9).font = { name: 'Aptos', size: 10, bold: true, color: { argb: GAYA_EXCEL_LAPORAN.teksMerah } };
    }
  } else if (tipe === 'rekap') {
    for (var kolomRekap = 4; kolomRekap <= 12; kolomRekap++) {
      row.getCell(kolomRekap).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      row.getCell(kolomRekap).numFmt = kolomRekap >= 9 && kolomRekap <= 11 ? '0.00' : '0';
    }
  }
}

function ringkasanExcelLaporan_(tipe, rows) {
  if (tipe === 'nilai') {
    var tuntas = rows.filter(function(row) { return teksLaporan_(row[13]).toUpperCase() === 'TUNTAS'; }).length;
    var remedial = rows.filter(function(row) { return teksLaporan_(row[13]).toUpperCase() === 'REMEDIAL'; }).length;
    var rata = rows.length ? rows.reduce(function(total, row) { return total + angkaLaporan_(row[11], 0); }, 0) / rows.length : 0;
    return 'RINGKASAN • Peserta: ' + rows.length + '  |  Tuntas: ' + tuntas + '  |  Remedial: ' + remedial + '  |  Rata-rata: ' + rata.toFixed(2) + '%';
  }
  if (tipe === 'pelanggaran') return 'RINGKASAN • Total pelanggaran tercatat: ' + rows.length;
  var totalPeserta = rows.reduce(function(total, row) { return total + angkaLaporan_(row[3], 0); }, 0);
  return 'RINGKASAN • Kelas/Mapel: ' + rows.length + '  |  Total peserta: ' + totalPeserta;
}

function nomorKolomExcel_(nomor) {
  var hasil = '';
  while (nomor > 0) {
    var sisa = (nomor - 1) % 26;
    hasil = String.fromCharCode(65 + sisa) + hasil;
    nomor = Math.floor((nomor - 1) / 26);
  }
  return hasil;
}

function buatPdfLaporan_(laporan) {
  var JsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!JsPDF) throw new Error('Pustaka PDF belum dimuat. Pastikan folder vendor/ diunggah bersama admin.html.');
  var doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  if (typeof doc.autoTable !== 'function') {
    throw new Error('Plugin tabel PDF belum dimuat. Pastikan jspdf.plugin.autotable.min.js tersedia di folder vendor/.');
  }
  var headerNilai = ['No', 'Nama Peserta', 'Kelas', 'Username', 'Kehadiran', 'Mapel', 'Guru', 'Benar', 'Salah',
    'Nilai', 'Poin', '%', 'KKM', 'Status', 'Langgar', 'Selesai'];
  var headerPelanggaran = ['No', 'Waktu', 'Nama Peserta', 'Kelas', 'Username', 'Jenis Pelanggaran',
    'Detail', 'Ke-', 'Tindakan', 'Email'];
  gambarJudulPdf_(doc, 'LAPORAN NILAI UJIAN', laporan);
  tabelPdfLaporan_(doc, 23, headerNilai, dataNilaiLaporan_(laporan), [
    7, 28, 14, 17, 13, 20, 20, 8, 8, 9, 9, 8, 8, 19, 10, 18
  ], [31, 111, 235], 13);
  doc.addPage('a4', 'landscape');
  gambarJudulPdf_(doc, 'LAPORAN PELANGGARAN UJIAN', laporan);
  tabelPdfLaporan_(doc, 23, headerPelanggaran, dataPelanggaranLaporan_(laporan), [
    7, 22, 28, 15, 18, 28, 54, 9, 22, 17
  ], [180, 35, 24], -1);
  tambahNomorHalamanPdf_(doc);
  return doc.output('blob');
}

function gambarJudulPdf_(doc, judul, laporan) {
  doc.setTextColor(16, 42, 67);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(judul + ' — ' + laporan.sekolah, 14, 11);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(80, 95, 110);
  doc.text(infoLaporan_(laporan), 14, 16);
}

function tabelPdfLaporan_(doc, startY, header, rows, widths, warna, kolomStatus) {
  var body = rows.length ? rows : [['Belum ada data.']];
  var stylesKolom = {};
  widths.forEach(function(width, index) { stylesKolom[index] = { cellWidth: width }; });
  doc.autoTable({
    startY: startY,
    head: [header],
    body: body,
    theme: 'grid',
    margin: { left: 8, right: 8 },
    styles: { font: 'helvetica', fontSize: 5.8, cellPadding: 0.85, overflow: 'linebreak', valign: 'middle', halign: 'center', lineColor: [205, 216, 228], lineWidth: 0.1 },
    headStyles: { fillColor: warna, textColor: 255, fontStyle: 'bold', halign: 'center', fontSize: 5.8 },
    columnStyles: stylesKolom,
    didParseCell: function(hook) {
      /* REVISI: REMEDIAL tampil tebal + merah pada laporan nilai. */
      if (hook.section === 'body' && kolomStatus >= 0 && hook.column.index === kolomStatus &&
          String(hook.cell.raw || '').toUpperCase() === 'REMEDIAL') {
        hook.cell.styles.textColor = [180, 35, 24];
        hook.cell.styles.fontStyle = 'bold';
      }
    },
    didDrawPage: function(data) {
      if (data.pageNumber > 1) {
        doc.setFontSize(7);
        doc.setTextColor(80, 95, 110);
        doc.text('Lanjutan laporan', 14, 11);
      }
    }
  });
}

function tambahNomorHalamanPdf_(doc) {
  var pages = doc.internal.getNumberOfPages();
  for (var page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 115, 130);
    doc.text('SIADO • Halaman ' + page + ' dari ' + pages, 287, 204, { align: 'right' });
  }
}

function base64KeBlob_(base64, mimeType) {
  var binary = atob(String(base64 || ''));
  var buffer = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
  return new Blob([buffer], { type: mimeType || 'application/octet-stream' });
}

/* ==================================================================
 * PUSAT NOTIFIKASI
 * ================================================================== */
function applyNotificationBadge_(jumlah) {
  ADMIN.unreadNotif = Number(jumlah) || 0;
  var dot = document.getElementById('notifDot');
  var sidebarBadge = document.getElementById('notifSidebarBadge');
  var teks = ADMIN.unreadNotif > 99 ? '99+' : String(ADMIN.unreadNotif);
  dot.textContent = teks;
  dot.classList.toggle('show', ADMIN.unreadNotif > 0);
  sidebarBadge.textContent = teks;
  sidebarBadge.style.display = ADMIN.unreadNotif > 0 ? 'inline-block' : 'none';
}

async function loadNotificationBadge_() {
  if (!ADMIN.token) return;
  try {
    var result = await adminApi('getNotifikasi', { hanyaJumlah: true });
    if (result && result.success) applyNotificationBadge_(result.belumDibaca || 0);
  } catch (error) {}
}

async function loadNotifications() {
  if (!ADMIN.token || ADMIN.refreshBusy.notif) return;
  ADMIN.refreshBusy.notif = true;
  try {
    var result = await adminApi('getNotifikasi', {});
    if (!guardAdminResult(result)) return;
    ADMIN.notifications = result.data || [];
    applyNotificationBadge_(result.belumDibaca || 0);
    renderNotifications_(ADMIN.notifications);
  } catch (error) {
    document.getElementById('notifList').innerHTML = '<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i> Notifikasi gagal dimuat.</div>';
  } finally { ADMIN.refreshBusy.notif = false; }
}

function renderNotifications_(rows) {
  var container = document.getElementById('notifList');
  if (!rows.length) {
    container.innerHTML = '<div class="empty-state"><i class="fa-regular fa-bell"></i> Belum ada notifikasi.</div>';
    return;
  }
  container.innerHTML = rows.map(function(item) {
    var level = String(item.level || 'INFO').toUpperCase();
    var kelas = level === 'PENTING' || level === 'BAHAYA' ? 'danger' : (level === 'PERINGATAN' ? 'warn' : '');
    var ikon = kelas === 'danger' ? 'fa-triangle-exclamation' : (kelas === 'warn' ? 'fa-circle-exclamation' : 'fa-circle-info');
    return '<article class="notif-item ' + kelas + (item.dibaca ? '' : ' unread') + '">' +
      '<div class="notif-icon"><i class="fa-solid ' + ikon + '"></i></div>' +
      '<div class="notif-body"><strong>' + escapeAdmin(item.judul) + '<span class="notif-cat">' + escapeAdmin(item.kategori || 'UMUM') + '</span></strong>' +
      '<p>' + escapeAdmin(item.pesan) + '</p>' +
      '<time>' + escapeAdmin(formatDate(item.timestamp)) + (item.sumber ? ' • ' + escapeAdmin(item.sumber) : '') + '</time></div>' +
      '<button class="mini-button delete" type="button" title="Hapus notifikasi ini" data-hapus-notif="' + escapeAdmin(item.id) + '"><i class="fa-solid fa-trash"></i></button>' +
      '</article>';
  }).join('');
  // Revisi 6: notifikasi dapat dihapus SATU PER SATU oleh semua peran
  // (admin/proktor/guru mapel), bukan hanya dihapus semua sekaligus.
  document.querySelectorAll('[data-hapus-notif]').forEach(function(button) {
    button.addEventListener('click', function() { hapusSatuNotifikasi_(this.dataset.hapusNotif); });
  });
}

async function hapusSatuNotifikasi_(id) {
  if (!id) return;
  var setujuNotif = await konfirmasi_('Notifikasi ini akan dihapus permanen.', {
    judul: 'Hapus Notifikasi', nada: 'danger', teksOk: 'Ya, Hapus' });
  if (!setujuNotif) return;
  try {
    var result = await apiWajib_('hapusNotifikasi', { id: id });
    await segarkanSenyap_([loadNotifications]);
    await hasilSukses_('Notifikasi Dihapus', result.message || 'Notifikasi berhasil dihapus.');
  } catch (error) {
    await hasilGagal_('Notifikasi Gagal Dihapus', error.message || 'Notifikasi gagal dihapus.');
  }
}

async function markNotificationsRead(id) {
  try {
    var result = await adminApi('tandaiNotifikasiDibaca', { id: id || '' });
    if (!guardAdminResult(result)) return;
    showToast(result.message || 'Notifikasi ditandai dibaca.', 'success');
    loadNotifications();
  } catch (error) { showToast('Notifikasi gagal ditandai.', 'error'); }
}

async function clearAllNotifications() {
  var setujuNotif = await konfirmasi_('Seluruh notifikasi akan dihapus permanen. Riwayat informasi tidak dapat dikembalikan.',
    { judul: 'Hapus Semua Notifikasi', nada: 'danger', teksOk: 'Ya, Hapus Semua' });
  if (!setujuNotif) return;
  try {
    var result = await apiWajib_('hapusNotifikasi', {});
    await segarkanSenyap_([loadNotifications]);
    await hasilSukses_('Notifikasi Dihapus', result.message || 'Seluruh notifikasi berhasil dihapus.');
  } catch (error) {
    await hasilGagal_('Notifikasi Gagal Dihapus', error.message || 'Notifikasi gagal dihapus.');
  }
}

/* ==================================================================
 * AKUN GURU MAPEL (KHUSUS ADMIN)
 * ================================================================== */
async function loadTeachers() {
  if (!ADMIN.token || !ADMIN.isAdmin || ADMIN.refreshBusy.guru) return;
  ADMIN.refreshBusy.guru = true;
  try {
    var result = await adminApi('getDaftarGuru', {});
    if (!guardAdminResult(result)) return;
    ADMIN.teachers = result.data || [];
    DATA_MENTAH.guru = ADMIN.teachers;
    terapkanFilterGuru_();
    sinkronBatasKelasPanel_();
  } catch (error) {
    setTableMessage('teacherTable', 'Daftar guru gagal dimuat.', 'fa-triangle-exclamation');
  } finally { ADMIN.refreshBusy.guru = false; }
}

/** Menyaring daftar akun guru berdasarkan nama, username, atau mapel. */
function terapkanFilterGuru_() {
  var kueri = kueriFilter_('cariGuru');
  var rows = saringKata_(DATA_MENTAH.guru, kueri, function(g) {
    return [g.nama, g.username, g.mapel, normalisasiKelas_(g.kelasMapel1).join(' '), normalisasiKelas_(g.kelasMapel2).join(' ')].join(' ');
  });
  if (!rows.length && kueri) {
    tampilTidakDitemukan_('teacherTable', kueri, DATA_MENTAH.guru.length + ' akun guru terdaftar.');
    return;
  }
  renderTeacherTable_(rows);
}

function renderTeacherTable_(rows) {
  if (!rows.length) { setTableMessage('teacherTable', 'Belum ada akun guru mapel.', 'fa-user-plus'); return; }
  var html = '<table class="admin-table"><thead><tr><th>Nama Guru</th><th>Username</th><th>Mapel Diampu</th><th>KKM</th><th>Status</th><th>Dibuat</th><th>Aksi</th></tr></thead><tbody>';
  rows.forEach(function(row) {
    html += '<tr><td><strong>' + escapeAdmin(row.nama) + '</strong></td>' +
      '<td><code>' + escapeAdmin(row.username) + '</code></td>' +
      '<td><div class="cell-wrap">' + teksMapelGuru_(row.mapel) + '<br><small style="color:#71879c">' + escapeAdmin(teksKelasGuru_(row)) + '</small></div></td>' +
      '<td>' + escapeAdmin(row.kkm || 75) + '</td>' +
      '<td>' + (row.aktif ? badge('Aktif', 'green') : badge('Nonaktif', 'gray')) + '</td>' +
      '<td>' + escapeAdmin(formatDate(row.created_at)) + '</td>' +
      '<td><div class="row-actions">' +
      '<button class="mini-button edit" type="button" data-edit-guru="' + escapeAdmin(row.username) + '"><i class="fa-solid fa-pen"></i> Ubah</button>' +
      '<button class="mini-button" type="button" data-reset-guru="' + escapeAdmin(row.username) + '"><i class="fa-solid fa-key"></i> Reset Password</button>' +
      '<button class="mini-button delete" type="button" data-hapus-guru="' + escapeAdmin(row.username) + '"><i class="fa-solid fa-trash"></i></button>' +
      '</div></td></tr>';
  });
  document.getElementById('teacherTable').innerHTML = html + '</tbody></table>';
  document.querySelectorAll('[data-edit-guru]').forEach(function(button) {
    button.addEventListener('click', function() { editTeacher(this.dataset.editGuru); });
  });
  document.querySelectorAll('[data-reset-guru]').forEach(function(button) {
    button.addEventListener('click', function() { resetTeacherPassword(this.dataset.resetGuru); });
  });
  document.querySelectorAll('[data-hapus-guru]').forEach(function(button) {
    button.addEventListener('click', function() { deleteTeacher(this.dataset.hapusGuru); });
  });
}

async function createTeacher() {
  if (ADMIN.operationBusy.guru) return;
  // REVISI 2 mapel: Mapel 1 wajib, Mapel 2 opsional; disimpan gabung "A | B".
  var mapel1Baru = String(document.getElementById('gMapel1').value || '').trim();
  var mapel2Baru = String(document.getElementById('gMapel2').value || '').trim();
  if (!mapel1Baru) {
    await hasilInfo_('Mapel 1 Wajib Diisi', 'Mata pelajaran 1 wajib diisi. Mapel 2 boleh dikosongkan bila guru hanya mengampu 1 mapel.');
    return;
  }
  if (mapel1Baru.indexOf('|') !== -1 || mapel2Baru.indexOf('|') !== -1) {
    await hasilInfo_('Karakter Tidak Diizinkan', 'Nama mapel tidak boleh mengandung karakter pipa (|).');
    return;
  }
  var mapelGabungBaru = gabungMapelGuru_(mapel1Baru, mapel2Baru);
  if (mapelGabungBaru.length > 150) {
    await hasilInfo_('Nama Mapel Terlalu Panjang', 'Gabungan kedua nama mapel maksimal 150 karakter. Singkat salah satunya.');
    return;
  }
  var kirimKelas1 = bacaKotakKelas_('kelasMapel1Box');
  var kirimKelas2 = bacaKotakKelas_('kelasMapel2Box');
  ADMIN.operationBusy.guru = true;
  setFormBusy('teacherForm', true);
  try {
    var result = await adminApi('tambahGuru', {
      nama: document.getElementById('gNama').value,
      username: document.getElementById('gUsername').value,
      password: document.getElementById('gPassword').value,
      mapel: mapelGabungBaru,
      kelasMapel1: kirimKelas1,
      kelasMapel2: kirimKelas2,
      kkm: document.getElementById('gKkm').value
    });
    if (!guardAdminResult(result)) throw new Error(result.message || 'Akun guru gagal dibuat.');
    var statusKelas = await simpanBatasKelasGuru_(String(document.getElementById('gUsername').value || '').trim(), kirimKelas1, kirimKelas2, mapelGabungBaru);
    var namaGuru = document.getElementById('gNama').value;
    var userGuru = document.getElementById('gUsername').value;
    var kkmGuru = document.getElementById('gKkm').value;
    document.getElementById('teacherForm').reset();
    document.getElementById('gKkm').value = 75;
    ['kelasMapel1Box', 'kelasMapel2Box'].forEach(function(id) {
      var box = document.getElementById(id);
      if (box) box.querySelectorAll('input[type="checkbox"]').forEach(function(c) { c.checked = false; });
    });
    await segarkanSenyap_([loadTeachers]);
    await hasilSukses_('Akun Guru Dibuat', result.message || 'Akun guru mapel berhasil dibuat.', [
      { label: 'Nama', nilai: namaGuru },
      { label: 'Username', nilai: userGuru },
      { label: 'Mapel 1', nilai: mapel1Baru },
      { label: 'Kelas Mapel 1', nilai: kirimKelas1.join(', ') || 'Semua kelas' },
      { label: 'Mapel 2', nilai: mapel2Baru || '-' },
      { label: 'Kelas Mapel 2', nilai: mapel2Baru ? (kirimKelas2.join(', ') || 'Semua kelas') : '-' },
      { label: 'KKM', nilai: String(kkmGuru || 75) },
      { label: 'Status Batas Kelas', nilai: statusKelas }
    ]);
    await verifikasiBatasKelas_(userGuru, kirimKelas1, kirimKelas2);
  } catch (error) {
    await hasilGagal_('Akun Guru Gagal Dibuat', error.message || 'Akun guru gagal dibuat.');
  }
  finally { ADMIN.operationBusy.guru = false; setFormBusy('teacherForm', false); }
}

/**
 * Membuka jendela ubah akun guru.
 *
 * Satu formulir agar nama, username, mapel, KKM, dan password dapat diubah
 * sekaligus tanpa rangkaian kotak isian beruntun.
 */
function editTeacher(username) {
  var guru = (ADMIN.teachers || []).filter(function(item) { return item.username === username; })[0];
  if (!guru) {
    hasilGagal_('Akun Tidak Ditemukan', 'Data akun guru tidak ada pada daftar. Tekan Refresh lalu coba lagi.');
    return;
  }
  document.getElementById('egUsernameLama').value = guru.username;
  document.getElementById('egNama').value = guru.nama || '';
  document.getElementById('egUsername').value = guru.username || '';
  // REVISI 2 mapel: uraikan simpanan "Mapel 1 | Mapel 2" ke dua kolom.
  var mapelPecah = pecahMapelGuru_(guru.mapel || '');
  document.getElementById('egMapel1').value = mapelPecah[0] || '';
  document.getElementById('egMapel2').value = mapelPecah[1] || '';
  renderKotakKelas_('egKelasMapel1Box', normalisasiKelas_(guru.kelasMapel1));
  renderKotakKelas_('egKelasMapel2Box', normalisasiKelas_(guru.kelasMapel2));
  muatRombelUntukFormGuru_().then(function() {
    renderKotakKelas_('egKelasMapel1Box', normalisasiKelas_(guru.kelasMapel1));
    renderKotakKelas_('egKelasMapel2Box', normalisasiKelas_(guru.kelasMapel2));
  });
  perbaruiLabelKelasGuru_();
  document.getElementById('egKkm').value = guru.kkm || 75;
  document.getElementById('egPassword').value = '';
  document.getElementById('egAktif').checked = guru.aktif !== false;
  document.getElementById('editTeacherModal').classList.add('show');
  window.setTimeout(function() { document.getElementById('egNama').focus(); }, 60);
}

function tutupEditGuru_() {
  document.getElementById('editTeacherModal').classList.remove('show');
}

async function simpanEditGuru_() {
  if (ADMIN.operationBusy.editGuru) return;
  var nama = nilaiInput_('egNama').trim();
  var usernameBaru = nilaiInput_('egUsername').trim().toLowerCase();
  var mapel1 = nilaiInput_('egMapel1').trim();
  var mapel2 = nilaiInput_('egMapel2').trim();
  var password = nilaiInput_('egPassword');
  if (!nama) { await hasilInfo_('Nama Wajib Diisi', 'Nama guru tidak boleh kosong.'); return; }
  if (!usernameBaru) { await hasilInfo_('Username Wajib Diisi', 'Username akun guru tidak boleh kosong.'); return; }
  if (!mapel1) { await hasilInfo_('Mapel 1 Wajib Diisi', 'Mata pelajaran 1 wajib diisi. Mapel 2 boleh dikosongkan.'); return; }
  if (mapel1.indexOf('|') !== -1 || mapel2.indexOf('|') !== -1) {
    await hasilInfo_('Karakter Tidak Diizinkan', 'Nama mapel tidak boleh mengandung karakter pipa (|).');
    return;
  }
  var mapel = gabungMapelGuru_(mapel1, mapel2);
  if (mapel.length > 150) {
    await hasilInfo_('Nama Mapel Terlalu Panjang', 'Gabungan kedua nama mapel maksimal 150 karakter. Singkat salah satunya.');
    return;
  }
  var kirimKelas1 = bacaKotakKelas_('egKelasMapel1Box');
  var kirimKelas2 = bacaKotakKelas_('egKelasMapel2Box');
  if (password && password.length < 8) {
    await hasilInfo_('Password Terlalu Pendek', 'Password baru minimal 8 karakter. Kosongkan bila tidak ingin mengubah password.');
    return;
  }

  ADMIN.operationBusy.editGuru = true;
  setFormBusy('editTeacherForm', true);
  var usernameLama = nilaiInput_('egUsernameLama');
  var kkm = nilaiInput_('egKkm');
  try {
    var result = await apiWajib_('updateGuru', {
      username: usernameLama,
      usernameBaru: usernameBaru,
      nama: nama,
      mapel: mapel,
      kelasMapel1: kirimKelas1,
      kelasMapel2: kirimKelas2,
      kkm: kkm,
      passwordBaru: password,
      aktif: document.getElementById('egAktif').checked
    });
    var statusKelas = await simpanBatasKelasGuru_(usernameBaru, kirimKelas1, kirimKelas2, mapel);
    tutupEditGuru_();
    await segarkanSenyap_([loadTeachers]);
    await hasilSukses_('Akun Guru Diperbarui', result.message || 'Perubahan akun guru berhasil disimpan.', [
      { label: 'Nama', nilai: nama },
      { label: 'Username', nilai: result.username || usernameBaru },
      { label: 'Mapel 1', nilai: mapel1 },
      { label: 'Kelas Mapel 1', nilai: kirimKelas1.join(', ') || 'Semua kelas' },
      { label: 'Mapel 2', nilai: mapel2 || '-' },
      { label: 'Kelas Mapel 2', nilai: mapel2 ? (kirimKelas2.join(', ') || 'Semua kelas') : '-' },
      { label: 'KKM', nilai: String(kkm) },
      { label: 'Status Batas Kelas', nilai: statusKelas },
      { label: 'Password', nilai: password ? 'Diubah — sampaikan ke guru' : 'Tidak diubah' }
    ]);
    await verifikasiBatasKelas_(result.username || usernameBaru, kirimKelas1, kirimKelas2);
  } catch (error) {
    await hasilGagal_('Perubahan Gagal Disimpan', error.message || 'Data guru gagal diperbarui.');
  } finally {
    ADMIN.operationBusy.editGuru = false;
    setFormBusy('editTeacherForm', false);
  }
}

async function resetTeacherPassword(username) {
  var password = await tanya_('Buat password baru untuk akun "' + username + '".',
    { judul: 'Reset Password Guru', nada: 'warn', label: 'Password baru',
      placeholder: 'Minimal 8 karakter', hint: 'Sampaikan password ini kepada guru yang bersangkutan.',
      teksOk: 'Reset Password' });
  if (password === null) return;
  if (String(password).length < 8) {
    await hasilInfo_('Password Terlalu Pendek', 'Password baru minimal 8 karakter. Silakan ulangi.');
    return;
  }
  try {
    await apiWajib_('resetPasswordGuru', { username: username, passwordBaru: password });
    await segarkanSenyap_([loadTeachers]);
    await hasilSukses_('Password Direset',
      'Sampaikan password baru kepada guru yang bersangkutan. Sesi panel lamanya otomatis diputus.', [
        { label: 'Akun', nilai: username },
        { label: 'Password baru', nilai: password }
      ]);
  } catch (error) {
    await hasilGagal_('Password Gagal Direset', error.message || 'Password guru gagal direset.');
  }
}

async function deleteTeacher(username) {
  var setujuGuru = await konfirmasi_('Akun guru "' + username + '" akan dihapus. Guru tersebut langsung dikeluarkan dari panel.',
    { judul: 'Hapus Akun Guru', nada: 'danger', teksOk: 'Ya, Hapus Akun' });
  if (!setujuGuru) return;
  try {
    var result = await apiWajib_('hapusGuru', { username: username });
    await segarkanSenyap_([loadTeachers]);
    await hasilSukses_('Akun Guru Dihapus', result.message || 'Akun guru berhasil dihapus.', [
      { label: 'Akun', nilai: username }
    ]);
  } catch (error) {
    await hasilGagal_('Akun Gagal Dihapus', error.message || 'Akun guru gagal dihapus.');
  }
}

/* ==================================================================
 * DATA PESERTA DAN ROMBEL
 * ================================================================== */
async function loadParticipants() {
  if (!ADMIN.token || ADMIN.refreshBusy.peserta) return;
  ADMIN.refreshBusy.peserta = true;
  try {
    var result = await adminApi('getDataPeserta', { rombel: document.getElementById('filterPesertaRombel').value });
    if (!guardAdminResult(result)) return;
    ADMIN.participants = result.data || [];
    ADMIN.rombel = result.rombel || [];
    DATA_MENTAH.peserta = ADMIN.participants;
    renderRombelList_(ADMIN.rombel);
    isiPilihanRombelAdmin_(ADMIN.rombel);
    terapkanFilterPeserta_();
  } catch (error) {
    setTableMessage('participantTable', 'Data peserta gagal dimuat.', 'fa-triangle-exclamation');
  } finally { ADMIN.refreshBusy.peserta = false; }
}

function isiPilihanRombelAdmin_(rombel) {
  var pilihan = document.getElementById('pRombel');
  var filter = document.getElementById('filterPesertaRombel');
  var nilaiPilihan = pilihan.value;
  var nilaiFilter = filter.value;
  var opsi = rombel.map(function(item) {
    return '<option value="' + escapeAdmin(item.rombel) + '">' + escapeAdmin(item.rombel) + '</option>';
  }).join('');
  pilihan.innerHTML = '<option value="">Pilih rombel</option>' + opsi;
  filter.innerHTML = '<option value="">Semua rombel</option>' + opsi;
  pilihan.value = nilaiPilihan;
  filter.value = nilaiFilter;
}

function renderRombelList_(rows) {
  var container = document.getElementById('rombelList');
  if (!rows.length) {
    container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-layer-group"></i> Belum ada rombel. Tambahkan rombel VII, VIII, atau IX terlebih dahulu.</div>';
    return;
  }
  container.innerHTML = rows.map(function(item) {
    return '<article class="rombel-card"><h4>' + escapeAdmin(item.rombel) + ' <span class="tingkat-pill">Tingkat ' + escapeAdmin(item.tingkat || '-') + '</span></h4>' +
      '<p>Wali kelas: <b>' + escapeAdmin(item.waliKelas || '-') + '</b></p>' +
      '<p>Jumlah peserta: <b>' + escapeAdmin(item.jumlahPeserta || 0) + '</b></p>' +
      '<p>Token: <span class="' + (item.adaToken ? 'token-yes' : 'token-no') + '">' + (item.adaToken ? 'Sudah diatur' : 'Belum diatur') + '</span></p>' +
      '<p>Status: ' + (item.aktif ? badge('Aktif', 'green') : badge('Nonaktif', 'gray')) + '</p>' +
      '<div class="rombel-actions">' +
      (ADMIN.isAdmin
        ? '<button class="mini-button" type="button" title="Naikkan urutan rombel" data-naik-rombel="' + escapeAdmin(item.rombel) + '"><i class="fa-solid fa-arrow-up"></i></button>' +
          '<button class="mini-button" type="button" title="Turunkan urutan rombel" data-turun-rombel="' + escapeAdmin(item.rombel) + '"><i class="fa-solid fa-arrow-down"></i></button>'
        : '') +
      '<button class="mini-button edit" type="button" data-edit-rombel="' + escapeAdmin(item.rombel) + '"><i class="fa-solid fa-pen"></i> Ubah</button>' +
      '<button class="mini-button" type="button" data-token-rombel="' + escapeAdmin(item.rombel) + '"><i class="fa-solid fa-key"></i> Ganti Token</button>' +
      '<button class="mini-button delete" type="button" data-hapus-rombel="' + escapeAdmin(item.rombel) + '"><i class="fa-solid fa-trash"></i></button>' +
      '</div></article>';
  }).join('');
  document.querySelectorAll('[data-edit-rombel]').forEach(function(button) {
    button.addEventListener('click', function() { isiFormRombel_(this.dataset.editRombel); });
  });
  document.querySelectorAll('[data-token-rombel]').forEach(function(button) {
    button.addEventListener('click', function() { gantiTokenRombel_(this.dataset.tokenRombel); });
  });
  document.querySelectorAll('[data-hapus-rombel]').forEach(function(button) {
    button.addEventListener('click', function() { hapusRombel_(this.dataset.hapusRombel); });
  });
  document.querySelectorAll('[data-naik-rombel]').forEach(function(button) {
    button.addEventListener('click', function() { ubahUrutanRombel_(this.dataset.naikRombel, 'naik'); });
  });
  document.querySelectorAll('[data-turun-rombel]').forEach(function(button) {
    button.addEventListener('click', function() { ubahUrutanRombel_(this.dataset.turunRombel, 'turun'); });
  });
}

function isiFormRombel_(nama) {
  var item = ADMIN.rombel.filter(function(row) { return row.rombel === nama; })[0];
  if (!item) return;
  document.getElementById('rNama').value = item.rombel;
  document.getElementById('rWali').value = item.waliKelas || '';
  document.getElementById('rToken').value = '';
  document.getElementById('rAktif').checked = !!item.aktif;
  document.getElementById('rNama').focus();
  hasilInfo_('Data Rombel Dimuat',
    'Data rombel telah dimuat ke formulir di atas. Ubah seperlunya lalu tekan Simpan Rombel.', [
      { label: 'Rombel', nilai: item.rombel },
      { label: 'Token', nilai: 'Kosongkan bila tidak diubah' }
    ]);
}

async function gantiTokenRombel_(nama) {
  var token = await tanya_('Token baru akan menggantikan token lama rombel ' + nama + '.',
    { judul: 'Ganti Token Rombel', nada: 'warn', label: 'Token ujian baru',
      nilaiAwal: buatTokenAcak_(), hint: 'Minimal 6 karakter. Bagikan token ini kepada peserta rombel tersebut.',
      teksOk: 'Simpan Token' });
  if (token === null) return;
  try {
    await apiWajib_('simpanRombel', { rombel: nama, token: token });
    await segarkanSenyap_([loadParticipants]);
    await hasilSukses_('Token Diperbarui',
      'Bagikan token baru kepada peserta rombel tersebut sebelum ujian dimulai.', [
        { label: 'Rombel', nilai: nama },
        { label: 'Token baru', nilai: token }
      ]);
  } catch (error) {
    await hasilGagal_('Token Gagal Diubah', error.message || 'Token rombel gagal diubah.');
  }
}

async function hapusRombel_(nama) {
  var setujuRombel = await konfirmasi_('Rombel ' + nama + ' akan dihapus. Rombel hanya dapat dihapus bila tidak lagi memiliki peserta.',
    { judul: 'Hapus Rombel', nada: 'danger', teksOk: 'Ya, Hapus Rombel' });
  if (!setujuRombel) return;
  try {
    var result = await apiWajib_('hapusRombel', { rombel: nama });
    await segarkanSenyap_([loadParticipants]);
    await hasilSukses_('Rombel Dihapus', result.message || 'Rombel berhasil dihapus.', [
      { label: 'Rombel', nilai: nama }
    ]);
  } catch (error) {
    await hasilGagal_('Rombel Gagal Dihapus', error.message || 'Rombel gagal dihapus.');
  }
}

async function saveRombel() {
  if (ADMIN.operationBusy.rombel) return;
  ADMIN.operationBusy.rombel = true;
  setFormBusy('rombelForm', true);
  try {
    var result = await adminApi('simpanRombel', {
      rombel: document.getElementById('rNama').value,
      waliKelas: document.getElementById('rWali').value,
      token: document.getElementById('rToken').value,
      aktif: document.getElementById('rAktif').checked
    });
    if (!guardAdminResult(result)) throw new Error(result.message || 'Rombel gagal disimpan.');
    var namaRombel = document.getElementById('rNama').value;
    var adaToken = !!document.getElementById('rToken').value;
    document.getElementById('rombelForm').reset();
    document.getElementById('rAktif').checked = true;
    await segarkanSenyap_([loadParticipants]);
    await hasilSukses_('Rombel Tersimpan', result.message || 'Data rombel berhasil disimpan.', [
      { label: 'Rombel', nilai: namaRombel },
      { label: 'Token ujian', nilai: adaToken ? 'Diperbarui' : 'Tidak diubah' }
    ]);
  } catch (error) {
    await hasilGagal_('Rombel Gagal Disimpan', error.message || 'Rombel gagal disimpan.');
  }
  finally { ADMIN.operationBusy.rombel = false; setFormBusy('rombelForm', false); }
}

/** Lencana warna untuk status kehadiran peserta. */
function lencanaKehadiran_(nilai) {
  var status = String(nilai || 'HADIR').toUpperCase();
  var warna = { HADIR: 'green', SAKIT: 'amber', IZIN: 'blue', ALPA: 'red' }[status] || 'gray';
  var label = { HADIR: 'Hadir', SAKIT: 'Sakit', IZIN: 'Izin', ALPA: 'Alpa' }[status] || status;
  return badge(label, warna);
}

/** Menyaring daftar peserta berdasarkan kata kunci dan status kehadiran. */
function terapkanFilterPeserta_() {
  var kueri = kueriFilter_('cariPeserta');
  var kehadiran = nilaiFilter_('filterPesertaKehadiran');
  var rombel = nilaiFilter_('filterPesertaRombel');
  var rows = DATA_MENTAH.peserta.slice();
  if (kehadiran) {
    rows = rows.filter(function(p) {
      return String(p.kehadiran || 'HADIR').toUpperCase() === kehadiran;
    });
  }
  rows = saringKata_(rows, kueri, function(p) {
    return [p.nama, p.username, p.nis, p.rombel].join(' ');
  });
  if (!rows.length && adaFilterAktif_(kueri, kehadiran, rombel)) {
    tampilTidakDitemukan_('participantTable', kueri, DATA_MENTAH.peserta.length + ' peserta termuat untuk rombel yang dipilih.');
    return;
  }
  renderParticipantTable_(rows);
}

function renderParticipantTable_(rows) {
  if (!rows.length) { setTableMessage('participantTable', 'Belum ada peserta terdaftar pada filter ini.', 'fa-user-plus'); return; }
  // Proktor/admin dapat mengubah dan menghapus data peserta. Guru mapel tidak,
  // tetapi tetap boleh mencatat kehadiran karena kehadiran diisi per ujian.
  var bolehUbah = ADMIN.isAdmin;
  var html = '<table class="admin-table"><thead><tr><th>Nama Lengkap</th><th>Username</th><th>Rombel</th><th>NIS</th><th>Kehadiran</th><th>Status</th>' +
    '<th>Aksi</th></tr></thead><tbody>';
  rows.forEach(function(row) {
    html += '<tr><td><strong>' + escapeAdmin(row.nama) + '</strong></td>' +
      '<td><code>' + escapeAdmin(row.username) + '</code></td>' +
      '<td>' + badge(row.rombel, 'blue') + '</td>' +
      '<td>' + escapeAdmin(row.nis || '-') + '</td>' +
      '<td>' + lencanaKehadiran_(row.kehadiran) + '</td>' +
      '<td>' + (row.aktif ? badge('Aktif', 'green') : badge('Nonaktif', 'gray')) + '</td>' +
      '<td><div class="row-actions">' +
      '<button class="mini-button" type="button" data-kehadiran-peserta="' + escapeAdmin(row.id) + '"><i class="fa-solid fa-clipboard-user"></i> Kehadiran</button>' +
      (bolehUbah
        ? '<button class="mini-button" type="button" title="Naikkan urutan siswa" data-naik-peserta="' + escapeAdmin(row.id) + '" data-rombel-peserta="' + escapeAdmin(row.rombel) + '"><i class="fa-solid fa-arrow-up"></i></button>' +
          '<button class="mini-button" type="button" title="Turunkan urutan siswa" data-turun-peserta="' + escapeAdmin(row.id) + '" data-rombel-peserta="' + escapeAdmin(row.rombel) + '"><i class="fa-solid fa-arrow-down"></i></button>' +
          '<button class="mini-button edit" type="button" data-edit-peserta="' + escapeAdmin(row.id) + '"><i class="fa-solid fa-pen"></i> Ubah</button>' +
          '<button class="mini-button delete" type="button" data-hapus-peserta="' + escapeAdmin(row.id) + '"><i class="fa-solid fa-trash"></i></button>'
        : '') +
      '</div></td>' +
      '</tr>';
  });
  document.getElementById('participantTable').innerHTML = html + '</tbody></table>';
  document.querySelectorAll('[data-kehadiran-peserta]').forEach(function(button) {
    button.addEventListener('click', function() { ubahKehadiranPeserta_(this.dataset.kehadiranPeserta); });
  });
  document.querySelectorAll('[data-edit-peserta]').forEach(function(button) {
    button.addEventListener('click', function() { editParticipant(this.dataset.editPeserta); });
  });
  document.querySelectorAll('[data-hapus-peserta]').forEach(function(button) {
    button.addEventListener('click', function() { deleteParticipant(this.dataset.hapusPeserta); });
  });
  document.querySelectorAll('[data-naik-peserta]').forEach(function(button) {
    button.addEventListener('click', function() { ubahUrutanPeserta_(this.dataset.naikPeserta, this.dataset.rombelPeserta, 'naik'); });
  });
  document.querySelectorAll('[data-turun-peserta]').forEach(function(button) {
    button.addEventListener('click', function() { ubahUrutanPeserta_(this.dataset.turunPeserta, this.dataset.rombelPeserta, 'turun'); });
  });
}

/**
 * Mencatat kehadiran satu peserta lewat modal ringkas.
 *
 * Terbuka untuk guru mapel maupun proktor karena kehadiran dicatat per ujian
 * oleh guru yang mengawas, sementara identitas peserta tetap terkunci.
 */
/* ==================================================================
 * URUTAN ROMBEL & SISWA (revisi 6) — tombol panah pada kartu rombel
 * dan baris peserta. Hanya admin yang dapat mengubah urutan.
 * ================================================================== */

/** Naik/turunkan posisi satu rombel dalam daftar urutan, lalu simpan. */
async function ubahUrutanRombel_(rombel, arah) {
  var daftar = (ADMIN.rombel || []).map(function(x) { return String(x.rombel || '').trim().toUpperCase(); });
  var idx = daftar.indexOf(String(rombel).trim().toUpperCase());
  if (idx < 0) return;
  var tuju = arah === 'naik' ? idx - 1 : idx + 1;
  if (tuju < 0 || tuju >= daftar.length) return;
  var item = daftar.splice(idx, 1)[0];
  daftar.splice(tuju, 0, item);
  try {
    var result = await adminApi('simpanUrutanRombel', { urutan: daftar });
    if (!guardAdminResult(result)) return;
    showToast(result.message || 'Urutan rombel tersimpan.', 'success');
    await loadParticipants();
  } catch (error) {
    showToast('Urutan rombel gagal disimpan: ' + (error.message || ''), 'error');
  }
}

/** Naik/turunkan posisi satu siswa di dalam rombelnya, lalu simpan. */
async function ubahUrutanPeserta_(idPeserta, rombel, arah) {
  var sasaran = String(rombel || '').trim().toUpperCase();
  var daftar = (ADMIN.participants || []).filter(function(p) {
    return String(p.rombel || '').trim().toUpperCase() === sasaran;
  });
  var idx = -1;
  for (var i = 0; i < daftar.length; i++) {
    if (String(daftar[i].id) === String(idPeserta)) { idx = i; break; }
  }
  if (idx < 0) return;
  var tuju = arah === 'naik' ? idx - 1 : idx + 1;
  if (tuju < 0 || tuju >= daftar.length) return;
  var item = daftar.splice(idx, 1)[0];
  daftar.splice(tuju, 0, item);
  var urutan = daftar.map(function(p) { return String(p.id); });
  try {
    var result = await adminApi('simpanUrutanPeserta', { rombel: rombel, urutan: urutan });
    if (!guardAdminResult(result)) return;
    showToast(result.message || 'Urutan siswa tersimpan.', 'success');
    await loadParticipants();
  } catch (error) {
    showToast('Urutan siswa gagal disimpan: ' + (error.message || ''), 'error');
  }
}

/** Isi dropdown sPesertaDurasi dengan peserta yang sedang ujian aktif. */
async function muatDaftarPesertaDurasi_() {
  var pilih = document.getElementById('sPesertaDurasi');
  if (!pilih) return;
  try {
    var result = await adminApi('getSesiAktif', {});
    if (!guardAdminResult(result)) return;
    var sesi = result.data || [];
    if (!sesi.length) {
      pilih.innerHTML = '<option value="">Tidak ada peserta aktif</option>';
      return;
    }
    pilih.innerHTML = '<option value="">Semua peserta aktif</option>' + sesi.map(function(s) {
      return '<option value="' + escapeAdmin(s.session_id) + '">' +
        escapeAdmin((s.nama || '') + ' (' + (s.kelas || '-') + ') — ' + (s.mapel || '')) + '</option>';
    }).join('');
  } catch (error) {
    pilih.innerHTML = '<option value="">Gagal memuat peserta</option>';
  }
}

/** Terapkan durasi baru realtime: ke semua peserta aktif atau satu peserta. */
async function terapkanDurasiRealtime() {
  var inputMenit = document.getElementById('sDurasiRealtime');
  var menit = inputMenit ? parseInt(inputMenit.value, 10) : NaN;
  if (!menit || menit < 1 || menit > 300) {
    showToast('Isi durasi baru antara 1–300 menit.', 'error');
    return;
  }
  var pilih = document.getElementById('sPesertaDurasi');
  var sessionId = pilih ? pilih.value : '';
  try {
    var result = sessionId
      ? await adminApi('ubahDurasiRealtimePeserta', { durasiMenit: menit, sessionId: sessionId })
      : await adminApi('ubahDurasiRealtime', { durasiMenit: menit });
    if (!guardAdminResult(result)) return;
    showToast(result.message || 'Durasi diperbarui.', 'success');
    if (ADMIN.activeTab === 'monitor') loadMonitor();
    muatDaftarPesertaDurasi_();
  } catch (error) {
    showToast('Gagal mengubah durasi: ' + (error.message || ''), 'error');
  }
}

/** Reset waktu SATU peserta (yang dipilih di dropdown sPesertaDurasi). */
async function resetWaktuSatuPeserta_() {
  var pilih = document.getElementById('sPesertaDurasi');
  var sessionId = pilih ? pilih.value : '';
  if (!sessionId) {
    showToast('Pilih peserta aktif yang waktunya akan di-reset di kolom atas.', 'error');
    return;
  }
  try {
    var result = await adminApi('resetWaktuPeserta', { sessionId: sessionId });
    if (!guardAdminResult(result)) return;
    showToast(result.message || ('Waktu ' + (result.nama || 'peserta') + ' dikembalikan ke ' +
      (result.menit || 0) + ' menit (durasi default).'), 'success');
    if (ADMIN.activeTab === 'monitor') loadMonitor();
  } catch (error) {
    showToast('Gagal reset waktu: ' + (error.message || ''), 'error');
  }
}

/** Reset waktu SEMUA peserta aktif milik akun yang sedang login. */
async function resetWaktuSemuaPeserta_() {
  var setuju = await konfirmasi_(
    'Semua peserta AKTIF milik akun Anda akan dikembalikan ke durasi DEFAULT pengaturan ujian masing-masing.',
    { judul: 'Reset Waktu Semua Peserta', nada: 'danger', teksOk: 'Ya, Reset Semua' });
  if (!setuju) return;
  try {
    var result = await adminApi('resetWaktuSemua', {});
    if (!guardAdminResult(result)) return;
    showToast(result.message || 'Waktu semua peserta di-reset.', 'success');
    if (ADMIN.activeTab === 'monitor') loadMonitor();
  } catch (error) {
    showToast('Gagal reset waktu: ' + (error.message || ''), 'error');
  }
}

function ubahKehadiranPeserta_(id) {
  var peserta = (ADMIN.participants || []).filter(function(item) { return String(item.id) === String(id); })[0];
  if (!peserta) {
    hasilGagal_('Peserta Tidak Ditemukan', 'Data peserta tidak ada pada daftar. Tekan Refresh lalu coba lagi.');
    return;
  }
  document.getElementById('khId').value = peserta.id;
  document.getElementById('khNama').textContent = peserta.nama || '-';
  document.getElementById('khRombel').textContent = peserta.rombel || '-';
  document.getElementById('khStatus').value = String(peserta.kehadiran || 'HADIR').toUpperCase();
  document.getElementById('kehadiranModal').classList.add('show');
}

function tutupKehadiran_() {
  document.getElementById('kehadiranModal').classList.remove('show');
}

async function simpanKehadiran_() {
  if (ADMIN.operationBusy.kehadiran) return;
  ADMIN.operationBusy.kehadiran = true;
  setFormBusy('kehadiranForm', true);
  var status = nilaiInput_('khStatus');
  try {
    var result = await apiWajib_('ubahKehadiranPeserta', {
      id: nilaiInput_('khId'),
      kehadiran: status
    });
    tutupKehadiran_();
    await segarkanSenyap_([loadParticipants]);
    await hasilSukses_('Kehadiran Tercatat', result.message || 'Status kehadiran berhasil diperbarui.', [
      { label: 'Peserta', nilai: result.nama || document.getElementById('khNama').textContent },
      { label: 'Status baru', nilai: labelKehadiranKlien_(result.kehadiran || status) },
      { label: 'Status sebelumnya', nilai: labelKehadiranKlien_(result.kehadiranSebelumnya) },
      { label: 'Dapat masuk ujian', nilai: String(result.kehadiran || status).toUpperCase() === 'HADIR' ? 'Ya' : 'Tidak' }
    ]);
  } catch (error) {
    await hasilGagal_('Kehadiran Gagal Disimpan', error.message || 'Status kehadiran gagal diperbarui.');
  } finally {
    ADMIN.operationBusy.kehadiran = false;
    setFormBusy('kehadiranForm', false);
  }
}

function labelKehadiranKlien_(nilai) {
  return { HADIR: 'Hadir', SAKIT: 'Sakit', IZIN: 'Izin', ALPA: 'Alpa' }[String(nilai || '').toUpperCase()] || '-';
}

async function createParticipant() {
  if (ADMIN.operationBusy.peserta) return;
  ADMIN.operationBusy.peserta = true;
  setFormBusy('participantForm', true);
  try {
    var result = await adminApi('tambahPeserta', {
      nama: document.getElementById('pNama').value,
      username: document.getElementById('pUsername').value,
      rombel: document.getElementById('pRombel').value,
      nis: document.getElementById('pNis').value
    });
    if (!guardAdminResult(result)) throw new Error(result.message || 'Peserta gagal ditambahkan.');
    var namaBaru = document.getElementById('pNama').value;
    var rombelBaru = document.getElementById('pRombel').value;
    document.getElementById('pNama').value = '';
    document.getElementById('pNis').value = '';
    document.getElementById('pUsername').value = '';
    document.getElementById('pUsernamePreview').textContent = 'Huruf kecil, tanpa spasi, tanpa titik (moh.adit tidak diterima).';
    await segarkanSenyap_([loadParticipants]);
    await hasilSukses_('Peserta Ditambahkan', result.message || 'Peserta baru berhasil didaftarkan.', [
      { label: 'Nama', nilai: namaBaru },
      { label: 'Rombel', nilai: rombelBaru }
    ]);
  } catch (error) {
    await hasilGagal_('Peserta Gagal Ditambahkan', error.message || 'Peserta gagal ditambahkan.');
  }
  finally { ADMIN.operationBusy.peserta = false; setFormBusy('participantForm', false); }
}

/**
 * Membuka jendela ubah data peserta.
 *
 * Sebelumnya berupa rangkaian kotak isian beruntun; kini satu formulir agar
 * nama, username, rombel, NIS, dan kehadiran dapat diubah sekaligus.
 */
function editParticipant(id) {
  var peserta = (ADMIN.participants || []).filter(function(item) { return String(item.id) === String(id); })[0];
  if (!peserta) {
    hasilGagal_('Peserta Tidak Ditemukan', 'Data peserta tidak ada pada daftar. Tekan Refresh lalu coba lagi.');
    return;
  }
  document.getElementById('epId').value = peserta.id;
  document.getElementById('epNama').value = peserta.nama || '';
  document.getElementById('epUsername').value = peserta.username || '';
  document.getElementById('epNis').value = peserta.nis || '';
  document.getElementById('epKehadiran').value = String(peserta.kehadiran || 'HADIR').toUpperCase();
  document.getElementById('epAktif').checked = peserta.aktif !== false;

  // Pilihan rombel diambil dari daftar rombel yang terdaftar.
  var pilihan = document.getElementById('epRombel');
  pilihan.innerHTML = (ADMIN.rombel || []).map(function(item) {
    return '<option value="' + escapeAdmin(item.rombel) + '">' + escapeAdmin(item.rombel) + '</option>';
  }).join('');
  if (!pilihan.querySelector('option[value="' + (peserta.rombel || '').replace(/"/g, '') + '"]')) {
    pilihan.insertAdjacentHTML('afterbegin',
      '<option value="' + escapeAdmin(peserta.rombel || '') + '">' + escapeAdmin(peserta.rombel || '-') + '</option>');
  }
  pilihan.value = peserta.rombel || '';
  document.getElementById('editParticipantModal').classList.add('show');
  window.setTimeout(function() { document.getElementById('epNama').focus(); }, 60);
}

function tutupEditPeserta_() {
  document.getElementById('editParticipantModal').classList.remove('show');
}

async function simpanEditPeserta_() {
  if (ADMIN.operationBusy.editPeserta) return;
  var nama = nilaiInput_('epNama').trim();
  var username = nilaiInput_('epUsername').trim();
  if (!nama) { await hasilInfo_('Nama Wajib Diisi', 'Nama lengkap peserta tidak boleh kosong.'); return; }
  if (!username) { await hasilInfo_('Username Wajib Diisi', 'Username peserta tidak boleh kosong.'); return; }

  ADMIN.operationBusy.editPeserta = true;
  setFormBusy('editParticipantForm', true);
  var kehadiran = nilaiInput_('epKehadiran');
  try {
    var result = await apiWajib_('updatePeserta', {
      id: nilaiInput_('epId'),
      nama: nama,
      username: username,
      rombel: nilaiInput_('epRombel'),
      nis: nilaiInput_('epNis'),
      kehadiran: kehadiran,
      aktif: document.getElementById('epAktif').checked
    });
    tutupEditPeserta_();
    await segarkanSenyap_([loadParticipants]);
    await hasilSukses_('Data Peserta Diperbarui', result.message || 'Perubahan data peserta berhasil disimpan.', [
      { label: 'Nama', nilai: nama },
      { label: 'Username', nilai: result.username || username },
      { label: 'Rombel', nilai: nilaiInput_('epRombel') },
      { label: 'Kehadiran', nilai: { HADIR: 'Hadir', SAKIT: 'Sakit', IZIN: 'Izin', ALPA: 'Alpa' }[kehadiran] || kehadiran }
    ]);
  } catch (error) {
    await hasilGagal_('Perubahan Gagal Disimpan', error.message || 'Data peserta gagal diperbarui.');
  } finally {
    ADMIN.operationBusy.editPeserta = false;
    setFormBusy('editParticipantForm', false);
  }
}

async function deleteParticipant(id) {
  var setujuPeserta = await konfirmasi_('Peserta ini akan dihapus dari daftar validasi dan tidak dapat login lagi.',
    { judul: 'Hapus Peserta', nada: 'danger', teksOk: 'Ya, Hapus Peserta' });
  if (!setujuPeserta) return;
  try {
    var peserta = (ADMIN.participants || []).filter(function(item) { return String(item.id) === String(id); })[0];
    var result = await apiWajib_('hapusPeserta', { id: id });
    await segarkanSenyap_([loadParticipants]);
    await hasilSukses_('Peserta Dihapus', result.message || 'Peserta berhasil dihapus dari daftar.',
      peserta ? [ { label: 'Nama', nilai: peserta.nama }, { label: 'Rombel', nilai: peserta.rombel } ] : []);
  } catch (error) {
    await hasilGagal_('Peserta Gagal Dihapus', error.message || 'Peserta gagal dihapus.');
  }
}

async function importPesertaDariFile() {
  var input = document.getElementById('importPesertaFile');
  var file = input.files[0];
  if (!file) {
    setImportMessage_('importPesertaResult', 'Pilih berkas CSV terlebih dahulu.', 'err');
    await hasilInfo_('Berkas Belum Dipilih', 'Pilih berkas CSV hasil template terlebih dahulu, lalu tekan Import Peserta.');
    return;
  }
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    setImportMessage_('importPesertaResult', 'Berkas Excel terdeteksi. Simpan sebagai <b>CSV UTF-8</b> lalu import kembali.', 'err');
    await hasilInfo_('Format Belum Sesuai',
      'Berkas Excel belum dapat dibaca langsung. Simpan sebagai CSV UTF-8 terlebih dahulu.', [
        { label: 'Berkas dipilih', nilai: file.name }
      ]);
    return;
  }
  if (ADMIN.operationBusy.importPeserta) return;
  ADMIN.operationBusy.importPeserta = true;
  setImportMessage_('importPesertaResult', '<i class="fa-solid fa-circle-notch fa-spin"></i> Mengirim data peserta...', 'info');
  try {
    var objects = barisKeObjek_(parseCsv_(await bacaFileTeks_(file)));
    if (!objects.length) throw new Error('Berkas tidak berisi data peserta.');
    var payload = objects.map(function(item) {
      return {
        nama: item.nama || item.nama_lengkap || item.nama_siswa || '',
        rombel: item.rombel || item.kelas || '',
        nis: item.nis || item.nomor_induk || ''
      };
    });
    var result = await adminApi('importPesertaBatch', { rows: payload });
    if (!guardAdminResult(result)) return;
    var pesan = '<i class="fa-solid fa-circle-check"></i> ' + escapeAdmin(result.message || ('Import selesai. ' + (result.berhasil || 0) + ' peserta ditambahkan.'));
    if (result.gagal && result.gagal.length) {
      pesan += '<br><b>Baris dilewati:</b><br>' + result.gagal.slice(0, 15).map(function(item) {
        return '• ' + escapeAdmin(typeof item === 'string' ? item : (item.baris + ': ' + item.alasan));
      }).join('<br>');
    }
    setImportMessage_('importPesertaResult', pesan, result.gagal && result.gagal.length ? 'info' : 'ok');
    input.value = '';
    loadParticipants();
  } catch (error) {
    setImportMessage_('importPesertaResult', '<i class="fa-solid fa-circle-exclamation"></i> ' + escapeAdmin(error.message || 'Import peserta gagal.'), 'err');
  } finally { ADMIN.operationBusy.importPeserta = false; }
}

/* ==================================================================
 * PENILAIAN URAIAN MASSAL
 * ================================================================== */
async function saveAllEssayScores() {
  var rows = Array.prototype.slice.call(document.querySelectorAll('#essayTable tbody tr'));
  var items = [];
  rows.forEach(function(row) {
    var input = row.querySelector('.essay-score');
    var button = row.querySelector('[data-grade-session]');
    if (!input || !button || input.value === '') return;
    items.push({
      sessionId: button.dataset.gradeSession,
      idSoal: button.dataset.gradeQuestion,
      nilai: Number(input.value)
    });
  });
  if (!items.length) {
    await hasilInfo_('Belum Ada Nilai', 'Belum ada nilai uraian yang diisi pada tabel. Isi kolom nilai terlebih dahulu, lalu tekan Simpan Semua Nilai.');
    return;
  }
  var setujuNilai = await konfirmasi_(items.length + ' nilai uraian akan disimpan sekaligus. Status ketuntasan peserta dihitung ulang otomatis.',
    { judul: 'Simpan Semua Nilai', nada: 'warn', teksOk: 'Ya, Simpan Semua' });
  if (!setujuNilai) return;
  if (ADMIN.operationBusy.bulkEssay) return;
  ADMIN.operationBusy.bulkEssay = true;
  try {
    var result = await apiWajib_('nilaiUraianMassal', { items: items });
    ADMIN.essayDrafts = {};
    await segarkanSenyap_([loadEssays, loadResults, loadRecap, loadDashboard]);
    await hasilSukses_('Semua Nilai Tersimpan', result.message || 'Nilai uraian berhasil disimpan.', [
      { label: 'Jumlah nilai', nilai: String(items.length) },
      { label: 'Ketuntasan', nilai: 'Dihitung ulang otomatis' }
    ]);
  } catch (error) {
    await hasilGagal_('Nilai Gagal Disimpan', error.message || 'Nilai uraian gagal disimpan massal.');
  }
  finally { ADMIN.operationBusy.bulkEssay = false; }
}

/* ==================================================================
 * BACKGROUND HALAMAN LOGIN
 * ================================================================== */
function applyBackgroundData_(data) {
  ADMIN.background = data || {};
  renderBackgroundPresets_(ADMIN.background);
  var preview = document.getElementById('bgPreview');
  var css = ADMIN.background.mode === 'gambar' && ADMIN.background.imageDataUri
    ? 'linear-gradient(rgba(8,25,48,.62),rgba(8,25,48,.72)), url(' + ADMIN.background.imageDataUri + ') center/cover no-repeat'
    : (ADMIN.background.presetCss || '');
  preview.innerHTML = '<div style="height:170px;border-radius:10px;background:' + css + '"></div>' +
    '<small class="media-meta">Mode aktif: <b>' + escapeAdmin(ADMIN.background.mode === 'gambar' ? 'Gambar unggahan' : 'Preset ' + (ADMIN.background.preset || '')) + '</b></small>';
  preview.classList.add('show');
  // Terapkan langsung ke halaman login panel agar admin melihat hasil nyata.
  var loginPage = document.getElementById('adminLoginPage');
  if (loginPage && css) loginPage.style.background = css;
}

function renderBackgroundPresets_(data) {
  var container = document.getElementById('bgPresetList');
  var daftar = (data && data.daftarPreset) || [];
  if (!daftar.length) { container.innerHTML = '<div class="empty-state">Preset background belum tersedia.</div>'; return; }
  container.innerHTML = daftar.map(function(item) {
    var aktif = data.mode === 'preset' && data.preset === item.key;
    return '<article class="rombel-card" style="padding:0;overflow:hidden">' +
      '<div style="height:86px;background:' + item.css + '"></div>' +
      '<div style="padding:12px"><h4>' + escapeAdmin(item.nama) + '</h4>' +
      '<p>' + (aktif ? badge('Sedang dipakai', 'green') : badge('Tersedia', 'gray')) + '</p>' +
      '<div class="rombel-actions"><button class="mini-button edit" type="button" data-preset-bg="' + escapeAdmin(item.key) + '"><i class="fa-solid fa-check"></i> Gunakan</button></div>' +
      '</div></article>';
  }).join('');
  container.querySelectorAll('[data-preset-bg]').forEach(function(button) {
    button.addEventListener('click', function() { applyBackgroundPreset(this.dataset.presetBg); });
  });
}

function setBgStatus_(text, tone) {
  var element = document.getElementById('bgStatus');
  element.className = 'media-status show ' + (tone || 'info');
  element.innerHTML = text;
}

async function applyBackgroundPreset(preset) {
  try {
    setBgStatus_('<i class="fa-solid fa-circle-notch fa-spin"></i> Menerapkan preset background...', 'info');
    var result = await adminApi('updateLoginBackground', { mode: 'preset', preset: preset });
    if (!guardAdminResult(result)) return;
    if (!result.success) {
      setBgStatus_(escapeAdmin(result.message || 'Preset gagal diterapkan.'), 'err');
      await hasilGagal_('Background Gagal Diterapkan', result.message || 'Preset gagal diterapkan.');
      return;
    }
    applyBackgroundData_(result.background);
    setBgStatus_('<i class="fa-solid fa-circle-check"></i> ' + escapeAdmin(result.message || 'Background diperbarui.'), 'ok');
    await hasilSukses_('Background Login Diperbarui',
      result.message || 'Preset background baru sudah dipakai halaman login.', [
        { label: 'Sumber', nilai: 'Preset bawaan' },
        { label: 'Berlaku', nilai: 'Login peserta dan panel' }
      ]);
  } catch (error) {
    setBgStatus_('Background gagal diterapkan.', 'err');
    await hasilGagal_('Background Gagal Diterapkan', error.message || 'Background gagal diterapkan.');
  }
}

async function applyBackgroundImage() {
  var file = document.getElementById('bgImageFile').files[0];
  if (!file) {
    setBgStatus_('Pilih berkas gambar terlebih dahulu.', 'err');
    await hasilInfo_('Gambar Belum Dipilih', 'Pilih berkas gambar background terlebih dahulu sebelum menekan Terapkan.');
    return;
  }
  if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.type)) {
    setBgStatus_('Gunakan gambar PNG, JPEG, atau WEBP.', 'err');
    await hasilInfo_('Format Tidak Didukung', 'Gunakan gambar berformat PNG, JPEG, atau WEBP.', [
      { label: 'Berkas dipilih', nilai: file.name }
    ]);
    return;
  }
  if (ADMIN.operationBusy.background) return;
  ADMIN.operationBusy.background = true;
  try {
    setBgStatus_('<i class="fa-solid fa-circle-notch fa-spin"></i> Mengompres dan menyimpan background...', 'info');
    /* [SIADO v5] gambar dikompres (JPEG, lebar maks 1600 px, < 300 KB) lalu diunggah ke bucket
     * "branding" (batas 2 MB). siadoUploadMedia sekaligus menyimpan URL-nya (updateLoginBackground). */
    var dataUri = await kompresBackground_(file);
    var blobBg = await (await fetch(dataUri)).blob();
    var berkasBg = new File([blobBg], 'background-' + Date.now() + '.jpg', { type: 'image/jpeg' });
    var unggah = await window.siadoUploadMedia(berkasBg, { jenis: 'background', adminToken: ADMIN.token });
    if (!unggah || !unggah.success) throw new Error((unggah && unggah.message) || 'Background gagal diunggah.');
    var result = unggah.background ? { success: true, background: unggah.background, message: 'Background login diperbarui.' }
      : await adminApi('updateLoginBackground', { mode: 'gambar', url: unggah.url, fileName: file.name });
    if (!guardAdminResult(result)) return;
    if (!result.success) throw new Error(result.message || 'Background gagal disimpan.');
    applyBackgroundData_(result.background);
    document.getElementById('bgImageFile').value = '';
    setBgStatus_('<i class="fa-solid fa-circle-check"></i> ' + escapeAdmin(result.message || 'Background diterapkan.'), 'ok');
    await hasilSukses_('Background Login Diperbarui',
      result.message || 'Gambar background baru sudah dipakai halaman login.', [
        { label: 'Berkas', nilai: file.name },
        { label: 'Diproses', nilai: 'Dikompres ke lebar maksimum 1600 px' },
        { label: 'Berlaku', nilai: 'Login peserta dan panel' }
      ]);
  } catch (error) {
    setBgStatus_('<i class="fa-solid fa-circle-exclamation"></i> ' + escapeAdmin(error.message || 'Background gagal disimpan.'), 'err');
    await hasilGagal_('Background Gagal Disimpan', error.message || 'Background gagal disimpan.');
  } finally { ADMIN.operationBusy.background = false; }
}

/**
 * Mengecilkan gambar background ke lebar maksimal 1600 px sebelum dikirim,
 * agar tetap tajam tanpa melampaui batas penyimpanan Script Properties.
 */
function kompresBackground_(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() {
      var image = new Image();
      image.onload = function() {
        var maxWidth = 1600;
        var scale = Math.min(1, maxWidth / image.width);
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        var quality = 0.82;
        var output = canvas.toDataURL('image/jpeg', quality);
        while (output.length > 300000 && quality > 0.4) {
          quality -= 0.08;
          output = canvas.toDataURL('image/jpeg', quality);
        }
        if (output.length > 320000) { reject(new Error('Gambar terlalu besar. Gunakan gambar dengan detail lebih sederhana.')); return; }
        resolve(output);
      };
      image.onerror = function() { reject(new Error('Berkas gambar tidak dapat dibaca.')); };
      image.src = reader.result;
    };
    reader.onerror = function() { reject(new Error('Berkas gagal dibaca.')); };
    reader.readAsDataURL(file);
  });
}

async function resetBackgroundImage() {
  var setujuBg = await konfirmasi_('Background halaman login akan dikembalikan ke preset bawaan.',
    { judul: 'Kembalikan Background', nada: 'warn', teksOk: 'Ya, Kembalikan' });
  if (!setujuBg) return;
  try {
    var result = await adminApi('resetLoginBackground', {});
    if (!guardAdminResult(result)) return;
    applyBackgroundData_(result.background);
    setBgStatus_('<i class="fa-solid fa-circle-check"></i> ' + escapeAdmin(result.message || 'Background dikembalikan.'), 'ok');
    await hasilSukses_('Background Dikembalikan',
      result.message || 'Background halaman login kembali memakai preset bawaan.');
  } catch (error) {
    setBgStatus_('Background gagal dikembalikan.', 'err');
    await hasilGagal_('Background Gagal Dikembalikan', error.message || 'Background gagal dikembalikan.');
  }
}

function setFormBusy(formId, busy) {
  var form = document.getElementById(formId);
  if (!form) return;
  form.querySelectorAll('button[type="submit"]').forEach(function(button) {
    button.disabled = !!busy;
  });
  form.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function isAdminSessionInvalidMessage_(message) {
  return /sesi admin|login kembali|tidak valid|telah berakhir/i.test(String(message || ''));
}

function guardAdminResult(result) {
  if (result && result.success) return true;
  var message = (result && result.message) ||
    'Permintaan admin gagal tanpa keterangan. Muat ulang halaman lalu coba lagi.';
  showToast(message, 'error');
  if (isAdminSessionInvalidMessage_(message)) setTimeout(adminLogout, 700);
  return false;
}

/**
 * Menyegarkan tabel setelah simpan/hapus TANPA memunculkan pesan merah.
 *
 * Penyimpanan yang sudah berhasil tidak boleh terlihat gagal hanya karena
 * permintaan penyegaran sesudahnya tersendat; data tetap aman di database.
 */
function segarkanSenyap_(daftarFungsi) {
  return Promise.all(daftarFungsi.map(function(fn) {
    try {
      return Promise.resolve(fn()).catch(function(error) {
        console.warn('Penyegaran tertunda:', error && error.message);
      });
    } catch (error) {
      console.warn('Penyegaran tertunda:', error && error.message);
      return Promise.resolve();
    }
  }));
}
function setAdminLoginMessage(message, type) {
  var element = document.getElementById('adminLoginMessage');
  element.textContent = message || '';
  element.className = 'form-message ' + (type || 'error') + (message ? ' show' : '');
}
/* ==================================================================
 * KARTU SOAL
 * Kisi-kisi butir soal untuk asesmen STS dan SAS. Tipe soal dan kunci
 * jawaban ditarik otomatis dari bank soal sehingga tidak perlu
 * diketik ulang oleh guru.
 * ================================================================== */
var KARTU_SOAL = { data: [], konteks: {}, tipeAwal: '' };

async function loadKartuSoal() {
  if (!ADMIN.token || ADMIN.refreshBusy.kartuSoal) return;
  ADMIN.refreshBusy.kartuSoal = true;
  try {
    var result = await adminApi('getKartuSoal', {});
    if (!guardAdminResult(result)) return;
    if (!result.success) {
      KARTU_SOAL.data = [];
      setKonteksKartuSoal_(result);
      setTableMessage('kartuSoalTable', result.message || 'Kartu Soal belum tersedia.', 'fa-circle-info');
      return;
    }
    KARTU_SOAL.data = result.data || [];
    KARTU_SOAL.konteks = result;
    setKonteksKartuSoal_(result);
    terapkanFilterKartuSoal_();
  } catch (error) {
    setTableMessage('kartuSoalTable', 'Kartu soal gagal dimuat.', 'fa-triangle-exclamation');
  } finally { ADMIN.refreshBusy.kartuSoal = false; }
}

/** Menampilkan ringkasan jenis ujian, mapel, dan kelengkapan kartu soal. */
function setKonteksKartuSoal_(info) {
  var wadah = document.getElementById('kartuSoalKonteks');
  if (!wadah) return;
  if (!info || !info.success) {
    wadah.innerHTML = '<strong>Kartu Soal belum aktif.</strong><br>' +
      escapeAdmin((info && info.message) || 'Ubah Jenis Ujian pada menu Pengaturan ke STS atau SAS.');
    return;
  }
  var lengkap = (KARTU_SOAL.data || []).filter(kartuSoalLengkap_).length;
  var total = (KARTU_SOAL.data || []).length;
  wadah.innerHTML =
    '<strong>' + escapeAdmin(info.labelJenisUjian || 'Kartu Soal') + '</strong> · Mata pelajaran: ' +
    escapeAdmin(info.mapel || 'belum diisi') +
    (info.namaGuru ? ' · Guru: ' + escapeAdmin(info.namaGuru) : '') +
    '<br>' + lengkap + ' dari ' + total + ' butir soal sudah memiliki kartu soal lengkap.';
}

/** Kartu soal dianggap lengkap bila seluruh kolom utama sudah terisi. */
function kartuSoalLengkap_(row) {
  return !!(row.ks_capaian && row.ks_kelas && row.ks_materi &&
    row.ks_kompetensi && row.ks_indikator && row.ks_level_kognitif);
}

/** Menyaring butir kartu soal berdasarkan kata kunci dan kelengkapan. */
function terapkanFilterKartuSoal_() {
  var kueri = kueriFilter_('cariKartuSoal');
  var lengkap = nilaiFilter_('filterKartuLengkap');
  var rows = KARTU_SOAL.data.slice();
  if (lengkap === 'lengkap') rows = rows.filter(kartuSoalLengkap_);
  if (lengkap === 'belum') rows = rows.filter(function(r) { return !kartuSoalLengkap_(r); });
  rows = saringKata_(rows, kueri, function(r) {
    return [r.id_soal, r.pertanyaan, r.tipe, r.ks_materi, r.ks_indikator,
      r.ks_kompetensi, r.ks_capaian, r.ks_kelas, r.ks_level_kognitif].join(' ');
  });
  if (!rows.length && adaFilterAktif_(kueri, lengkap)) {
    tampilTidakDitemukan_('kartuSoalTable', kueri, KARTU_SOAL.data.length + ' butir soal tersedia.');
    return;
  }
  renderKartuSoalTable_(rows);
}

/** Teks pendek di tabel Kartu Soal dipusatkan; deskripsi panjang diratakan kiri-kanan. */
function kelasRataTeksKartuSoal_(nilai) {
  var teks = String(nilai || '').replace(/\s+/g, ' ').trim();
  return teks.length >= 40 ? 'kartu-soal-teks-panjang' : 'kartu-soal-teks-pendek';
}

function renderKartuSoalTable_(rows) {
  if (!rows.length) {
    setTableMessage('kartuSoalTable', 'Belum ada soal pada bank soal. Tambahkan soal terlebih dahulu di menu Kelola Soal.', 'fa-inbox');
    return;
  }
  var html = '<table class="admin-table"><thead><tr><th>No</th><th>Butir Soal</th><th>Tipe</th>' +
    '<th>Kelas</th><th>Materi / Elemen</th><th>Indikator Soal</th><th>Level</th><th>Status</th><th>Aksi</th></tr></thead><tbody>';
  rows.forEach(function(row) {
    var teksPertanyaan = truncate(SRich.stripHtml(row.pertanyaan), 110);
    var teksMateri = row.ks_materi || '-';
    var teksIndikator = truncate(row.ks_indikator || '-', 110);
    html += '<tr><td><strong>' + escapeAdmin(row.ks_nomor_soal || ('#' + row.id_soal)) + '</strong></td>' +
      '<td><div class="cell-wrap kartu-soal-deskripsi ' + kelasRataTeksKartuSoal_(teksPertanyaan) + '">' + escapeAdmin(teksPertanyaan) + '</div></td>' +
      '<td>' + typeBadge(row.tipe) + '</td>' +
      '<td>' + escapeAdmin(row.ks_kelas || '-') + '</td>' +
      '<td><div class="cell-wrap kartu-soal-deskripsi ' + kelasRataTeksKartuSoal_(teksMateri) + '">' + escapeAdmin(teksMateri) + '</div></td>' +
      '<td><div class="cell-wrap kartu-soal-deskripsi ' + kelasRataTeksKartuSoal_(teksIndikator) + '">' + escapeAdmin(teksIndikator) + '</div></td>' +
      '<td>' + (row.ks_level_kognitif ? badge(row.ks_level_kognitif, 'blue') : badge('-', 'gray')) + '</td>' +
      '<td>' + (kartuSoalLengkap_(row) ? badge('Lengkap', 'green') : badge('Belum Lengkap', 'amber')) + '</td>' +
      '<td><div class="row-actions"><button class="mini-button edit" type="button" data-kartu-soal="' +
      escapeAdmin(row.id_soal) + '"><i class="fa-solid fa-pen"></i> Isi Kartu</button></div></td></tr>';
  });
  document.getElementById('kartuSoalTable').innerHTML = html + '</tbody></table>';
  document.querySelectorAll('[data-kartu-soal]').forEach(function(button) {
    button.addEventListener('click', function() { bukaKartuSoal_(this.dataset.kartuSoal); });
  });
}

/** Membuka modal kartu soal dengan tipe dan kunci jawaban terisi otomatis. */
function bukaKartuSoal_(id) {
  var row = KARTU_SOAL.data.filter(function(q) { return String(q.id_soal) === String(id); })[0];
  if (!row) {
    hasilGagal_('Soal Tidak Ditemukan', 'Data soal sudah berubah. Tekan Refresh lalu coba lagi.');
    return;
  }
  document.getElementById('ksIdSoal').value = row.id_soal;
  document.getElementById('ksRingkasSoal').textContent = '#' + row.id_soal + ' — ' + truncate(SRich.stripHtml(row.pertanyaan), 120);
  document.getElementById('ksCapaian').value = row.ks_capaian || '';
  document.getElementById('ksKelas').value = row.ks_kelas || '';
  document.getElementById('ksNomorSoal').value = row.ks_nomor_soal || '';
  document.getElementById('ksMateri').value = row.ks_materi || '';
  document.getElementById('ksKompetensi').value = row.ks_kompetensi || '';
  document.getElementById('ksIndikator').value = row.ks_indikator || '';
  document.getElementById('ksLevel').value = row.ks_level_kognitif || '';
  // Tipe soal dapat diubah dari kartu soal dan ikut memperbarui Kelola Soal.
  var kolomTipe = document.getElementById('ksTipe');
  kolomTipe.value = String(row.tipe || 'PG').toUpperCase();
  KARTU_SOAL.tipeAwal = kolomTipe.value;
  document.getElementById('ksKunci').value = readableKey(row) || '(tanpa kunci baku)';
  document.getElementById('kartuSoalModal').classList.add('show');
}

function tutupKartuSoal_() {
  document.getElementById('kartuSoalModal').classList.remove('show');
}

/** Bersihkan isi editor hanya setelah server berhasil menyimpan. */
function bersihkanKartuSoalForm_() {
  var form = document.getElementById('kartuSoalForm');
  if (form && form.reset) form.reset();
  var id = document.getElementById('ksIdSoal');
  if (id) id.value = '';
  var ringkas = document.getElementById('ksRingkasSoal');
  if (ringkas) ringkas.textContent = '-';
  KARTU_SOAL.tipeAwal = '';
}

async function simpanKartuSoal_(event) {
  if (event && event.preventDefault) event.preventDefault();
  if (ADMIN.operationBusy.kartuSoal) return;
  var id = document.getElementById('ksIdSoal').value;
  // API simpanKartuSoal memakai validator soal umum yang juga mewajibkan
  // field `pertanyaan`. Ambil pertanyaan asli dari bank soal, jangan kirim
  // payload metadata saja (yang akan dianggap sebagai pertanyaan kosong).
  var soalKartu = (KARTU_SOAL.data || []).filter(function(q) {
    return String(q.id_soal) === String(id);
  })[0];
  if (!soalKartu) {
    await hasilInfo_('Butir Soal Tidak Ditemukan',
      'Data soal sudah berubah. Tekan Refresh, lalu buka kembali Kartu Soal.');
    return;
  }
  // Kartu Soal dan bank soal bisa mengembalikan kolom yang berbeda. Gabungkan
  // agar opsi/kunci lama tersedia untuk validator server saat diperlukan.
  var soalBank = (ADMIN.questions || []).concat(DATA_MENTAH.soal || []).filter(function(q) {
    return String(q.id_soal) === String(id);
  })[0] || null;
  var soalAsal = Object.assign({}, soalBank || {}, soalKartu);
  [
    'opsi', 'kunci_jawaban', 'poin', 'mapel', 'tingkat', 'aktif',
    'stimulus_deskripsi', 'stimulus_gambar', 'stimulus_alt',
    'stimulus_video', 'stimulus_video_alt'
  ].forEach(function(kolom) {
    if ((soalAsal[kolom] === undefined || soalAsal[kolom] === null) && soalBank && soalBank[kolom] !== undefined) {
      soalAsal[kolom] = soalBank[kolom];
    }
  });
  var pertanyaanAsal = String(soalAsal.pertanyaan || '');
  if (!pertanyaanAsal.trim()) {
    await hasilInfo_('Pertanyaan Soal Kosong',
      'Pertanyaan pada bank soal ini kosong. Perbaiki dahulu melalui menu Kelola Soal, lalu simpan Kartu Soal kembali.');
    return;
  }
  var tipeDipilih = String(nilaiInput_('ksTipe') || 'PG').toUpperCase();
  var tipeAwal = String(KARTU_SOAL.tipeAwal || '').toUpperCase();
  var tipeBerubah = tipeDipilih !== tipeAwal;
  var opsiAsal = Array.isArray(soalAsal.opsi) ? soalAsal.opsi : null;
  if (!opsiAsal && typeof soalAsal.opsi === 'string') {
    var opsiTerurai = tryJson(soalAsal.opsi, null);
    if (Array.isArray(opsiTerurai)) opsiAsal = opsiTerurai;
  }
  var muatan = {
    id_soal: id,
    pertanyaan: pertanyaanAsal,
    tipe: tipeDipilih,
    ks_capaian: nilaiInput_('ksCapaian').trim(),
    ks_kelas: nilaiInput_('ksKelas').trim(),
    ks_nomor_soal: nilaiInput_('ksNomorSoal').trim(),
    ks_materi: nilaiInput_('ksMateri').trim(),
    ks_kompetensi: nilaiInput_('ksKompetensi').trim(),
    ks_indikator: nilaiInput_('ksIndikator').trim(),
    ks_level_kognitif: nilaiInput_('ksLevel')
  };
  // Bila server memvalidasi ulang soal, teruskan data soal yang sudah ada agar
  // opsi/kunci tidak dianggap kosong saat hanya menyimpan metadata kartu.
  if (Array.isArray(opsiAsal)) muatan.opsi = opsiAsal;
  [
    'poin', 'kunci_jawaban', 'mapel', 'tingkat', 'aktif',
    'stimulus_deskripsi', 'stimulus_gambar', 'stimulus_alt',
    'stimulus_video', 'stimulus_video_alt'
  ].forEach(function(kolom) {
    if (Object.prototype.hasOwnProperty.call(soalAsal, kolom) && soalAsal[kolom] !== undefined) {
      muatan[kolom] = soalAsal[kolom];
    }
  });
  if (!muatan.ks_materi) {
    await hasilInfo_('Materi Belum Diisi', 'Kolom materi atau elemen wajib diisi agar kartu soal dapat dibaca.');
    return;
  }
  if (!muatan.ks_indikator) {
    await hasilInfo_('Indikator Belum Diisi', 'Indikator soal wajib diisi karena menjadi acuan penulisan butir soal.');
    return;
  }

  // Validasi awal agar server tidak menerima soal PG tanpa jumlah opsi yang sah.
  if (tipeDipilih === 'PG' && tipeBerubah) {
    if (!Array.isArray(opsiAsal)) {
      await hasilInfo_('Opsi PG Belum Termuat',
        'Data opsi soal belum termuat. Refresh Kartu Soal, lalu coba lagi. Jika tetap muncul, lengkapi opsi melalui menu Kelola Soal.');
      return;
    }
    if (opsiAsal.length < 2 || opsiAsal.length > 8) {
      await hasilInfo_('Jumlah Opsi PG Tidak Sesuai',
        'Tipe PG harus memiliki 2 sampai 8 opsi. Lengkapi opsi di menu Kelola Soal, simpan soal, lalu ubah tipe di Kartu Soal kembali.');
      return;
    }
  }

  // API server mewajibkan tipe soal pada setiap permintaan simpan. Konfirmasi
  // tambahan hanya ditampilkan bila pengguna benar-benar mengubah tipenya.
  if (tipeBerubah) {
    var lanjut = await konfirmasi_(
      'Tipe soal #' + id + ' akan diubah dari ' + labelTipeSoalResmi_(tipeAwal) +
      ' menjadi ' + labelTipeSoalResmi_(tipeDipilih) + '. Perubahan ini otomatis berlaku juga pada menu Kelola Soal ' +
      'dan hanya berhasil bila opsi serta kunci jawaban yang ada masih sesuai dengan tipe baru.',
      { judul: 'Ubah Tipe Soal?', nada: 'warn', teksOk: 'Ya, Ubah Tipe' });
    if (!lanjut) return;
  }

  ADMIN.operationBusy.kartuSoal = true;
  setFormBusy('kartuSoalForm', true);
  try {
    var result = await apiWajib_('simpanKartuSoal', muatan);
    bersihkanKartuSoalForm_();
    tutupKartuSoal_();
    // Kelola Soal ikut disegarkan agar tipe barunya langsung terlihat.
    await segarkanSenyap_([loadKartuSoal, loadQuestions]);
    await hasilSukses_('Kartu Soal Tersimpan', result.message || 'Kartu soal berhasil disimpan.', [
      { label: 'Butir soal', nilai: '#' + id },
      { label: 'Kelas', nilai: muatan.ks_kelas || 'Belum diisi' },
      { label: 'Tipe soal', nilai: labelTipeSoalResmi_(result.tipe || tipeDipilih || tipeAwal) +
        (result.tipeBerubah ? ' (diperbarui juga di Kelola Soal)' : '') },
      { label: 'Level kognitif', nilai: muatan.ks_level_kognitif || 'Belum ditentukan' }
    ]);
  } catch (error) {
    var pesanSimpan = error.message || 'Kartu soal gagal disimpan.';
    if (/PG harus memiliki 2 sampai 8 opsi/i.test(pesanSimpan)) {
      pesanSimpan = 'Soal PG wajib memiliki 2 sampai 8 opsi. Lengkapi opsi di menu Kelola Soal, simpan soal, lalu coba simpan Kartu Soal kembali.';
    } else if (/tipe soal tidak valid/i.test(pesanSimpan)) {
      pesanSimpan = 'Tipe soal tidak valid. Pilih ulang salah satu tipe pada Kartu Soal. Jika tetap gagal, muat ulang panel agar daftar tipe terbaru diterapkan.';
    }
    await hasilGagal_('Kartu Soal Gagal Disimpan', pesanSimpan);
  } finally {
    ADMIN.operationBusy.kartuSoal = false;
    setFormBusy('kartuSoalForm', false);
  }
}

/* ==================================================================
 * LAPISAN FILTER & PENCARIAN
 * Semua data mentah disimpan di DATA_MENTAH agar pencarian berjalan
 * seketika di sisi klien tanpa memanggil server berulang kali.
 * ================================================================== */
var DATA_MENTAH = {
  soal: [], monitor: [], pelanggaran: [], hasil: [], uraian: [],
  rekap: [], peserta: [], guru: []
};

/** Membaca isi kolom pencarian dengan aman (huruf kecil, tanpa spasi tepi). */
/**
 * Mengikat satu kolom filter ke fungsi penyaring. Kolom teks diberi jeda
 * singkat agar pengetikan tetap ringan, dropdown langsung menyaring.
 */
function ikatFilter_(id, peristiwa, penyaring, pakaiJeda) {
  var el = document.getElementById(id);
  if (!el) return;
  el.addEventListener(peristiwa, pakaiJeda ? debounce(penyaring, 180) : penyaring);
}

function kueriFilter_(id) {
  var el = document.getElementById(id);
  return el ? String(el.value || '').trim().toLowerCase() : '';
}

/** Membaca nilai dropdown filter. */
function nilaiFilter_(id) {
  var el = document.getElementById(id);
  return el ? String(el.value || '') : '';
}

/**
 * Menyaring array berdasarkan kata kunci. `ambilTeks` mengembalikan
 * gabungan teks yang boleh dicari dari satu baris data.
 */
function saringKata_(rows, kueri, ambilTeks) {
  if (!kueri) return rows;
  var kata = kueri.split(/\s+/).filter(Boolean);
  return rows.filter(function(row) {
    var teks = String(ambilTeks(row) || '').toLowerCase();
    return kata.every(function(k) { return teks.indexOf(k) !== -1; });
  });
}

/**
 * Menampilkan pemberitahuan "data tidak ditemukan" pada wadah tabel.
 * Dipakai ketika filter aktif tetapi tidak ada satu pun baris cocok.
 */
function tampilTidakDitemukan_(idWadah, kueri, keterangan) {
  var wadah = document.getElementById(idWadah);
  if (!wadah) return;
  var detail = kueri
    ? 'Tidak ada data yang cocok dengan pencarian "' + escapeAdmin(kueri) + '".'
    : 'Tidak ada data yang cocok dengan filter yang dipilih.';
  wadah.innerHTML =
    '<div class="empty-state"><i class="fa-solid fa-magnifying-glass-minus"></i>' +
    '<strong>Data tidak ditemukan</strong><br>' + detail +
    (keterangan ? '<br><span style="font-size:11px">' + escapeAdmin(keterangan) + '</span>' : '') +
    '<br><span style="font-size:11px">Periksa ejaan atau kosongkan filter untuk melihat seluruh data.</span></div>';
}

/** Benar bila salah satu filter pada panel sedang aktif. */
function adaFilterAktif_() {
  return Array.prototype.slice.call(arguments).some(function(v) { return !!v; });
}

function setTableMessage(id, message, icon) {
  document.getElementById(id).innerHTML = '<div class="empty-state"><i class="fa-solid ' + (icon || 'fa-inbox') + '"></i>' + escapeAdmin(message) + '</div>';
}
function showToast(message, type) {
  var toast = document.createElement('div');
  toast.className = 'toast ' + (type || 'success');
  toast.innerHTML = '<i class="fa-solid ' + (type === 'error' ? 'fa-circle-xmark' : (type === 'info' ? 'fa-circle-info' : 'fa-circle-check')) + '"></i> ' + escapeAdmin(message);
  document.body.appendChild(toast);
  setTimeout(function() { toast.remove(); }, 3600);
}
function badge(text, color) {
  var allowedColors = ['blue', 'green', 'red', 'amber', 'gray'];
  var safeColor = allowedColors.indexOf(color) !== -1 ? color : 'gray';
  return '<span class="badge ' + safeColor + '">' + escapeAdmin(text) + '</span>';
}
function typeBadge(type) {
  var label = { PG: 'PG', PGK: 'PGK Kategori', PGK_MCMA: 'PGK MCMA', MENJODOHKAN: 'MENJODOHKAN',
                ISIAN: 'ISIAN', URAIAN: 'URAIAN' }[type] || type;
  return badge(label, type === 'URAIAN' ? 'amber' : 'blue');
}
function statusBadge(status) {
  var clean = String(status || '-');
  var color = /SELESAI|AKTIF|BENAR|TERSIMPAN/.test(clean) ? 'green' : (/DISKUALIFIKASI|SALAH/.test(clean) ? 'red' : (/JEDA|PENDING|REVIEW|PERINGATAN/.test(clean) ? 'amber' : 'gray'));
  return badge(clean.replace(/_/g, ' '), color);
}
function truncate(value, length) { value = String(value || ''); return value.length > length ? value.slice(0, length) + '…' : value; }
function tryJson(value, fallback) { try { return JSON.parse(value); } catch (error) { return fallback; } }
function numberDisplay(value) { var n = Number(value || 0); return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.00$/, ''); }
function formatSeconds(seconds) { seconds = Math.max(0, Math.floor(Number(seconds || 0))); return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0'); }
function formatDate(value) { if (!value) return '-'; var date = new Date(value); return isNaN(date.getTime()) ? String(value) : date.toLocaleString('id-ID', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' }); }
function escapeAdmin(value) { return String(value === undefined || value === null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
function readFileAsDataUrl(file) { return new Promise(function(resolve, reject) { var reader = new FileReader(); reader.onload = function() { resolve(reader.result); }; reader.onerror = reject; reader.readAsDataURL(file); }); }
function debounce(fn, wait) { var timeout; return function() { var args = arguments; clearTimeout(timeout); timeout = setTimeout(function() { fn.apply(null, args); }, wait); }; }

