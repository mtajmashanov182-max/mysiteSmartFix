/* ============================================================
   PhoneSoft — общий скрипт для всех страниц
   ============================================================ */
(function () {
  'use strict';

  /* ---------- Год в подвале ---------- */
  document.querySelectorAll('.js-year').forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  /* ---------- Тень шапки при прокрутке ---------- */
  var header = document.getElementById('header');
  if (header) {
    var onScroll = function () {
      header.classList.toggle('is-scrolled', window.scrollY > 8);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- Меню-бургер ---------- */
  var burger = document.getElementById('burger');
  var nav = document.getElementById('nav');
  if (burger && nav) {
    var closeNav = function () {
      nav.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
    };

    burger.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      burger.setAttribute('aria-expanded', String(open));
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) closeNav();
    });
    document.addEventListener('click', function (e) {
      if (!nav.classList.contains('is-open')) return;
      if (!nav.contains(e.target) && !burger.contains(e.target)) closeNav();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeNav();
    });
  }

  /* ---------- Подсветка текущей страницы в меню ---------- */
  var here = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav__list a[href]').forEach(function (a) {
    var href = a.getAttribute('href');
    if (href === here || (here === 'index.html' && href === './')) {
      a.classList.add('is-active');
      a.setAttribute('aria-current', 'page');
    }
  });

  /* ---------- Подстановка услуги из ссылки (?service=...) ---------- */
  var params = new URLSearchParams(location.search);
  var presetService = params.get('service');
  if (presetService) {
    var select = document.querySelector('select[name="service"]');
    if (select) {
      var ok = Array.prototype.some.call(select.options, function (o) {
        if (o.value.toLowerCase() === presetService.toLowerCase() ||
            o.textContent.trim().toLowerCase() === presetService.toLowerCase()) {
          select.value = o.value;
          return true;
        }
        return false;
      });
      if (!ok) {
        // услуги нет в списке — записываем её в комментарий
        var text = document.querySelector('textarea[name="problem"]');
        if (text && !text.value) text.value = 'Услуга: ' + presetService + '\n';
      }
    }
  }

  /* ---------- Формы заявки ----------
     Заявку отправляет GitHub Actions, а он пересылает её в Телеграм.
     Настройки — в js/lead-config.js, он подключается только на booking.html.
     Если автоматика не сработала, человеку показывается кнопка с готовым
     текстом заявки — см. showFallback ниже. */

  /* Порядок полей в сообщении. «Что случилось» идёт последним:
     это длинный текст в несколько строк, ему место в конце. */
  var LEAD_LABELS = {
    name: 'Имя',
    phone: 'Телефон',
    model: 'Модель телефона',
    service: 'Услуга',
    way: 'Как передать телефон',
    time: 'Когда позвонить',
    problem: 'Что случилось'
  };

  /* Заявку можно отправить двумя независимыми путями, и хватит любого:

     1. GitHub Actions — основной. Браузер клиента отправляет заявку на
        api.github.com, GitHub запускает .github/workflows/lead.yml, а тот
        пишет в Телеграм. Так сделано потому, что Cloudflare (бывший сервер
        заявок) в России заблокирован, а api.telegram.org из российских
        сетей не открывается. GitHub из России работает, а его серверы
        стоят вне России. Настройки — в js/lead-config.js.

     2. Кнопка «Открыть Телеграм» — запасной. Если автоматика не сработала,
        человеку показывается кнопка: открывается чат с мастером, текст
        заявки уже подставлен, остаётся нажать «Отправить». Так заявка
        не потеряется, даже если GitHub станет недоступен. */

  /* Собираем поля формы в объект с русскими подписями */
  function collectPayload(form) {
    var payload = {};
    Object.keys(LEAD_LABELS).forEach(function (field) {
      var el = form.elements[field];
      if (!el) return;
      var value = (el.value || '').trim();
      if (value) payload[LEAD_LABELS[field]] = value;
    });
    // ловушка для ботов: человек это поле не видит и не заполняет
    payload.hp = (form.elements.hp && form.elements.hp.value) || '';
    return payload;
  }

  /* Заявка на свой сервер. Сейчас он не подключён: адрес в booking.html
     у формы пустой, а Cloudflare Worker, который стоял раньше, в России
     заблокирован. Путь оставлен на случай, если свой сервер появится —
     тогда достаточно вписать его адрес в атрибут data-endpoint. */
  function sendToServer(form) {
    var endpoint = (form.getAttribute('data-endpoint') || '').trim();
    if (!endpoint) return Promise.resolve({ ok: false, reason: 'не настроен' });

    var payload = collectPayload(form);

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
        // сервер сказал «хватит» — заявок на сегодня больше не принимаем
        if (data.reason === 'limit') return { ok: false, reason: 'limit', message: data.message };
        return { ok: false, reason: 'сервер отказал' };
      })
      .catch(function () { return { ok: false, reason: 'сеть' }; });   // есть запасной путь
  }

  /* Заявка через GitHub Actions.
     GitHub отвечает почти сразу: он не отправляет заявку сам, а только
     ставит задачу в очередь. Само сообщение в Телеграме появится через
     15–30 секунд — для записи на ремонт это неважно. */
  function sendToGitHub(form, config) {
    var repo = (config.repo || '').trim();
    var workflow = (config.workflow || '').trim();
    var token = (config.token || '').trim();
    // пока токен не вписан, путь просто выключен — остаётся кнопка в Телеграм
    if (!repo || !workflow || !token) return Promise.resolve({ ok: false, reason: 'не настроен' });

    // Кириллицу переводим в \uXXXX: так строка гарантированно переживёт
    // дорогу через GitHub и не зависит от кодировок на чужой стороне.
    var payload = JSON.stringify(collectPayload(form))
      .replace(/[^\x00-\x7F]/g, function (ch) {
        return '\\u' + ('000' + ch.charCodeAt(0).toString(16)).slice(-4);
      });

    var url = 'https://api.github.com/repos/' + repo +
              '/actions/workflows/' + encodeURIComponent(workflow) + '/dispatches';

    return fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ref: 'main', inputs: { payload: payload } })
    })
      // 204 без тела — задача принята. Остальные ответы означают отказ:
      // токен отозван, workflow переименован, репозиторий переехал.
      .then(function (response) { return { ok: response.ok }; })
      .catch(function () { return { ok: false, reason: 'сеть' }; });
  }

  /* Пробуем основной путь, потом запасной. Ошибку не показываем сразу:
     сначала даём шанс второму способу. */
  function sendLead(form) {
    var config = window.LEAD_CONFIG || {};
    return sendToServer(form).then(function (result) {
      if (result.ok) return result;
      // «лимит» — это не поломка, а решение сервера: обходить его
      // другим способом не надо
      if (result.reason === 'limit') return result;
      return sendToGitHub(form, config);
    });
  }

  /* Текст заявки простыми строками — для Телеграма, без разметки */
  function telegramText(form) {
    var lead = collectPayload(form);
    var lines = ['Заявка с сайта Smartfix'];
    Object.keys(LEAD_LABELS).forEach(function (field) {
      var value = lead[LEAD_LABELS[field]];
      if (value) lines.push(LEAD_LABELS[field] + ': ' + value);
    });
    return lines.join('\n');
  }

  /* Ссылка на чат с мастером, где текст заявки уже подставлен.
     Человеку остаётся нажать в Телеграме «Отправить». */
  function telegramLink(form) {
    var config = window.LEAD_CONFIG || {};
    var nick = (config.telegram || '').replace(/^@/, '').trim();
    if (!nick) return '';
    return 'https://t.me/' + nick + '?text=' + encodeURIComponent(telegramText(form));
  }

  var OK_TEXT = 'Заявка отправлена. Отвечу в течение часа — обычно быстрее.';
  var LIMIT_TEXT = 'С сегодняшнего дня заявок больше нет — лимит 3 в сутки, чтобы не было спама. Если вопрос срочный, позвони: +7 (961) 999-76-81';

  /* Лимит заявок. Здесь он работает как подсказка: не гоняем человека
     к серверу, если и так понятно, что лимит выбран. Настоящий замок
     стоит на сервере — почистить историю браузера и обойти его нельзя. */
  var LEADS_PER_DAY = 3;

  function todayKey() {
    // сутки считаем по московскому времени, как и сервер
    return 'smartfix-leads-' + new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  function leadsSentToday() {
    try { return parseInt(localStorage.getItem(todayKey()) || '0', 10) || 0; }
    catch (e) { return 0; }
  }

  function rememberLeadLocally() {
    try {
      var key = todayKey();
      // старые записи убираем, чтобы память браузера не забивалась
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

  /* Автоматика не сработала — показываем кнопку с готовым текстом заявки.
     Так заявка не потеряется, даже если GitHub перестанет отвечать.
     Открывать Телеграм сами, без нажатия, нельзя: браузеры считают это
     всплывающим окном и блокируют. */
  function showFallback(ok, err, form) {
    if (ok) ok.classList.remove('is-visible');
    if (!err) return;
    err.textContent = '';

    var text = document.createElement('span');
    text.textContent = 'Отправить автоматически не получилось. Нажми кнопку — ' +
      'откроется Телеграм с уже готовой заявкой, останется нажать «Отправить».';
    err.appendChild(text);

    var link = telegramLink(form);
    if (link) {
      var a = document.createElement('a');
      a.className = 'form-err__btn';
      a.href = link;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Открыть Телеграм с заявкой';
      err.appendChild(a);
    }

    var phone = document.createElement('span');
    phone.className = 'form-err__phone';
    phone.textContent = 'Или позвони: +7 (961) 999-76-81';
    err.appendChild(phone);

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
        if (err) {
          err.textContent = 'Заполни имя и телефон — иначе я не смогу ответить.';
          err.classList.add('is-visible');
        }
        missing.focus();
        return;
      }
      if (err) err.classList.remove('is-visible');

      // Если лимит на сегодня уже выбран — не тревожим сервер, говорим сразу
      if (leadsSentToday() >= LEADS_PER_DAY) {
        showLimit(ok, err, LIMIT_TEXT);
        return;
      }

      // Защита от повторной отправки. Одной блокировки кнопки мало:
      // Enter в любом поле отправляет форму в обход заблокированной кнопки,
      // и заявка ушла бы дважды.
      if (form.__sending) return;
      form.__sending = true;

      var button = form.querySelector('button[type="submit"]');
      var buttonText = button ? button.textContent : '';
      if (button) { button.disabled = true; button.textContent = 'Отправляю…'; }

      // Ничего из формы не стираем: если отправка не пройдёт, человек
      // не потеряет написанное и сможет отправить ещё раз.
      sendLead(form).then(function (result) {
        form.__sending = false;
        if (button) { button.disabled = false; button.textContent = buttonText; }

        if (result.ok) {
          rememberLeadLocally();
          showResult(ok, err, OK_TEXT);
          return;
        }
        // Лимит — это не поломка, говорим как есть.
        if (result.reason === 'limit') {
          showLimit(ok, err, result.message || LIMIT_TEXT);
          return;
        }
        // Ни сервер, ни GitHub заявку не приняли — отправлять больше некуда,
        // поэтому отдаём человеку готовый текст и телефон мастера.
        showFallback(ok, err, form);
      });
    });
  });

  /* ---------- Плавный переход между страницами ----------
     Клик по внутренней ссылке: страница сначала плавно уходит,
     потом открывается следующая (там её так же плавно показывает anim.js).
     Если анимации отключены (класса .anim нет) — обычный переход. */
  var root = document.documentElement;

  if (root.classList.contains('anim')) {
    document.addEventListener('click', function (e) {
      // не мешаем: другая кнопка мыши, Ctrl/Cmd/Shift, отменённый клик
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      var link = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!link) return;

      var href = link.getAttribute('href');
      if (!href || href.charAt(0) === '#') return;              // якорь на этой же странице
      if (link.target && link.target !== '_self') return;        // открывается в новой вкладке
      if (link.hasAttribute('download')) return;
      if (/^(mailto:|tel:|https?:)/i.test(href)) return;         // почта, звонок, чужие сайты

      var url;
      try {
        url = new URL(link.href, location.href);
      } catch (err) {
        return;
      }
      if (url.origin !== location.origin) return;
      // та же страница с якорем или параметром — пусть браузер обработает сам
      if (url.pathname === location.pathname && url.search === location.search) return;

      e.preventDefault();
      root.classList.add('is-leaving');
      setTimeout(function () {
        location.href = url.href;
      }, 220);
    });

    // если страницу вернули назад — снимаем «уход», она снова видна
    window.addEventListener('pageshow', function () {
      root.classList.remove('is-leaving');
    });
  }
})();
