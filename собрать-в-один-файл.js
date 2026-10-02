/* Собирает весь сайт в один самодостаточный index.html */
const fs = require('fs');
const SRC = 'C:/Users/mtajm/Desktop/саид програм/phone-master/';
const OUT = process.argv[2] || 'C:/Users/mtajm/Desktop/Smartfix-один-файл/index.html';

const PAGES = [
  { file: 'index.html',    key: 'home',     title: 'Главная',                 nav: null },
  { file: 'services.html', key: 'services', title: 'Услуги',                  nav: 'Услуги' },
  { file: 'ios.html',      key: 'ios',      title: 'Программы для iPhone',    nav: 'Приложения' },
  { file: 'prices.html',   key: 'prices',   title: 'Цены',                    nav: 'Цены' },
  { file: 'how.html',      key: 'how',      title: 'Как я работаю',           nav: 'Как работаю' },
  { file: 'faq.html',      key: 'faq',      title: 'Частые вопросы',          nav: 'Вопросы' },
  { file: 'contacts.html', key: 'contacts', title: 'Контакты',                nav: 'Контакты' },
  { file: 'booking.html',  key: 'booking',  title: 'Запись на ремонт',        nav: null },
];

const read = f => fs.readFileSync(SRC + f, 'utf8');
const b64  = f => fs.readFileSync(SRC + f).toString('base64');

/* ---- 1. ссылки между страницами -> ссылки на разделы одного файла ---- */
function retarget(html) {
  return html.replace(
    /href="(index|services|prices|how|faq|contacts|booking|ios)\.html((?:#[^"]*)?(?:\?[^"]*)?)"/g,
    function (m, page, rest) {
      const key = page === 'index' ? 'home' : page;
      let anchor = '', query = '', r = rest || '';
      const qi = r.indexOf('?');
      if (qi >= 0) { query = r.slice(qi); r = r.slice(0, qi); }
      if (r.charAt(0) === '#') anchor = '/' + r.slice(1);
      const q = query ? '?' + encodeURIComponent(query.slice(1)) : '';
      return 'href="#' + key + anchor + q + '"';
    }
  );
}

/* ---- 2. содержимое каждой страницы ---- */
const problems = [];
const pageBlocks = PAGES.map(function (p) {
  const html = read(p.file);
  const m = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  if (!m) { problems.push(p.file + ': не найден <main>'); return ''; }
  return '<div class="page" id="page-' + p.key + '" data-title="' + p.title + '">\n'
       + retarget(m[1]).trim() + '\n</div>';
});

/* ---- 3. шапка и подвал ---- */
const home = read('index.html');
let header = (home.match(/<header[\s\S]*?<\/header>/) || [''])[0];
let footer = (home.match(/<footer[\s\S]*?<\/footer>/) || [''])[0];
if (!header) problems.push('не найдена шапка');
if (!footer) problems.push('не найден подвал');
header = retarget(header);
footer = retarget(footer);

/* ---- 4. стили: шрифты и фон вшиваем в файл ---- */
let css = read('css/style.css');
const cyr = b64('fonts/montserrat-cyr.woff2');
const lat = b64('fonts/montserrat-lat.woff2');
const bg  = b64('img/bg.jpg');
css = css.replace('url("../fonts/montserrat-cyr.woff2")', 'url(data:font/woff2;base64,' + cyr + ')');
css = css.replace('url("../fonts/montserrat-lat.woff2")', 'url(data:font/woff2;base64,' + lat + ')');
css = css.replace('url("../img/bg.jpg")', 'url(data:image/jpeg;base64,' + bg + ')');
css = css.replace('../img/bg.jpg', 'data:image/jpeg;base64,' + bg);
if (css.indexOf('data:image/jpeg') < 0) problems.push('фон не вшился в стили');
if (css.indexOf('data:font/woff2') < 0) problems.push('шрифты не вшились в стили');

/* ---- 5. правила для разделов одного файла ---- */
css += `

/* ============ РЕЖИМ ОДНОГО ФАЙЛА ============
   Все страницы лежат в одном документе, видно только активную.
   Переключение — без перезагрузки, поэтому «моргания» и не видно. */
.page{display:none}
.page.is-active{display:block}
#app{transition:opacity .18s ease,transform .18s ease}
#app.is-switching{opacity:0;transform:translateY(10px)}
@media (prefers-reduced-motion: reduce){
  #app{transition:none}
  #app.is-switching{opacity:1;transform:none}
}
`;

/* ---- 6. скрипт одного файла ---- */
const script = `
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;

  document.querySelectorAll('.js-year').forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  /* шапка при прокрутке */
  var header = document.getElementById('header');
  var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 8); };
  onScroll(); window.addEventListener('scroll', onScroll, { passive: true });

  /* меню-бургер */
  var burger = document.getElementById('burger');
  var nav = document.getElementById('nav');
  var closeNav = function () { nav.classList.remove('is-open'); burger.setAttribute('aria-expanded', 'false'); };
  burger.addEventListener('click', function () {
    burger.setAttribute('aria-expanded', String(nav.classList.toggle('is-open')));
  });
  nav.addEventListener('click', function (e) { if (e.target.closest('a')) closeNav(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeNav(); });

  /* ---------- разделы ---------- */
  var app = document.getElementById('app');
  var pages = Array.prototype.slice.call(document.querySelectorAll('.page'));
  var byKey = {};
  pages.forEach(function (p) { byKey[p.id.replace(/^page-/, '')] = p; });

  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.nav__list a[href^="#"]'));

  function parseHash() {
    var raw = location.hash.replace(/^#\\/?/, '');
    var query = '', qi = raw.indexOf('?');
    if (qi >= 0) { query = decodeURIComponent(raw.slice(qi + 1)); raw = raw.slice(0, qi); }
    var parts = raw.split('/');
    return { key: parts[0] || 'home', anchor: parts[1] || '', query: query };
  }

  function scrollToAnchor(anchor) {
    if (!anchor) { window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); return; }
    var el = document.getElementById(anchor);
    if (el) setTimeout(function () { el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' }); }, 60);
    else window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function markNav(key) {
    navLinks.forEach(function (a) {
      var href = a.getAttribute('href').replace(/^#/, '').split('?')[0];
      var on = href === key;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  /* услуга из ссылки «Записаться» попадает в форму записи */
  function presetService(query) {
    var select = document.querySelector('select[name="service"]');
    if (!select || !query) return;
    var params = new URLSearchParams(query);
    var want = params.get('service');
    if (!want) return;
    var matched = Array.prototype.some.call(select.options, function (o) {
      if (o.value.toLowerCase() === want.toLowerCase() || o.textContent.trim().toLowerCase() === want.toLowerCase()) {
        select.value = o.value; return true;
      }
      return false;
    });
    if (!matched) {
      var text = document.querySelector('textarea[name="problem"]');
      if (text && text.value.indexOf('Услуга:') !== 0) text.value = 'Услуга: ' + want + '\\n' + text.value;
    }
  }

  var current = null;

  function reveal(p, key, anchor, query) {
    pages.forEach(function (x) { x.classList.remove('is-active'); });
    p.classList.add('is-active');
    current = p;
    document.title = (p.getAttribute('data-title') || 'Smartfix') + ' — Smartfix, Грозный';
    markNav(key);
    presetService(query);
    scrollToAnchor(anchor);
    requestAnimationFrame(function () { app.classList.remove('is-switching'); });
  }

  function show(instant) {
    var h = parseHash();
    var p = byKey[h.key] || byKey.home;
    var key = byKey[h.key] ? h.key : 'home';
    if (p === current && !instant) {
      /* уже на этом разделе — но услуга в ссылке могла измениться */
      markNav(key);
      presetService(h.query);
      scrollToAnchor(h.anchor);
      return;
    }

    if (instant || reduce) {
      app.classList.remove('is-switching');
      reveal(p, key, h.anchor, h.query);
      return;
    }
    app.classList.add('is-switching');
    setTimeout(function () { reveal(p, key, h.anchor, h.query); }, 180);
  }

  window.addEventListener('hashchange', function () { show(false); });

  /* формы заявок — заявка уходит в WhatsApp */
  var LEAD_LABELS = {
    name: 'Имя',
    phone: 'Телефон',
    model: 'Модель телефона',
    service: 'Услуга',
    way: 'Как передать телефон',
    time: 'Когда позвонить',
    problem: 'Что случилось'
  };

  function buildWhatsAppText(form) {
    var lines = ['Заявка с сайта Smartfix', ''];
    Object.keys(LEAD_LABELS).forEach(function (field) {
      var el = form.elements[field];
      if (!el) return;
      var value = (el.value || '').trim();
      if (!value) return;
      if (field === 'problem') {
        lines.push('');
        lines.push(LEAD_LABELS[field] + ':');
        lines.push(value);
      } else {
        lines.push(LEAD_LABELS[field] + ': ' + value);
      }
    });
    return lines.join('\\n');
  }

  function sendToWhatsApp(form) {
    var number = (form.getAttribute('data-whatsapp') || '79619997681').replace(/[^0-9]/g, '');
    if (!number) return;
    var url = 'https://wa.me/' + number + '?text=' + encodeURIComponent(buildWhatsAppText(form));
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) { location.href = url; return; }
    var win = window.open(url, '_blank', 'noopener');
    if (!win) location.href = url;
  }

  /* заявка на сервер (Cloudflare Workers) — он пересылает её в Телеграм */
  function sendToServer(form) {
    var endpoint = (form.getAttribute('data-endpoint') || '').trim();
    if (!endpoint) return Promise.resolve(false);
    var payload = {};
    Object.keys(LEAD_LABELS).forEach(function (field) {
      var el = form.elements[field];
      if (!el) return;
      var value = (el.value || '').trim();
      if (value) payload[LEAD_LABELS[field]] = value;
    });
    payload.hp = (form.elements.hp && form.elements.hp.value) || '';
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        return response.json()
          .catch(function () { return {}; })
          .then(function (data) { return { data: data }; });
      })
      .then(function (result) {
        var data = result.data || {};
        if (data.ok) return { ok: true };
        if (data.reason === 'limit') return { ok: false, reason: 'limit', message: data.message };
        return { ok: false, reason: 'сервер отказал' };
      })
      .catch(function () { return { ok: false, reason: 'сеть' }; });
  }

  var OK_TEXT = 'Заявка отправлена. Отвечу в течение часа — обычно быстрее.';
  var FALLBACK_TEXT = 'Отправить автоматически не получилось. Сейчас откроется WhatsApp — нажми там «Отправить», и заявка дойдёт.';
  var LIMIT_TEXT = 'С сегодняшнего дня заявок больше нет — лимит 3 в сутки, чтобы не было спама. Если вопрос срочный, позвони: +7 (961) 999-76-81';

  /* Лимит заявок: подсказка в браузере, настоящий замок — на сервере */
  var LEADS_PER_DAY = 3;

  function todayKey() {
    return 'smartfix-leads-' + new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  function leadsSentToday() {
    try { return parseInt(localStorage.getItem(todayKey()) || '0', 10) || 0; }
    catch (e) { return 0; }
  }
  function rememberLeadLocally() {
    try {
      var key = todayKey();
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var older = localStorage.key(i);
        if (older && older.indexOf('smartfix-leads-') === 0 && older !== key) localStorage.removeItem(older);
      }
      localStorage.setItem(key, String(leadsSentToday() + 1));
    } catch (e) {}
  }

  function showResult(ok, err, text) {
    if (err) err.classList.remove('is-visible');
    if (!ok) return;
    ok.textContent = text;
    ok.classList.add('is-visible');
    ok.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function showLimit(ok, err, text) {
    if (ok) ok.classList.remove('is-visible');
    if (!err) return;
    err.textContent = text;
    err.classList.add('is-visible');
    err.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  document.querySelectorAll('form.js-form').forEach(function (form) {
    var ok = form.querySelector('.form-ok');
    var err = form.querySelector('.form-err');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.querySelector('[name="name"]');
      var phone = form.querySelector('[name="phone"]');
      var missing = null;
      if (name && !name.value.trim()) missing = name;
      else if (phone && !phone.value.trim()) missing = phone;
      if (missing) {
        if (err) { err.textContent = 'Заполни имя и телефон — иначе я не смогу ответить.'; err.classList.add('is-visible'); }
        missing.focus();
        return;
      }
      if (err) err.classList.remove('is-visible');
      if (leadsSentToday() >= LEADS_PER_DAY) { showLimit(ok, err, LIMIT_TEXT); return; }
      if (form.__sending) return;   // защита от повторной отправки: Enter в поле
      form.__sending = true;        // отправляет форму в обход заблокированной кнопки
      var button = form.querySelector('button[type="submit"]');
      var buttonText = button ? button.textContent : '';
      if (button) { button.disabled = true; button.textContent = 'Отправляю…'; }
      sendToServer(form).then(function (result) {
        form.__sending = false;
        if (button) { button.disabled = false; button.textContent = buttonText; }
        if (result.ok) { rememberLeadLocally(); showResult(ok, err, OK_TEXT); return; }
        if (result.reason === 'limit') { showLimit(ok, err, result.message || LIMIT_TEXT); return; }
        showResult(ok, err, FALLBACK_TEXT);
        sendToWhatsApp(form);
      });
    });
  });

  /* первый показ — сразу, без анимации, чтобы страница не мигнула */
  show(true);
})();
`;

/* ---- 7. итоговый файл ---- */
const out = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Smartfix — программист по телефонам в Грозном | Прошивка, разблокировка, ремонт</title>
<meta name="description" content="Прошивка Android и iPhone, разблокировка аккаунта, чистка от вирусов, восстановление данных, программы для iPhone. Грозный, ул. Орзамиева 19, старый рынок.">
<script>
/* Плавное появление при первом открытии. Класс ставится до отрисовки,
   чтобы страница не мигнула белым. */
(function () {
  var r = document.documentElement;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  r.classList.add('anim');
  function ready() { r.classList.add('is-ready'); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { requestAnimationFrame(ready); });
  else requestAnimationFrame(ready);
  setTimeout(ready, 900);
})();
</script>
<style>
${css}
</style>
</head>
<body>

${header}

<main id="app">
${pageBlocks.join('\n')}
</main>

${footer}

<script>
${script}
</script>
</body>
</html>
`;

fs.mkdirSync(require('path').dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);

const kb = n => Math.round(n / 1024) + ' КБ';
console.log('разделов собрано :', pageBlocks.length, 'из', PAGES.length);
console.log('файл записан     :', OUT);
console.log('размер           :', kb(Buffer.byteLength(out)));
console.log('  из них стили   :', kb(Buffer.byteLength(css)));
console.log('  шрифты         :', kb(cyr.length * 3 / 4), '+', kb(lat.length * 3 / 4));
console.log('  фон            :', kb(bg.length * 3 / 4));
console.log('внешних ссылок   :', (out.match(/(?:href|src)="(?!https?:|mailto:|tel:|#|data:|files\/)[^"]+"/g) || []).join(', ') || 'нет');
console.log(problems.length ? 'ПРОБЛЕМЫ: ' + problems.join(' | ') : 'ошибок сборки нет');
