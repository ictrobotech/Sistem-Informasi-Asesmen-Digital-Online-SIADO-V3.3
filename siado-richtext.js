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

  // CATATAN: elemen void (meta, link, frame, input, br, ...) TIDAK boleh
  // masuk daftar ini — penutupnya tidak pernah ada, sehingga state "buang
  // sampai </x>" akan menelan seluruh konten setelahnya.
  var DROP_WITH_CONTENT = { script: 1, style: 1, iframe: 1, object: 1, embed: 1, applet: 1, form: 1, textarea: 1, select: 1, head: 1, title: 1, noscript: 1, template: 1, frameset: 1 };
  var VOID_TAGS = { br: 1, hr: 1, img: 1, input: 0 };
  var BLOCK_TAGS = { p: 1, div: 1, table: 1, ul: 1, ol: 1, li: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, blockquote: 1, pre: 1 };

  // Tag yang diizinkan beserta atribut yang boleh lolos.
  var ALLOWED = {
    p: {}, br: {}, b: {}, strong: {}, i: {}, em: {}, u: {}, s: {}, strike: {}, del: {},
    sub: {}, sup: {}, code: {}, ul: {}, ol: { start: 1 }, li: {}, blockquote: {}, pre: {}, hr: {},
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
      // Teks polos: tetap aman (escape), tapi rumus LaTeX yang ditempel
      // dari AI/Word ikut dibungkus [data-tex] agar ter-render rapi.
      return mathifyPlainText(s);
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
      if (name === 'input' || name === 'button' || name === 'link' || name === 'meta' || name === 'frame') continue;

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

  /**
   * Render semua [data-tex] di dalam root memakai KaTeX bila tersedia.
   * Sebelumnya, teks polos yang ternyata memuat LaTeX (mis. soal lama yang
   * diketik $x^2$ atau ditempel dari AI tanpa diproses) otomatis dibungkus
   * menjadi [data-tex] juga, sehingga ter-render tanpa perlu menyimpan ulang.
   */
  function typesetMath(root) {
    if (!root || !root.querySelectorAll) return;
    autoMathTextNodes(root);
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

  /* ------------------- DETEKSI RUMUS DALAM TEKS POLOS -------------------
   *
   * Rumus hasil copy dari AI (ChatGPT, dll) biasanya berupa LaTeX polos:
   *   $...$  $$...$$  \( ... \)  \[ ... \]  \frac{a}{b}  x^2
   * Pendeteksikan segmen-segmen itu agar bisa dibungkus [data-tex] dan
   * ter-render rapi oleh KaTeX. Aturan dibuat konservatif agar teks biasa
   * (mis. "harga $5") tidak berubah menjadi rumus.
   */
  function isMathy(content) {
    var c = String(content == null ? '' : content).trim();
    if (!c) return false;
    if (/^[\\^_{}]/.test(c) === false && /[\\^_{}]/.test(c) === false) {
      // Tanpa balok/skrip/backslash: harus ada operator matematika agar
      // tidak salah mengenali angka atau kata (contoh: "$5", "$abc").
      return /[=+\-×÷≤≥<>√∑∫∂≈≠∞π]/.test(c) || /\d\s*[-+*/÷×]\s*\d/.test(c);
    }
    return true;
  }

  /**
   * Pindai teks dan kembalikan daftar segmen rumus: [{s, e, latex}].
   * s/e = indeks [mulai, akhir) dalam teks; latex = isi rumus tanpa delimiter.
   */
  function detectMathSegments(text) {
    var t = String(text == null ? '' : text);
    var segs = [];
    var n = t.length;
    var i = 0;
    function push(s, e, latex) {
      latex = String(latex || '').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
      if (latex && e > s) segs.push({ s: s, e: e, latex: latex });
    }
    while (i < n) {
      var ch = t.charAt(i);
      var jump = 0; // bila segmen cocok, lanjutkan scan dari indeks ini
      var prev = i > 0 ? t.charAt(i - 1) : '';
      if (ch === '$' && t.charAt(i + 1) === '$') {
        var e1 = t.indexOf('$$', i + 2);
        if (e1 !== -1 && e1 - i <= 600) { push(i, e1 + 2, t.slice(i + 2, e1)); jump = e1 + 2; }
      } else if (ch === '$' && prev !== '\\') {
        var e2 = t.indexOf('$', i + 1);
        var lineEnd = t.indexOf('\n', i);
        var limit = lineEnd === -1 ? n : lineEnd;
        if (e2 !== -1 && e2 < limit && e2 - i <= 300 && isMathy(t.slice(i + 1, e2))) {
          push(i, e2 + 1, t.slice(i + 1, e2)); jump = e2 + 1;
        }
      } else if (ch === '\\' && t.charAt(i + 1) === '[') {
        var e3 = t.indexOf('\\]', i + 2);
        if (e3 !== -1 && e3 - i <= 600) { push(i, e3 + 2, t.slice(i + 2, e3)); jump = e3 + 2; }
      } else if (ch === '\\' && t.charAt(i + 1) === '(') {
        var e4 = t.indexOf('\\)', i + 2);
        if (e4 !== -1 && e4 - i <= 600) { push(i, e4 + 2, t.slice(i + 2, e4)); jump = e4 + 2; }
      } else if (ch === '\\') {
        // Komando LaTeX polos, mis. \frac{a}{b} — wajib punya kurung {...}
        // agar path Windows (C:\Users\file) tidak tersalah kenali.
        var mCmd = /^\\([A-Za-z][A-Za-z]*)/.exec(t.slice(i, i + 40));
        if (mCmd && !/[A-Za-z0-9]/.test(prev)) {
          var j = i + mCmd[0].length;
          var hasBrace = false, depth = 0, k = j, bad = false;
          while (k < n && t.charAt(k) !== '\n') {
            var ck = t.charAt(k);
            if (ck === '{') { depth += 1; hasBrace = true; k += 1; continue; }
            if (ck === '}') { depth -= 1; if (depth < 0) { bad = true; break; } k += 1; continue; }
            if (depth > 0) { k += 1; continue; }
            if (ck === '^' || ck === '_') {
              var nx = t.charAt(k + 1) || '';
              if (nx === '{') {
                var kl = k + 2;
                while (kl < n && t.charAt(kl) !== '}') kl += 1;
                k = kl + 1; hasBrace = true; continue;
              }
              if (/[A-Za-z0-9]/.test(nx)) { k += 2; continue; }
              break;
            }
            if (ck === '\\' && /[A-Za-z]/.test(t.charAt(k + 1) || '')) { k += 1; continue; }
            break;
          }
          if (!bad && hasBrace && k - i <= 500) { push(i, k, t.slice(i, k)); jump = k; }
        }
      } else if (/[A-Za-z0-9)\]]/.test(ch)) {
        // Superskrip/subskrip polos: x^2, a_{ij}, 10^-5 — dasar harus satu
        // token (karakter sebelumnya bukan huruf/angka/./-) agar teks seperti
        // "file_1" atau "v1.2_3" tidak berubah menjadi rumus.
        var nxt = t.charAt(i + 1) || '';
        var prevOK = !prev || !/[A-Za-z0-9.\-]/.test(prev);
        if ((nxt === '^' || nxt === '_') && prevOK) {
          var p = i + 2, end = -1;
          var t2 = t.charAt(p) || '';
          if (t2 === '{') {
            var k2 = p + 1;
            while (k2 < n && t.charAt(k2) !== '}') k2 += 1;
            if (k2 < n) end = k2 + 1;
          } else if (/^[0-9]/.test(t2)) {
            var k3 = p;
            while (k3 < n && /[0-9]/.test(t.charAt(k3))) k3 += 1;
            end = k3;
          } else if (/[A-Za-z]/.test(t2)) {
            end = p + 1;
          }
          if (end > 0 && end - i <= 40) { push(i, end, t.slice(i, end)); jump = end; }
        }
      }
      i = jump ? jump : i + 1;
    }
    return segs;
  }

  /** Konversi markdown ringan (hasil copy dari AI) ke tag yang diizinkan.
   *  Input WAJIB sudah di-escapeHtml — hanya tanda * _ ` yang diproses. */
  function mdInline(s) {
    return String(s == null ? '' : s)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/__([^_]+)__/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
      .replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1<i>$2</i>');
  }

  /**
   * Teks polos -> HTML aman dengan rumus terbungkus [data-tex].
   * Dipakai: path polos renderRich (opsi jawaban, dsb), tempelan tanpa
   * HTML, dan pratinjau. Escape + markdown ringan + auto-rumus.
   */
  function mathifyPlainText(text) {
    var t = String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim();
    if (!t) return '';
    var segs = detectMathSegments(t);
    if (!segs.length) return mdInline(escapeHtml(t)).replace(/\n/g, '<br>');
    var out = [], pos = 0;
    segs.forEach(function (sg) {
      if (sg.s > pos) out.push(mdInline(escapeHtml(t.slice(pos, sg.s))));
      out.push(texSpan(sg.latex));
      pos = sg.e;
    });
    if (pos < t.length) out.push(mdInline(escapeHtml(t.slice(pos))));
    return out.join('').replace(/\n/g, '<br>');
  }

  /** Bungkus segmen LaTeX yang ditemukan di node teks (DOM) menjadi
   *  [data-tex], sehingga soal lama yang menyimpan $x^2$ polos ikut
   *  ter-render. Aman dipanggil berulang: node [data-tex] dilewati. */
  function autoMathTextNodes(root) {
    if (!root || !root.ownerDocument) return;
    var doc = root.ownerDocument;
    if (!doc.createTreeWalker) return;
    var walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */, {
      acceptNode: function (node) {
        var parent = node.parentNode;
        if (!parent) return 2;
        var tag = (parent.nodeName || '').toUpperCase();
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'INPUT') return 2;
        if (parent.hasAttribute && (parent.hasAttribute('data-tex') || parent.hasAttribute('data-math-done'))) return 2;
        var cls = (typeof parent.className === 'string') ? parent.className : '';
        if (cls.indexOf('katex') !== -1) return 2;
        if (!/\\|\$|\^|_/.test(node.nodeValue)) return 2;
        return 1;
      }
    }, false);
    var list = [];
    while (walker.nextNode()) list.push(walker.currentNode);
    list.forEach(function (tn) {
      var text = tn.nodeValue;
      var segs = detectMathSegments(text);
      if (!segs.length) return;
      var frag = doc.createDocumentFragment();
      var pos = 0;
      segs.forEach(function (sg) {
        if (sg.s > pos) frag.appendChild(doc.createTextNode(text.slice(pos, sg.s)));
        var span = doc.createElement('span');
        span.className = 'siado-tex';
        span.setAttribute('data-tex', sg.latex);
        span.textContent = sg.latex;
        frag.appendChild(span);
        pos = sg.e;
      });
      if (pos < text.length) frag.appendChild(doc.createTextNode(text.slice(pos)));
      tn.parentNode.replaceChild(frag, tn);
    });
  }

  /* -------------- EKSTRAKSI RUMUS DARI TEMPATAN (WORD/AI/WEB) --------------
   *
   * Sumber yang didukung:
   *  - Microsoft Word / Google Docs: rumus OMML (m:oMath) di dalam
   *    format text/html clipboard.
   *  - AI & situs web (MathJax v3): mjx-container yang menyimpan sumber
   *    LaTeX pada atribut aria-label.
   *  - Situs web (MathJax v2): <script type="math/tex">.
   *  - MathML: <math> dengan <annotation encoding="...tex"> atau struktur
   *    mfrac/msup/... yang dikonversi langsung.
   *
   * Semua hasilnya diseragamkan menjadi <span class="siado-tex"
   * data-tex="..."> agar sanitizer & KaTeX bisa memprosesnya.
   */
  function hasMathMarkup(html) {
    var s = String(html == null ? '' : html);
    return /m:oMath|m:OMATH|<math[\s>]|mjx-container|<script[^>]*type="[^"]*math/i.test(s);
  }

  function escapeTexChar(ch) {
    if (ch === '{') return '\\{';
    if (ch === '}') return '\\}';
    if (ch === '[') return '\\[';
    if (ch === ']') return '\\]';
    if ('%&#$~_\\^'.indexOf(ch) !== -1) return '\\' + ch;
    return ch;
  }
  function escapeTexPlain(s) {
    return String(s == null ? '' : s).replace(/[\\{}%&#$]/g, function (c) { return '\\' + c; });
  }

  function collectByName(root, name) {
    var out = [];
    (function walk(el) {
      var kids = el.children;
      for (var i = 0; i < kids.length; i++) {
        if ((kids[i].localName || '').toLowerCase() === name) out.push(kids[i]);
        walk(kids[i]);
      }
    })(root);
    return out;
  }
  function allElements(root) {
    var out = [root], kids = root.children;
    for (var i = 0; i < kids.length; i++) out = out.concat(allElements(kids[i]));
    return out;
  }

  /* ------------------- KONVERTER OMML (Word) -> LaTeX ------------------- */
  var OMML_NARY_CMD = {
    '\u2211': '\\sum', '\u220F': '\\prod', '\u222B': '\\int', '\u222C': '\\iint',
    '\u222D': '\\iiint', '\u222E': '\\oint', '\u22C3': '\\bigcup', '\u22C2': '\\bigcap', '\u2210': '\\coprod'
  };
  var OMML_ACC_CMD = {
    '\u02C6': '\\hat', '\u02C7': '\\widehat', '\u00B4': '\\acute', '\u02C9': '\\bar',
    '\u02D8': '\\breve', '\u02D9': '\\dot', '\u02DD': '\\ddot', '\u00A8': '\\ddot',
    '\u02DA': '\\ring', '\u02DC': '\\tilde', '\u02D0': '\\widetilde', '\u2192': '\\vec',
    '\u02D7': '\\check', '\u02DB': '\\ogonek', '\u02D3': '\\hat'
  };
  var OMML_FUNC_PLAIN = { sin: 1, cos: 1, tan: 1, cot: 1, sec: 1, csc: 1, log: 1, ln: 1, min: 1, max: 1, lim: 1, exp: 1, det: 1, arg: 1, gcd: 1, sinh: 1, cosh: 1, tanh: 1, coth: 1, abs: 1 };

  function ommlChild(el, name) {
    var kids = el.children;
    for (var i = 0; i < kids.length; i++) {
      if ((kids[i].localName || '').toLowerCase() === name) return kids[i];
    }
    return null;
  }
  function ommlChildren(el, name) {
    var out = [], kids = el.children;
    for (var i = 0; i < kids.length; i++) {
      if ((kids[i].localName || '').toLowerCase() === name) out.push(kids[i]);
    }
    return out;
  }
  /** Ambil nilai atribut m:val (nilai OMML selalu di atribut m:val). */
  function ommlVal(el) {
    if (!el || !el.getAttribute) return '';
    return el.getAttribute('m:val') || el.getAttribute('val') || '';
  }
  /** Ambil elemen properti OMML (mis. <m:naryPr><m:chr m:val="\u2211"/>). */
  function ommlProp(el, propName) {
    return el ? ommlChild(el, 'm:' + propName) : null;
  }
  /**
   * Perbaikan struktur: pada HTML yang ditulis longgar, tag OMML yang
   * "seharusnya kosong" (<m:deg/>, <m:begChr .../>, <m:radPr/>) tidak
   * benar-benar menutup (parser HTML mengabaikan "/>" pada elemen asing),
   * sehingga menelan saudara kandungnya. Elemen yang seharusnya di luar
   * dipindahkan kembali agar konversi tetap benar.
   */
  function repairOmmlPr(root) {
    var LEAF_CONTENT = { 'm:deg': 1, 'm:sub': 1, 'm:sup': 1, 'm:num': 1, 'm:den': 1, 'm:fname': 1, 'm:lim': 1 };
    var LEAF_PROP = { 'm:chr': 1, 'm:begchr': 1, 'm:endchr': 1, 'm:pos': 1, 'm:deghide': 1, 'm:subhide': 1, 'm:suphide': 1, 'm:lit': 1, 'm:sty': 1, 'm:scr': 1, 'm:sz': 1, 'm:type': 1, 'm:base': 1, 'm:brk': 1 };
    var list = [];
    allElements(root).forEach(function (el) {
      var n = (el.localName || '').toLowerCase();
      if (n.indexOf('m:') !== 0) return;
      var isPr = n.length > 4 && n.slice(-2) === 'pr' && n !== 'm:ctrlpr';
      if (isPr || LEAF_CONTENT[n] || LEAF_PROP[n]) list.push(el);
    });
    list.forEach(function (box) {
      var n = (box.localName || '').toLowerCase();
      var isProp = !!LEAF_PROP[n];
      var isContent = !!LEAF_CONTENT[n];
      var moved = [];
      for (var i = 0; i < box.children.length; i++) {
        var kn = (box.children[i].localName || '').toLowerCase();
        var asing;
        if (isProp) asing = true; // elemen properti tak memiliki anak
        else if (isContent) asing = !(kn === 'm:r' || kn === 'm:t'); // wadah isi: hanya run teks yang sah
        else asing = !LEAF_PROP[kn] && kn !== 'm:bdr' && kn !== 'm:ctrlpr'; // elemen Pr: hanya properti yang sah
        if (asing) moved.push(box.children[i]);
      }
      moved.forEach(function (kid) {
        if (box.parentNode && box.parentNode !== kid) box.parentNode.insertBefore(kid, box.nextSibling);
      });
    });
  }
  function ommlRunText(el) {
    return collectByName(el, 'm:t').map(function (t) { return t.textContent || ''; }).join('');
  }
  function ommlSeq(el) {
    var out = '', kids = el.children;
    for (var i = 0; i < kids.length; i++) out += ommlLatex(kids[i]);
    return out;
  }
  function ommlClean(s) {
    return String(s == null ? '' : s)
      .replace(/\u200b/g, '')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }
  function ommlLatex(el) {
    var name = (el.localName || '').toLowerCase();
    switch (name) {
      case 'm:omathpara': {
        var maths = ommlChildren(el, 'm:omath');
        return maths.length ? maths.map(ommlLatex).join(' ') : ommlSeq(el);
      }
      case 'm:omath': return ommlSeq(el);
      case 'm:r': return ommlRunText(el);
      case 'm:t': return el.textContent || '';
      case 'm:f': {
        var num = ommlChild(el, 'm:num'), den = ommlChild(el, 'm:den');
        return '\\frac{' + (num ? ommlLatex(num) : '') + '}{' + (den ? ommlLatex(den) : '') + '}';
      }
      case 'm:ssub': {
        var b1 = ommlChild(el, 'm:e'), s1 = ommlChild(el, 'm:sub');
        return (b1 ? ommlLatex(b1) : '') + '_{' + (s1 ? ommlLatex(s1) : '') + '}';
      }
      case 'm:ssup': {
        var b2 = ommlChild(el, 'm:e'), s2 = ommlChild(el, 'm:sup');
        return (b2 ? ommlLatex(b2) : '') + '^{' + (s2 ? ommlLatex(s2) : '') + '}';
      }
      case 'm:ssubsup': {
        var b3 = ommlChild(el, 'm:e'), s3 = ommlChild(el, 'm:sub'), s4 = ommlChild(el, 'm:sup');
        return (b3 ? ommlLatex(b3) : '') + '_{' + (s3 ? ommlLatex(s3) : '') + '}^{' + (s4 ? ommlLatex(s4) : '') + '}';
      }
      case 'm:rad': {
        var deg = ommlChild(el, 'm:deg'), e1 = ommlChild(el, 'm:e');
        var radPr = ommlChild(el, 'm:radpr');
        var degHide = ommlVal(ommlProp(radPr, 'deghide'));
        var degTxt = deg ? ommlClean(ommlLatex(deg)) : '';
        if (degTxt && degHide !== '1') {
          return '\\sqrt[' + degTxt + ']{' + (e1 ? ommlLatex(e1) : '') + '}';
        }
        return '\\sqrt{' + (e1 ? ommlLatex(e1) : '') + '}';
      }
      case 'm:d': {
        var dpr = ommlChild(el, 'm:dpr');
        var begC = '(', endC = ')';
        if (dpr) {
          var begEl = ommlProp(dpr, 'begchr'), endEl = ommlProp(dpr, 'endchr');
          if (begEl) begC = ommlVal(begEl);
          if (endEl) endC = ommlVal(endEl);
        }
        var de = ommlChild(el, 'm:e');
        return escapeTexChar(begC) + (de ? ommlLatex(de) : '') + escapeTexChar(endC);
      }
      case 'm:nary': {
        var npr = ommlChild(el, 'm:narypr');
        var chr = ommlVal(ommlProp(npr, 'chr'));
        var cmd = OMML_NARY_CMD[chr] || (chr ? escapeTexChar(chr) : '\\int');
        var sub = ommlChild(el, 'm:sub'), sup = ommlChild(el, 'm:sup');
        var out = cmd;
        if (sub && ommlVal(ommlProp(npr, 'subhide')) !== '1') out += '_{' + ommlLatex(sub) + '}';
        if (sup && ommlVal(ommlProp(npr, 'suphide')) !== '1') out += '^{' + ommlLatex(sup) + '}';
        var ne = ommlChild(el, 'm:e');
        return out + '{' + (ne ? ommlLatex(ne) : '') + '}';
      }
      case 'm:func': {
        var fnEl = ommlChild(el, 'm:fname'), fe = ommlChild(el, 'm:e');
        var fnTxt = fnEl ? ommlClean(ommlLatex(fnEl)) : '';
        var fnCmd = OMML_FUNC_PLAIN[fnTxt] ? '\\' + fnTxt
          : (/^[A-Za-z][A-Za-z ]*$/.test(fnTxt) ? '\\mathrm{' + fnTxt + '}' : fnTxt);
        return fnCmd + '\\left(' + (fe ? ommlLatex(fe) : '') + '\\right)';
      }
      case 'm:m': {
        var rows = ommlChildren(el, 'm:e');
        var body = rows.map(function (row) {
          return ommlChildren(row, 'm:e').map(ommlLatex).join(' & ');
        }).join(' \\\\ ');
        return '\\begin{matrix} ' + body + ' \\end{matrix}';
      }
      case 'm:eqArr': {
        var rows2 = ommlChildren(el, 'm:e');
        return rows2.map(function (row) { return ommlLatex(row); }).join(' \\\\ ');
      }
      case 'm:acc': {
        var apr = ommlChild(el, 'm:accpr');
        var ach = ommlVal(ommlProp(apr, 'chr'));
        var ae = ommlChild(el, 'm:e');
        if (OMML_ACC_CMD[ach]) return OMML_ACC_CMD[ach] + '{' + (ae ? ommlLatex(ae) : '') + '}';
        if (ach) return '\\stackrel{' + escapeTexChar(ach) + '}{' + (ae ? ommlLatex(ae) : '') + '}';
        return '\\hat{' + (ae ? ommlLatex(ae) : '') + '}';
      }
      case 'm:bar': {
        var bpr = ommlChild(el, 'm:barpr');
        var pos = ommlVal(ommlProp(bpr, 'pos')) || 'top';
        var be = ommlChild(el, 'm:e');
        return (pos === 'bottom' ? '\\underline{' : '\\overline{') + (be ? ommlLatex(be) : '') + '}';
      }
      case 'm:limLow': {
        var ll = ommlChild(el, 'm:lim'), le = ommlChild(el, 'm:e');
        return '\\underset{' + (ll ? ommlLatex(ll) : '') + '}{' + (le ? ommlLatex(le) : '') + '}';
      }
      case 'm:limUpp': {
        var lu = ommlChild(el, 'm:lim'), ue = ommlChild(el, 'm:e');
        return '\\overset{' + (lu ? ommlLatex(lu) : '') + '}{' + (ue ? ommlLatex(ue) : '') + '}';
      }
      case 'm:box': case 'm:phant': case 'm:nor': case 'm:num': case 'm:deg':
      case 'm:sub': case 'm:sup': case 'm:lim': case 'm:e':
        return ommlSeq(el);
      case 'm:dpr': case 'm:rpr': case 'm:fpr': case 'm:narypr': case 'm:radpr':
      case 'm:sSubPr': case 'm:sSupPr': case 'm:sSubSupPr': case 'm:funcPr':
      case 'm:mpr': case 'm:eqarrpr': case 'm:accpr': case 'm:barpr':
      case 'm:limlowpr': case 'm:limuppr': case 'm:boxpr': case 'm:phantpr':
      case 'm:groupchrpr': case 'm:ctrlpr': case 'm:bdr':
        return '';
      default:
        return ommlSeq(el);
    }
  }

  /* ------------------- KONVERTER MathML -> LaTeX ------------------- */
  var MATHML_ELEMS = { mi: 1, mn: 1, mo: 1, mtext: 1, mfrac: 1, msub: 1, msup: 1, msubsup: 1, msqrt: 1, mroot: 1, mrow: 1, mtable: 1, mtr: 1, mtd: 1, mover: 1, munder: 1, munderover: 1, mfenced: 1, mspace: 1, semantics: 1, annotation: 1, mphantom: 1, mstyle: 1, maction: 1 };
  function mathmlKids(el) {
    var out = [], kids = el.children;
    for (var i = 0; i < kids.length; i++) {
      var kn = (kids[i].localName || '').toLowerCase();
      if (kn && MATHML_ELEMS[kn]) out.push(kids[i]);
    }
    return out;
  }
  function mathmlLatex(el) {
    var name = (el.localName || '').toLowerCase();
    var k = mathmlKids(el);
    function L(x) { return x ? mathmlLatex(x) : ''; }
    switch (name) {
      case 'mfrac': return '\\frac{' + L(k[0]) + '}{' + L(k[1] || k[0]) + '}';
      case 'msub': return L(k[0]) + '_{' + L(k[1] || k[0]) + '}';
      case 'msup': return L(k[0]) + '^{' + L(k[1] || k[0]) + '}';
      case 'msubsup': return L(k[0]) + '_{' + L(k[1] || k[0]) + '}^{' + L(k[2] || k[0]) + '}';
      case 'msqrt': return '\\sqrt{' + L(k[0]) + '}';
      case 'mroot': return '\\sqrt[' + L(k[1] || k[0]) + ']{' + L(k[0]) + '}';
      case 'mover': {
        var over = k[k.length - 1], mainO = k[0];
        return ((over.localName || '').toLowerCase() === 'mo' ? '\\overset{' + escapeTexPlain((over.textContent || '').trim()) + '}' : '\\overset{' + L(over) + '}') + '{' + L(mainO) + '}';
      }
      case 'munder': {
        var under = k[k.length - 1], mainU = k[0];
        return ((under.localName || '').toLowerCase() === 'mo' ? '\\underset{' + escapeTexPlain((under.textContent || '').trim()) + '}' : '\\underset{' + L(under) + '}') + '{' + L(mainU) + '}';
      }
      case 'munderover':
        return '\\underset{' + L(k[1] || k[0]) + '}^{' + L(k[2] || k[1] || k[0]) + '}{' + L(k[0]) + '}';
      case 'mtable': {
        var rows = [];
        var trs = el.children;
        for (var i = 0; i < trs.length; i++) {
          if ((trs[i].localName || '').toLowerCase() !== 'mtr') continue;
          var cells = [];
          for (var j = 0; j < trs[i].children.length; j++) {
            var c = trs[i].children[j];
            if ((c.localName || '').toLowerCase() === 'mtd') cells.push(mathmlLatex(c));
          }
          rows.push(cells.join(' & '));
        }
        return rows.length ? '\\begin{matrix} ' + rows.join(' \\\\ ') + ' \\end{matrix}' : (el.textContent || '');
      }
      case 'mfenced': return '(' + k.map(L).join('') + ')';
      case 'mspace': return ' ';
      case 'mtext': return '\\text{' + String(el.textContent || '').trim() + '}';
      case 'mo': return escapeTexPlain((el.textContent || '').trim());
      case 'mi': case 'mn': return String(el.textContent || '').trim();
      case 'annotation': return String(el.textContent || '');
      case 'math': case 'mrow': case 'semantics': case 'mphantom': case 'mstyle': case 'maction':
        return k.length ? k.map(L).join('') : String(el.textContent || '').trim();
      default: return String(el.textContent || '').trim();
    }
  }

  /**
   * Ganti semua node rumus di dalam HTML tempelan (OMML/MathJax/MathML)
   * dengan [data-tex]. Mengembalikan {html, mathCount}.
   */
  function mathifyHtml(html) {
    var s = String(html == null ? '' : html);
    if (!s || typeof document === 'undefined') return { html: s, mathCount: 0 };
    var tmp = document.createElement('div');
    tmp.innerHTML = s;
    repairOmmlPr(tmp);
    var count = 0;
    function toTex(node, latex) {
      var span = document.createElement('span');
      span.className = 'siado-tex';
      span.setAttribute('data-tex', latex);
      span.textContent = latex;
      if (node.parentNode) node.parentNode.replaceChild(span, node);
      count += 1;
    }
    // 1) OMML (Word) — hanya node terluar agar tidak dobel
    collectByName(tmp, 'm:omathpara').concat(collectByName(tmp, 'm:omath')).forEach(function (node) {
      if (!node.parentNode) return;
      var anc = node.parentNode;
      while (anc && anc !== tmp) {
        var an = (anc.localName || '').toLowerCase();
        if (an === 'm:omath' || an === 'm:omathpara') return;
        anc = anc.parentNode;
      }
      var latex = ommlClean(ommlLatex(node));
      if (latex) toTex(node, latex);
    });
    // 2) MathJax v3 (AI/web): sumber LaTeX ada di aria-label
    allElements(tmp).forEach(function (el) {
      if ((el.localName || '').toLowerCase() !== 'mjx-container') return;
      var label = ommlClean(el.getAttribute('aria-label') || '');
      if (label && (label.indexOf('\\') !== -1 || isMathy(label) || /^[0-9]+(\.[0-9]+)?$/.test(label))) toTex(el, label);
    });
    // 3) MathML: annotation LaTeX lebih diutamakan
    allElements(tmp).forEach(function (el) {
      if ((el.localName || '').toLowerCase() !== 'math') return;
      var tex = '';
      var anns = collectByName(el, 'annotation');
      for (var i = 0; i < anns.length && !tex; i++) {
        var enc = (anns[i].getAttribute('encoding') || '').toLowerCase();
        if (enc.indexOf('tex') !== -1) tex = anns[i].textContent || '';
      }
      if (!tex) tex = mathmlLatex(el);
      tex = ommlClean(tex);
      if (tex) toTex(el, tex);
    });
    // 4) MathJax v2: <script type="math/tex">...</script>
    allElements(tmp).forEach(function (el) {
      if ((el.localName || '').toLowerCase() !== 'script') return;
      var type = (el.getAttribute('type') || '').toLowerCase();
      if (type.indexOf('math') === -1) return;
      var src = (el.textContent || '').trim().replace(/^\$\$?|\$\$?$/g, '').trim();
      if (src) toTex(el, src);
    });
    return { html: tmp.innerHTML, mathCount: count };
  }

  /**
   * HTML tempelan (Word/Google Docs) -> teks polos rapi per baris, dengan
   * rumus ditulis $latex$ sehingga kolom teks (opsi/kunci) tetap bisa
   * menyimpannya dan renderRich ikut merendernya.
   */
  function ommlToPlainText(html) {
    var s = String(html == null ? '' : html);
    if (!s || typeof document === 'undefined') return '';
    var tmp = document.createElement('div');
    tmp.innerHTML = s;
    repairOmmlPr(tmp);
    // rumus -> $...$
    collectByName(tmp, 'm:omathpara').concat(collectByName(tmp, 'm:omath')).forEach(function (node) {
      if (!node.parentNode) return;
      var anc = node.parentNode;
      while (anc && anc !== tmp) {
        var an = (anc.localName || '').toLowerCase();
        if (an === 'm:omath' || an === 'm:omathpara') return;
        anc = anc.parentNode;
      }
      var latex = ommlClean(ommlLatex(node));
      if (latex) {
        var tx = document.createTextNode('$' + latex + '$');
        node.parentNode.replaceChild(tx, node);
      }
    });
    allElements(tmp).forEach(function (el) {
      if ((el.localName || '').toLowerCase() !== 'mjx-container') return;
      var label = ommlClean(el.getAttribute('aria-label') || '');
      if (label) el.parentNode.replaceChild(document.createTextNode('$' + label + '$'), el);
    });
    allElements(tmp).forEach(function (el) {
      if ((el.localName || '').toLowerCase() !== 'math') return;
      var tex = '';
      var anns = collectByName(el, 'annotation');
      for (var i = 0; i < anns.length && !tex; i++) {
        if ((anns[i].getAttribute('encoding') || '').toLowerCase().indexOf('tex') !== -1) tex = anns[i].textContent || '';
      }
      if (!tex) tex = ommlClean(mathmlLatex(el));
      if (tex) el.parentNode.replaceChild(document.createTextNode('$' + tex + '$'), el);
    });
    // baca ulang struktur menjadi teks: elemen blok -> baris baru,
    // sel tabel -> spasi (isi semua TETAP DIPERTAHANKAN)
    var BLOCKS = { p: 1, li: 1, tr: 1, table: 1, ul: 1, ol: 1, blockquote: 1, pre: 1, section: 1, article: 1, header: 1, footer: 1, figure: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1 };
    var textOut = [];
    (function walk(node) {
      if (node.nodeType === 3) { textOut.push(node.nodeValue || ''); return; }
      if (node.nodeType !== 1) return;
      var tag = (node.localName || '').toLowerCase();
      if (tag === 'br') { textOut.push('\n'); return; }
      if (tag === 'td' || tag === 'th') {
        textOut.push(' ');
        for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
        textOut.push(' ');
        return;
      }
      if (BLOCKS[tag]) {
        textOut.push('\n');
        for (var j = 0; j < node.childNodes.length; j++) walk(node.childNodes[j]);
        textOut.push('\n');
      } else {
        for (var k = 0; k < node.childNodes.length; k++) walk(node.childNodes[k]);
      }
    })(tmp);
    var lines = textOut.join('')
      .split(/\n/)
      .map(function (line) {
        return line.replace(/[\u00a0\u200b\u2007]/g, ' ').replace(/[ \t]+/g, ' ').trim();
      })
      .filter(Boolean);
    return lines.join('\n');
  }

  /**
   * Penanganan tempelan untuk KOLOM TEKS (textarea opsi/kunci):
   * mengembalikan {text, changed}. changed=true bila teks perlu diganti
   * (ada rumus Word/AI yang berhasil dikonversi ke bentuk $...$).
   */
  function plainFieldPaste(html, text) {
    var plain = String(text == null ? '' : text);
    var converted = null;
    if (html && hasMathMarkup(html)) {
      var t = ommlToPlainText(html);
      if (t) converted = t;
    }
    if (converted == null) {
      var segs = detectMathSegments(plain);
      if (segs.length) {
        var pos = 0, parts = [];
        segs.forEach(function (sg) {
          parts.push(plain.slice(pos, sg.s));
          parts.push('$' + sg.latex + '$');
          pos = sg.e;
        });
        parts.push(plain.slice(pos));
        converted = parts.join('');
      } else if (/\$\$/.test(plain)) {
        converted = plain.replace(/\$\$([\s\S]+?)\$\$/g, function (all, inner) {
          return '$' + inner.replace(/\s*\n\s*/g, ' ').trim() + '$';
        });
      }
    }
    var changed = converted != null && converted !== plain;
    return { text: changed ? converted : plain, changed: changed };
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
    /* MOBILE 2026-09-22: bungkus scroll horizontal agar tabel PGK multi-kategori tidak jebol di layar HP */
    return '<div class="pgk-cat-scroll">' + html + '</div>';
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
    // Rumus (dengan pratinjau langsung; copy-paste dari Word/AI langsung
    // boleh ditempel ke kotak ini — sumber LaTeX diambil otomatis)
    toolBtn('fa-solid fa-square-root-variable', 'Sisipkan rumus (LaTeX) — boleh copy-paste langsung dari Word/AI', function () {
      var pop = popover(function (p) {
        var f1 = document.createElement('label');
        f1.className = 'srte-field';
        f1.innerHTML = '<span>LaTeX, contoh: \\frac{a}{b} atau x^2 + y^2 = z^2</span>';
        var ta = document.createElement('textarea');
        ta.className = 'srte-field srte-tex-input';
        ta.rows = 3;
        ta.placeholder = '\\frac{a}{b}   atau   x^2 + y^2 = z^2';
        f1.appendChild(ta);
        var prev = document.createElement('div');
        prev.className = 'srte-tex-preview';
        p.appendChild(f1); p.appendChild(prev);
        var ok = document.createElement('button'); ok.type = 'button'; ok.className = 'srte-btn srte-ok'; ok.textContent = 'Sisipkan Rumus';
        p.appendChild(ok);
        function bersihkanTex(t) {
          return String(t || '').replace(/^\s*\$\$?|\$\$?\s*$/g, '').trim();
        }
        function perbaruiPratinjau() {
          var t = bersihkanTex(ta.value);
          if (!t) { prev.innerHTML = '<span class="srte-tex-cap">Pratinjau:</span> <span class="srte-tex-dim">ketik atau tempel rumus…</span>'; return; }
          if (w.katex && w.katex.render) {
            var body = document.createElement('span');
            body.className = 'srte-tex-body';
            try { w.katex.render(t, body, { throwOnError: false, output: 'html' }); }
            catch (e) { body.textContent = t; }
            prev.innerHTML = '<span class="srte-tex-cap">Pratinjau:</span> ';
            prev.appendChild(body);
            return;
          }
          prev.innerHTML = '<span class="srte-tex-cap">Pratinjau (KaTeX belum termuat):</span> ' + escapeHtml(t);
        }
        ta.addEventListener('input', perbaruiPratinjau);
        ta.addEventListener('paste', function (e) {
          var cd = e.clipboardData || window.clipboardData;
          if (!cd) return;
          var teks = String(cd.getData('text/plain') || '');
          var hasil = plainFieldPaste(String(cd.getData('text/html') || ''), teks);
          var sisipan = hasil.changed ? hasil.text : teks;
          if (!sisipan) return;
          e.preventDefault();
          ta.value = (ta.value ? ta.value.replace(/\s*$/, ' ') : '') + sisipan;
          perbaruiPratinjau();
        });
        ok.addEventListener('click', function () {
          var t = bersihkanTex(ta.value);
          if (t) { insertHtml(texSpan(t) + '&nbsp;'); typesetMath(area); }
          p.close();
        });
        perbaruiPratinjau();
        ta.focus();
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
    // REVISI RUMUS 2026-09-24: rumus dari Word (OMML), AI (MathJax/MathML/
    // LaTeX $...$), dan teks LaTeX polos otomatis diubah menjadi rumus
    // [data-tex] yang dirender KaTeX — guru cukup copy-paste apa adanya.
    area.addEventListener('paste', function (e) {
      e.preventDefault();
      var cd = e.clipboardData || window.clipboardData;
      if (!cd) return;
      var html = String(cd.getData('text/html') || '');
      var text = String(cd.getData('text/plain') || '');
      var clean = '';
      if (html) {
        var conv = mathifyHtml(html);
        // Format span[style] hasil Word/GDocs -> tag semantik SEBELUM
        // sanitizer (dulu posisinya keliru sehingga format hilang).
        conv.html = normalizeStyled(conv.html);
        var masihRender = /mjx-container|<mjx-|class="[^"]*(?:katex|MathJax)[^"]*"/i.test(conv.html);
        var dariHtml = sanitizeHtml(conv.html);
        var dariTeks = sanitizeHtml(text);
        if (masihRender) {
          // Rumus yang hanya tersisa sebagai hasil render (tanpa sumber):
          // teks polos sering justru memuat sumber LaTeX-nya (umum pada AI).
          clean = stripHtml(dariTeks) ? dariTeks : dariHtml;
        } else {
          clean = dariHtml;
          if (!stripHtml(clean)) clean = dariTeks;
        }
      } else {
        clean = sanitizeHtml(text);
      }
      if (clean) insertHtml(clean);
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
    detectMathSegments: detectMathSegments,
    mathifyPlainText: mathifyPlainText,
    mathifyHtml: mathifyHtml,
    ommlToPlainText: ommlToPlainText,
    plainFieldPaste: plainFieldPaste,
    hasMathMarkup: hasMathMarkup,
    autoMathTextNodes: autoMathTextNodes,
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
