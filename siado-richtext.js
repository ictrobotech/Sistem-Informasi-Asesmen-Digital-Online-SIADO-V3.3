/* ================================================================
 * siado-richtext.js — Mesin teks kaya (rich text) SIADO
 *
 * Dipakai BERSAMA oleh panel (admin-script.js) dan halaman peserta
 * (script.js) supaya:
 *   1. Guru dapat menulis pertanyaan dengan huruf tebal, miring,
 *      garis bawah, coret, sub/superskrip, tabel, grafik (SVG),
 *      gambar, dan rumus (LaTeX/KaTeX).
 *   2. Tempelan (paste) dari Word/Google Docs/web dibersihkan
 *      (sanitizer) sehingga pertanyaan & opsi tetap rapi.
 *   3. Tampilan di panel dan di peserta KONSISTEN karena keduanya
 *      merender dengan sanitizer + CSS yang sama.
 *
 * File ini berdiri sendiri (tanpa dependensi). KaTeX bersifat
 * opsional: bila pustaka KaTeX termuat, [data-tex] dirender sebagai
 * rumus; bila tidak, sumber LaTeX ditampilkan apa adanya.
 * ================================================================ */
(function (w) {
  'use strict';

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function decodeEntities(text) {
    return String(text)
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&#0?39;/g, "'")
      .replace(/&#x0?27;/gi, "'").replace(/&#x0?2F;/gi, '/')
      .replace(/&amp;/gi, '&');
  }

  /* ------------------- SANITIZER (allowlist) ------------------- */

  var DROP_WITH_CONTENT = { script: 1, style: 1, iframe: 1, object: 1, embed: 1, applet: 1, form: 1, textarea: 1, select: 1, head: 1, title: 1, noscript: 1, template: 1, frame: 1, frameset: 1, link: 1, meta: 1 };
  var VOID_TAGS = { br: 1, hr: 1, img: 1, input: 0 };
  var BLOCK_TAGS = { p: 1, div: 1, table: 1, ul: 1, ol: 1, li: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, blockquote: 1, pre: 1 };

  // Tag yang diizinkan beserta atribut yang boleh lolos.
  var ALLOWED = {
    p: {}, br: {}, b: {}, strong: {}, i: {}, em: {}, u: {}, s: {}, strike: {}, del: {},
    sub: {}, sup: {}, ul: {}, ol: { start: 1 }, li: {}, blockquote: {}, pre: {}, hr: {},
    table: {}, thead: {}, tbody: {}, tfoot: {}, tr: {}, td: { colspan: 1, rowspan: 1 }, th: { colspan: 1, rowspan: 1 }, caption: {},
    img: { src: 1, alt: 1, width: 1, height: 1 },
    span: { 'class': 1, 'data-tex': 1, 'data-siado-pgk-kategori': 1, hidden: 1 },
    div: { 'data-siado-pgk-kategori': 1, hidden: 1 },
    svg: { xmlns: 1, viewbox: 1, width: 1, height: 1, role: 1, 'aria-label': 1 },
    g: {}, rect: { x: 1, y: 1, width: 1, height: 1, rx: 1, ry: 1, fill: 1, stroke: 1, 'stroke-width': 1 },
    line: { x1: 1, y1: 1, x2: 1, y2: 1, stroke: 1, 'stroke-width': 1, 'stroke-dasharray': 1 },
    polyline: { points: 1, fill: 1, stroke: 1, 'stroke-width': 1 },
    polygon: { points: 1, fill: 1, stroke: 1, 'stroke-width': 1 },
    circle: { cx: 1, cy: 1, r: 1, fill: 1, stroke: 1, 'stroke-width': 1 },
    path: { d: 1, fill: 1, stroke: 1, 'stroke-width': 1 },
    text: { x: 1, y: 1, fill: 1, 'font-size': 1, 'font-weight': 1, 'text-anchor': 1, 'dominant-baseline': 1 }
  };

  function cleanAttrValue(name, raw) {
    var v = decodeEntities(raw);
    if (/^(src)$/.test(name)) {
      if (/^https:\/\/[^\s]+$/i.test(v)) return v;
      if (/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(v)) return v;
      return '';
    }
    if (/^(alt)$/.test(name)) return v.slice(0, 300);
    if (/^(width|height|colspan|rowspan|start|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry)$/.test(name)) {
      return /^-?[\d.]+(%|px|em)?$/.test(v.trim()) ? v.trim() : '';
    }
    if (/^(stroke|fill)$/.test(name)) return /^#([0-9a-f]{3}|[0-9a-f]{6})$|^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$|^(none|transparent)$/i.test(v.trim()) ? v.trim() : '';
    if (/^(stroke-width|font-size)$/.test(name)) return /^\d+(\.\d+)?(px)?$/.test(v.trim()) ? v.trim() : '';
    if (/^(stroke-dasharray)$/.test(name)) return /^[\d.,\s]+$/.test(v) ? v : '';
    if (/^(points)$/.test(name)) return /^[-\d.,\s]+$/.test(v) ? v : '';
    if (/^(d)$/.test(name)) return /^[MmLlHhVvCcSsQqTtAaZz0-9 .,+\-()]+$/.test(v) ? v : '';
    if (/^(class)$/.test(name)) return /\bsiado-tex\b/.test(v) ? 'siado-tex' : '';
    if (/^(data-tex|data-siado-pgk-kategori)$/.test(name)) return v.slice(0, 4000);
    if (/^(xmlns|role|text-anchor|dominant-baseline|font-weight)$/.test(name)) return v.slice(0, 60);
    if (/^(aria-label)$/.test(name)) return v.slice(0, 300);
    if (name === 'hidden') return 'hidden';
    return '';
  }

  function rebuildTag(tagName, attrString) {
    var spec = ALLOWED[tagName];
    if (!spec) return null;
    var out = [];
    var re = /([a-zA-Z][a-zA-Z0-9:_-]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|[^\s>]+))?/g;
    var m;
    while ((m = re.exec(attrString || ''))) {
      var name = m[1].toLowerCase();
      var raw = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : (m[2] || ''));
      if (m[2] === undefined && m[0].indexOf('=') === -1) raw = name === 'hidden' ? 'hidden' : '';
      if (!(name in spec) && name !== 'hidden') continue;
      if (name === 'hidden' && !('hidden' in spec) && tagName !== 'div' && tagName !== 'span') continue;
      var clean = cleanAttrValue(name, raw);
      if (clean === '' && name !== 'hidden') continue;
      out.push(name + '="' + escapeHtml(clean === '' ? name : clean) + '"');
    }
    return '<' + tagName + (out.length ? ' ' + out.join(' ') : '') + '>';
  }

  /**
   * Membersihkan HTML tempelan/isikan menjadi subset aman & rapi.
   * Input tanpa tag diperlakukan sebagai teks biasa (\n -> <br>).
   */
  function sanitizeHtml(input) {
    var s = String(input === undefined || input === null ? '' : input);
    if (!s.trim()) return '';
    if (!/<[a-zA-Z][^>]*>/.test(s)) {
      return escapeHtml(s.replace(/\r\n?/g, '\n').trim()).replace(/\n/g, '<br>');
    }

    var token = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<\?[\s\S]*?\?>|<([/!]?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>|([^<]+)/g;
    var out = [];
    var stack = [];
    var dropDepth = 0;
    var dropName = '';
    var openP = false;
    var m;

    function closeP() { if (openP) { out.push('</p>'); openP = false; } }
    function closeUntil(name) {
      for (var i = stack.length - 1; i >= 0; i--) {
        if (stack[i] === name) {
          while (stack.length > i) {
            var t = stack.pop();
            if (t === 'p') openP = false; else out.push('</' + t + '>');
          }
          return true;
        }
      }
      return false;
    }

    while ((m = token.exec(s))) {
      if (m[0].indexOf('<!--') === 0 || m[0].indexOf('<!') === 0 || m[0].indexOf('<?') === 0) continue;
      if (m[4] !== undefined) {                       // teks
        if (dropDepth) continue;
        var text = decodeEntities(m[4]);
        if (!text.trim() && !out.length) continue;
        out.push(escapeHtml(text));
        continue;
      }
      var isClose = m[1] === '/';
      var name = m[2].toLowerCase();
      var attrs = m[3] || '';

      if (dropDepth) {
        if (name === dropName) dropDepth += isClose ? -1 : 1;
        continue;
      }

      if (DROP_WITH_CONTENT[name] && !isClose) { dropName = name; dropDepth = 1; continue; }
      if (name === 'input' || name === 'button') continue;

      if (isClose) {
        if (name === 'p') { closeP(); continue; }
        if (ALLOWED[name]) closeUntil(name);
        continue;
      }

      // pembuka
      var isVoid = name === 'br' || name === 'hr' || name === 'img';
      var selfClose = /\/\s*$/.test(attrs);

      // normalisasi tag
      var target = name;
      var hasMarker = /data-siado-pgk-kategori/.test(attrs);
      if (/^h[1-6]$/.test(name)) target = 'strong';           // judul -> tebal dalam paragraf
      else if (name === 'div' && hasMarker) target = 'div';   // penanda kategori PGK tetap utuh
      else if (name === 'div' || name === 'figure' || name === 'section' || name === 'article') target = 'p';
      if (name === 'font' || name === 'center' || name === 'a' || name === 'figcaption' || name === 'header' || name === 'footer' || name === 'nav' || name === 'aside' || name === 'main' || name === 'span' && !/siado-tex/.test(attrs) && !/data-siado-pgk-kategori/.test(attrs)) {
        if (name === 'span' && !/siado-tex/.test(attrs) && !/data-siado-pgk-kategori/.test(attrs)) target = null; // span polos dibuka saja (unwrap)
        else target = null;                                    // unwrap: tag dibuang, isi tetap
      }

      if (BLOCK_TAGS[target] || target === 'p') closeP();

      if (target === null) continue;                           // unwrap

      if (target === 'p') {
        out.push('<p>'); openP = true;
        if (isVoid || selfClose) closeP();
        continue;
      }
      if (target === 'strong') {
        if (!openP && !stack.length) { out.push('<p>'); openP = true; }
        out.push('<strong>'); stack.push('strong');
        continue;
      }

      var rebuilt = rebuildTag(target, attrs);
      if (!rebuilt) continue;
      if (target === 'p') { out.push('<p>'); openP = true; continue; }
      if (isVoid || selfClose) { out.push(rebuilt.replace(/>$/, '>')); continue; }
      out.push(rebuilt);
      stack.push(target);
      if (target === 'p') openP = true;
    }
    closeP();
    while (stack.length) out.push('</' + stack.pop() + '>');

    var html = out.join('');
    // kerapian: buang paragraf/list kosong sisa tempelan, rapatkan <br> berlebih
    html = html
      .replace(/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '')
      .replace(/<ul[^>]*>(?:\s|<br\s*\/?>)*<\/ul>/gi, '')
      .replace(/<ol[^>]*>(?:\s|<br\s*\/?>)*<\/ol>/gi, '')
      .replace(/<li>(?:\s|&nbsp;|<br\s*\/?>)*<\/li>/gi, '')
      .replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>')
      .replace(/^\s*(<br\s*\/?>)+/i, '')
      .trim();
    return html;
  }

  /** Teks polos dari HTML (untuk ringkasan/tabel panel). */
  function stripHtml(input) {
    var s = String(input === undefined || input === null ? '' : input);
    if (!/<[a-zA-Z][^>]*>/.test(s)) return decodeEntities(s).trim();
    s = s
      .replace(/<\s*(br|\/p|\/div|\/tr|\/li|\/h[1-6])[^>]*>/gi, '\n')
      .replace(/<td[^>]*>/gi, ' | ')
      .replace(/<th[^>]*>/gi, ' | ')
      .replace(/<[^>]+>/g, '');
    var text = decodeEntities(s).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    return text.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  /** Render aman untuk ditampilkan (sanitize + siap typeset rumus). */
  function renderRich(input) { return sanitizeHtml(input); }

  /* ------------------------- RUMUS ------------------------- */
  function texSpan(latex) {
    var t = String(latex || '').trim();
    return '<span class="siado-tex" data-tex="' + escapeHtml(t) + '">' + escapeHtml(t) + '</span>';
  }

  /** Render semua [data-tex] di dalam root memakai KaTeX bila tersedia. */
  function typesetMath(root) {
    if (!root || !root.querySelectorAll) return;
    var nodes = root.querySelectorAll('[data-tex]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var tex = el.getAttribute('data-tex') || '';
      if (w.katex && w.katex.render) {
        try {
          w.katex.render(tex, el, { throwOnError: false, output: 'html' });
          el.classList.add('siado-tex-rendered');
          continue;
        } catch (e) { /* jatuh ke fallback teks */ }
      }
      el.textContent = tex;
      el.classList.add('siado-tex-fallback');
    }
  }

  /* ------------------------- GRAFIK ------------------------- */
  var CHART_COLORS = ['#1f6feb', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#0d9488', '#ec4899', '#64748b'];

  /** Membangun SVG grafik batang/garis/lingkaran dari data sederhana. */
  function chartSvg(spec) {
    spec = spec || {};
    var jenis = String(spec.jenis || 'batang');
    var judul = String(spec.judul || '').slice(0, 80);
    var labels = (spec.labels || []).map(function (x) { return String(x || '').slice(0, 18); });
    var values = (spec.values || []).map(function (x) { return Number(x) || 0; });
    var n = Math.min(labels.length, values.length);
    if (!n) return '';
    labels = labels.slice(0, n); values = values.slice(0, n);
    var W = 560, H = 300, L = 46, R = 14, T = judul ? 34 : 18, B = 46;
    var max = Math.max.apply(null, values.concat([1]));
    var min = Math.min.apply(null, values.concat([0]));
    if (max === min) max = min + 1;
    var iw = W - L - R, ih = H - T - B;
    var parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + escapeHtml(judul || 'Grafik') + '">');
    parts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="10" fill="#ffffff" stroke="#d7e3ee" stroke-width="1"></rect>');
    if (judul) parts.push('<text x="' + (W / 2) + '" y="21" fill="#163958" font-size="13" font-weight="700" text-anchor="middle">' + escapeHtml(judul) + '</text>');
    // garis sumbu + skala
    var steps = 4;
    for (var g = 0; g <= steps; g++) {
      var vy = T + ih - (ih * g / steps);
      var val = Math.round(min + (max - min) * g / steps);
      parts.push('<line x1="' + L + '" y1="' + vy + '" x2="' + (W - R) + '" y2="' + vy + '" stroke="#e3edf5" stroke-width="1"></line>');
      parts.push('<text x="' + (L - 6) + '" y="' + (vy + 4) + '" fill="#7d91a6" font-size="10" text-anchor="end">' + val + '</text>');
    }
    function yPos(v) { return T + ih - ((v - min) / (max - min)) * ih; }
    var i, cx;
    if (jenis === 'lingkaran') {
      var total = values.reduce(function (a, b) { return a + Math.max(0, b); }, 0) || 1;
      var cx0 = W / 2, cy0 = T + ih / 2, r0 = Math.min(iw, ih) / 2 - 6;
      var a0 = -Math.PI / 2;
      for (i = 0; i < n; i++) {
        var frac = Math.max(0, values[i]) / total;
        var a1 = a0 + frac * Math.PI * 2;
        var x0 = cx0 + r0 * Math.cos(a0), y0 = cy0 + r0 * Math.sin(a0);
        var x1 = cx0 + r0 * Math.cos(a1), y1 = cy0 + r0 * Math.sin(a1);
        var large = (a1 - a0) > Math.PI ? 1 : 0;
        if (frac >= 0.999) {
          parts.push('<circle cx="' + cx0.toFixed(1) + '" cy="' + cy0.toFixed(1) + '" r="' + r0.toFixed(1) + '" fill="' + CHART_COLORS[i % CHART_COLORS.length] + '" stroke="#ffffff" stroke-width="1.5"></circle>');
        } else if (frac > 0) {
          parts.push('<path d="M ' + cx0.toFixed(1) + ' ' + cy0.toFixed(1) + ' L ' + x0.toFixed(1) + ' ' + y0.toFixed(1) + ' A ' + r0.toFixed(1) + ' ' + r0.toFixed(1) + ' 0 ' + large + ' 1 ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' Z" fill="' + CHART_COLORS[i % CHART_COLORS.length] + '" stroke="#ffffff" stroke-width="1.5"></path>');
        }
        a0 = a1;
      }
      // legenda
      for (i = 0; i < n; i++) {
        var ly = T + 8 + i * 16;
        if (ly > H - 10) break;
        parts.push('<rect x="' + (W - R - 150) + '" y="' + (ly - 9) + '" width="10" height="10" rx="2" fill="' + CHART_COLORS[i % CHART_COLORS.length] + '"></rect>');
        parts.push('<text x="' + (W - R - 134) + '" y="' + ly + '" fill="#41597a" font-size="10">' + escapeHtml(labels[i] + ' (' + values[i] + ')') + '</text>');
      }
    } else {
      var slot = iw / n;
      if (jenis === 'garis') {
        var pts = [];
        for (i = 0; i < n; i++) {
          cx = L + slot * (i + 0.5);
          pts.push(cx.toFixed(1) + ',' + yPos(values[i]).toFixed(1));
        }
        parts.push('<polyline points="' + pts.join(' ') + '" fill="none" stroke="#1f6feb" stroke-width="2.5"></polyline>');
        for (i = 0; i < n; i++) {
          cx = L + slot * (i + 0.5);
          parts.push('<circle cx="' + cx.toFixed(1) + '" cy="' + yPos(values[i]).toFixed(1) + '" r="4" fill="#1f6feb" stroke="#ffffff" stroke-width="1.5"></circle>');
        }
      } else {
        var bw = Math.min(58, slot * 0.62);
        for (i = 0; i < n; i++) {
          cx = L + slot * (i + 0.5);
          var by = yPos(Math.max(0, values[i]));
          var bh = Math.max(2, (T + ih) - by);
          parts.push('<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="4" fill="' + CHART_COLORS[i % CHART_COLORS.length] + '"></rect>');
          parts.push('<text x="' + cx.toFixed(1) + '" y="' + (by - 5).toFixed(1) + '" fill="#41597a" font-size="10" font-weight="700" text-anchor="middle">' + values[i] + '</text>');
        }
      }
      for (i = 0; i < n; i++) {
        cx = L + slot * (i + 0.5);
        parts.push('<text x="' + cx.toFixed(1) + '" y="' + (H - B + 16) + '" fill="#41597a" font-size="10" text-anchor="middle">' + escapeHtml(labels[i]) + '</text>');
      }
      parts.push('<line x1="' + L + '" y1="' + (T + ih) + '" x2="' + (W - R) + '" y2="' + (T + ih) + '" stroke="#b9cbdd" stroke-width="1.5"></line>');
    }
    parts.push('</svg>');
    return parts.join('');
  }

  /* --------------- PENANDA KATEGORI PGK (metadata) --------------- */
  /** Menyematkan daftar kategori ke dalam HTML pertanyaan (tersembunyi). */
  function pgkMarkerEmbed(pertanyaanHtml, kategoriList) {
    var base = String(pertanyaanHtml || '').replace(/<div[^>]*data-siado-pgk-kategori[^>]*>\s*<\/div>/gi, '').replace(/<span[^>]*data-siado-pgk-kategori[^>]*>\s*<\/span>/gi, '');
    if (!kategoriList || !kategoriList.length) return base;
    return '<div data-siado-pgk-kategori="' + escapeHtml(kategoriList.join('|')) + '" hidden></div>' + base;
  }
  function pgkMarkerParse(pertanyaanHtml) {
    var m = /data-siado-pgk-kategori="([^"]*)"/i.exec(String(pertanyaanHtml || ''));
    if (!m) return null;
    var list = decodeEntities(m[1]).split('|').map(function (x) { return x.trim(); }).filter(Boolean);
    return list.length >= 2 ? list : null;
  }

  /**
   * Menentukan daftar kategori sebuah soal PGK:
   * 1) penanda tersembunyi di pertanyaan (dibuat editor panel),
   * 2) nilai unik pada kunci jawaban (mis. hasil import CSV),
   * 3) bawaan BENAR/SALAH untuk soal lama.
   */
  function pgkCategories(question) {
    var q = question || {};
    var dariMarker = pgkMarkerParse(q.pertanyaan);
    if (dariMarker) return { kategori: dariMarker, legacy: false };
    var kunci = q.kunci_jawaban;
    if (typeof kunci === 'string') { try { kunci = JSON.parse(kunci); } catch (e) { kunci = null; } }
    var unik = [];
    if (kunci && typeof kunci === 'object' && !Array.isArray(kunci)) {
      Object.keys(kunci).forEach(function (k) {
        var v = String(kunci[k] || '').trim();
        if (v && unik.indexOf(v) === -1) unik.push(v);
      });
    } else if (typeof q.kunci_jawaban === 'string' && q.kunci_jawaban.indexOf(',') !== -1) {
      q.kunci_jawaban.split(',').forEach(function (v) {
        v = String(v || '').trim();
        if (v && unik.indexOf(v) === -1) unik.push(v);
      });
    }
    if (unik.length >= 2) {
      var upper = unik.map(function (x) { return x.toUpperCase(); });
      var isLegacy = upper.length === 2 && upper.indexOf('BENAR') !== -1 && upper.indexOf('SALAH') !== -1;
      return { kategori: unik, legacy: isLegacy };
    }
    return { kategori: ['BENAR', 'SALAH'], legacy: true };
  }

  /* --------- TABEL PGK KATEGORI (format sesuai gambar) ---------
   * Dipakai bersama: pratinjau di panel DAN tampilan peserta,
   * sehingga keduanya selalu konsisten.
   * opts: { kategori:[], statements:[{id,html}], jawaban:{id:nilai},
   *         interaksi:bool, legacy:bool }
   */
  /**
   * Pernyataan PGK adalah satu baris logis; jeda baris sisa tempelan
   * atau ketikan (Enter) disatukan menjadi spasi agar tidak "tersusun"
   * ke bawah di pratinjau maupun di peserta. Format tebal/miring/
   * garis bawah, daftar, gambar, dan rumus tidak diubah.
   */
  function satukanBarisPernyataan(htmlBersih) {
    return String(htmlBersih || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/p>\s*<p>/gi, ' ');
  }
  function pgkTableHtml(opts) {
    opts = opts || {};
    var kategori = opts.kategori || ['BENAR', 'SALAH'];
    var statements = opts.statements || [];
    var jawaban = opts.jawaban || {};
    var interaksi = !!opts.interaksi;
    var html = '<table class="pgk-cat-table"><thead><tr><th class="pgk-cat-nohead" style="width:44px">No.</th><th class="pgk-statement-head">Pernyataan</th>';
    for (var k = 0; k < kategori.length; k++) {
      html += '<th class="pgk-cat-col">' + escapeHtml(kategori[k]) + '</th>';
    }
    html += '</tr></thead><tbody>';
    for (var i = 0; i < statements.length; i++) {
      var st = statements[i];
      var id = String(st.id !== undefined ? st.id : i);
      html += '<tr><td class="pgk-cat-no">' + (i + 1) + '</td><td class="pgk-statement"><div class="rich-content">' + satukanBarisPernyataan(sanitizeHtml(st.html)) + '</div></td>';
      for (var c = 0; c < kategori.length; c++) {
        var nilai = kategori[c];
        var checked = String(jawaban[id] || '') === nilai;
        var labelTampil = nilai === 'BENAR' ? 'Benar' : (nilai === 'SALAH' ? 'Salah' : nilai);
        html += '<td class="pgk-cat-cell">' +
          (interaksi
            ? '<label title="' + escapeHtml(labelTampil) + '"><input type="radio" data-answer-input="true" data-statement="' + escapeHtml(id) + '" name="pgkcat-' + escapeHtml(id) + '" value="' + escapeHtml(nilai) + '"' + (checked ? ' checked' : '') + '><span class="cat-check"><i class="fa-solid fa-check"></i></span></label>'
            : '<span class="cat-check' + (checked ? ' cat-check-on' : '') + '" style="' + (checked ? 'border-color:#15803d;background:#e8f9ee;color:#15803d' : '') + '"><i class="fa-solid fa-check"></i></span>') +
          '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }

  /* ======================= EDITOR (browser) ======================= */
  function mountEditor(host, opts) {
    opts = opts || {};
    host.innerHTML = '';
    host.classList.add('srte');
    var bar = document.createElement('div');
    bar.className = 'srte-bar';
    var area = document.createElement('div');
    area.className = 'srte-area rich-content';
    area.contentEditable = 'true';
    area.setAttribute('data-placeholder', opts.placeholder || 'Tulis di sini...');
    if (opts.maxlength) area.setAttribute('data-maxlength', String(opts.maxlength));

    function cmd(name, value) {
      area.focus();
      try { document.execCommand('styleWithCSS', false, false); } catch (e) {}
      try { document.execCommand(name, false, value || null); } catch (e) {}
      fireChange();
    }
    function insertHtml(html) {
      area.focus();
      try { document.execCommand('insertHTML', false, html); } catch (e) { }
      fireChange();
    }

    var BTNS = [
      ['bold', 'fa-solid fa-bold', 'Tebal'],
      ['italic', 'fa-solid fa-italic', 'Miring'],
      ['underline', 'fa-solid fa-underline', 'Garis bawah'],
      ['strikeThrough', 'fa-solid fa-strikethrough', 'Coret'],
      ['sub', 'fa-solid fa-subscript', 'Subskrip (H2O)'],
      ['sup', 'fa-solid fa-superscript', 'Superskrip (x2)'],
      ['insertUnorderedList', 'fa-solid fa-list-ul', 'Daftar butir'],
      ['insertOrderedList', 'fa-solid fa-list-ol', 'Daftar angka']
    ];
    BTNS.forEach(function (b) {
      if (opts.compact && ['sub', 'sup', 'insertUnorderedList', 'insertOrderedList'].indexOf(b[0]) !== -1) return;
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'srte-btn'; btn.title = b[2];
      btn.innerHTML = '<i class="' + b[1] + '"></i>';
      btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
      btn.addEventListener('click', function () { cmd(b[0]); });
      bar.appendChild(btn);
    });

    function popover(build) {
      var pop = document.createElement('div');
      pop.className = 'srte-pop';
      build(pop);
      bar.appendChild(pop);
      function close() { if (pop.parentNode) pop.parentNode.removeChild(pop); document.removeEventListener('mousedown', outside, true); }
      function outside(e) { if (!pop.contains(e.target)) close(); }
      setTimeout(function () { document.addEventListener('mousedown', outside, true); }, 0);
      pop.close = close;
      return pop;
    }
    function toolBtn(icon, title, fn) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'srte-btn'; btn.title = title;
      btn.innerHTML = '<i class="' + icon + '"></i>';
      btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
      btn.addEventListener('click', fn);
      bar.appendChild(btn);
      return btn;
    }
    function field(labelText, tag, value) {
      var lab = document.createElement('label');
      lab.className = 'srte-field';
      lab.innerHTML = '<span>' + escapeHtml(labelText) + '</span>';
      var el = document.createElement(tag);
      if (value) el.value = value;
      lab.appendChild(el);
      return lab;
    }

    if (!opts.compact) {
      // Tabel
      toolBtn('fa-solid fa-table', 'Sisipkan tabel', function () {
        var pop = popover(function (p) {
          var f1 = field('Baris', 'input', '3');
          f1.querySelector('input').type = 'number'; f1.querySelector('input').min = '1'; f1.querySelector('input').max = '20';
          var f2 = field('Kolom', 'input', '3');
          f2.querySelector('input').type = 'number'; f2.querySelector('input').min = '1'; f2.querySelector('input').max = '10';
          var ok = document.createElement('button'); ok.type = 'button'; ok.className = 'srte-btn srte-ok'; ok.textContent = 'Sisipkan';
          p.appendChild(f1); p.appendChild(f2); p.appendChild(ok);
          ok.addEventListener('click', function () {
            var r = Math.max(1, Math.min(20, parseInt(f1.querySelector('input').value, 10) || 3));
            var c = Math.max(1, Math.min(10, parseInt(f2.querySelector('input').value, 10) || 3));
            var html = '<table><tbody>';
            for (var i = 0; i < r; i++) {
              html += '<tr>';
              for (var j = 0; j < c; j++) html += (i === 0 ? '<th><br></th>' : '<td><br></td>');
              html += '</tr>';
            }
            html += '</tbody></table><p><br></p>';
            insertHtml(html);
            p.close();
          });
        });
      });
      // Grafik
      toolBtn('fa-solid fa-chart-column', 'Sisipkan grafik (batang/garis/lingkaran)', function () {
        var pop = popover(function (p) {
          var f0 = field('Judul grafik', 'input', '');
          var f1 = document.createElement('label'); f1.className = 'srte-field';
          f1.innerHTML = '<span>Jenis</span><select><option value="batang">Batang</option><option value="garis">Garis</option><option value="lingkaran">Lingkaran</option></select>';
          var f2 = field('Label (pisahkan koma)', 'input', 'Q1, Q2, Q3, Q4');
          var f3 = field('Nilai (pisahkan koma)', 'input', '12, 19, 8, 15');
          var ok = document.createElement('button'); ok.type = 'button'; ok.className = 'srte-btn srte-ok'; ok.textContent = 'Sisipkan Grafik';
          [f0, f1, f2, f3, ok].forEach(function (x) { p.appendChild(x); });
          ok.addEventListener('click', function () {
            var svg = chartSvg({
              judul: f0.querySelector('input').value,
              jenis: f1.querySelector('select').value,
              labels: f2.querySelector('input').value.split(','),
              values: f3.querySelector('input').value.split(',')
            });
            if (svg) { insertHtml('<p>' + svg + '</p><p><br></p>'); }
            p.close();
          });
        });
      });
      // Gambar
      toolBtn('fa-regular fa-image', 'Sisipkan gambar dari URL (https)', function () {
        var pop = popover(function (p) {
          var f1 = field('URL gambar (https://...)', 'input', 'https://');
          var f2 = field('Keterangan (alt)', 'input', '');
          var ok = document.createElement('button'); ok.type = 'button'; ok.className = 'srte-btn srte-ok'; ok.textContent = 'Sisipkan';
          [f1, f2, ok].forEach(function (x) { p.appendChild(x); });
          ok.addEventListener('click', function () {
            var url = f1.querySelector('input').value.trim();
            if (!/^https:\/\/\S+$/i.test(url)) { p.close(); return; }
            insertHtml('<p><img src="' + escapeHtml(url) + '" alt="' + escapeHtml(f2.querySelector('input').value || 'Gambar') + '"></p><p><br></p>');
            p.close();
          });
        });
      });
    }
    // Rumus
    toolBtn('fa-solid fa-square-root-variable', 'Sisipkan rumus (LaTeX)', function () {
      var pop = popover(function (p) {
        var f1 = field('LaTeX, contoh: \\frac{a}{b} atau x^2 + y^2 = z^2', 'input', '');
        f1.querySelector('input').style.minWidth = '260px';
        var ok = document.createElement('button'); ok.type = 'button'; ok.className = 'srte-btn srte-ok'; ok.textContent = 'Sisipkan Rumus';
        p.appendChild(f1); p.appendChild(ok);
        ok.addEventListener('click', function () {
          var t = f1.querySelector('input').value.trim();
          if (t) { insertHtml(texSpan(t) + '&nbsp;'); typesetMath(area); }
          p.close();
        });
      });
    });
    // Bersihkan format
    toolBtn('fa-solid fa-wand-magic-sparkles', 'Rapikan tempelan / bersihkan format', function () {
      setHtml(normalizeStyled(getHtml()));
      fireChange();
    });

    host.appendChild(bar);
    host.appendChild(area);

    // Tempel: selalu lewat sanitizer agar rapi & konsisten dengan peserta.
    area.addEventListener('paste', function (e) {
      e.preventDefault();
      var cd = e.clipboardData || window.clipboardData;
      if (!cd) return;
      var html = cd.getData('text/html');
      var text = cd.getData('text/plain');
      var clean = html ? normalizeStyled(sanitizeHtml(html)) : sanitizeHtml(text || '');
      insertHtml(clean);
    });
    area.addEventListener('drop', function (e) { e.preventDefault(); });

    /** span ber-style (hasil Word/GDocs) -> tag semantik agar lolos sanitizer. */
    function normalizeStyled(html) {
      var tmp = document.createElement('div');
      tmp.innerHTML = html;
      var spans = tmp.querySelectorAll('span[style], font');
      for (var i = 0; i < spans.length; i++) {
        var el = spans[i];
        var style = (el.getAttribute('style') || '') + ';' + (el.getAttribute('face') ? '' : '');
        var wrapOpen = '', wrapClose = '';
        if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style) || el.tagName.toLowerCase() === 'b') { wrapOpen += '<b>'; wrapClose = '</b>' + wrapClose; }
        if (/font-style\s*:\s*italic/i.test(style)) { wrapOpen += '<i>'; wrapClose = '</i>' + wrapClose; }
        if (/text-decoration[^;]*underline/i.test(style)) { wrapOpen += '<u>'; wrapClose = '</u>' + wrapClose; }
        if (/text-decoration[^;]*line-through/i.test(style)) { wrapOpen += '<s>'; wrapClose = '</s>' + wrapClose; }
        if (/vertical-align\s*:\s*sub/i.test(style)) { wrapOpen += '<sub>'; wrapClose = '</sub>' + wrapClose; }
        if (/vertical-align\s*:\s*super/i.test(style)) { wrapOpen += '<sup>'; wrapClose = '</sup>' + wrapClose; }
        var frag = document.createElement('span');
        frag.innerHTML = wrapOpen + el.innerHTML + wrapClose;
        el.parentNode.replaceChild(frag, el);
      }
      return tmp.innerHTML;
    }

    function getHtml() { return area.innerHTML; }
    function setHtml(html) { area.innerHTML = sanitizeHtml(html); typesetMath(area); }
    function getText() { return stripHtml(area.innerHTML); }
    function fireChange() { if (opts.onChange) opts.onChange(); }

    area.addEventListener('input', function () {
      var max = opts.maxlength;
      if (max && area.innerHTML.length > max) {
        // batasi pertumbuhan: potong teks berlebih secara halus
        var t = area.innerHTML.slice(0, max);
        area.innerHTML = t;
      }
      fireChange();
    });

    var api = {
      el: area,
      getHtml: function () { return sanitizeHtml(normalizeStyled(area.innerHTML)); },
      setHtml: setHtml,
      setText: function (t) { setHtml(String(t || '')); },
      getText: getText,
      isEmpty: function () { return !stripHtml(area.innerHTML).trim() && !area.querySelector('img,table,svg'); },
      focus: function () { area.focus(); },
      typeset: function () { typesetMath(area); }
    };
    return api;
  }

  var SRich = {
    escapeHtml: escapeHtml,
    sanitizeHtml: sanitizeHtml,
    stripHtml: stripHtml,
    renderRich: renderRich,
    typesetMath: typesetMath,
    texSpan: texSpan,
    chartSvg: chartSvg,
    pgkMarkerEmbed: pgkMarkerEmbed,
    pgkMarkerParse: pgkMarkerParse,
    pgkCategories: pgkCategories,
    pgkTableHtml: pgkTableHtml,
    satukanBarisPernyataan: satukanBarisPernyataan,
    mountEditor: mountEditor
  };
  w.SRich = SRich;
  if (typeof module !== 'undefined' && module.exports) module.exports = SRich;
})(typeof window !== 'undefined' ? window : globalThis);
