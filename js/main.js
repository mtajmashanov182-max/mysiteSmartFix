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
     Заявка уходит на сервер, а он пересылает её в Телеграм.
     Адрес сервера задаётся в booking.html: у формы атрибут data-endpoint. */

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

  /* Заявка на сервер. Он лежит отдельно (Cloudflare Workers) и пересылает
     заявку в Телеграм — там и хранится токен бота, в коде сайта его нет.
     Адрес сервера задаётся у формы в booking.html: атрибут data-endpoint. */
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
    // ловушка для ботов: человек это поле не видит и не заполняет
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
        // сервер сказал «хватит» — заявок на сегодня больше не принимаем
        if (data.reason === 'limit') return { ok: false, reason: 'limit', message: data.message };
        return { ok: false, reason: 'сервер отказал' };
      })
      .catch(function () { return { ok: false, reason: 'сеть' }; });   // есть запасной путь
  }

  var OK_TEXT = 'Заявка отправлена. Отвечу в течение часа — обычно быстрее.';
  var FAIL_TEXT = 'Отправить заявку не получилось — похоже, пропала связь. Позвони: +7 (961) 999-76-81 или напиши в Telegram: @Saidbro335';
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
      sendToServer(form).then(function (result) {
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
        // Сервер не принял заявку — отправлять больше некуда,
        // поэтому показываем телефон и Telegram.
        showLimit(ok, err, FAIL_TEXT);
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
