/**
 * Smartfix — приём заявок с сайта и отправка в Telegram.
 *
 * Это код для Cloudflare Workers (бесплатный тариф). Он принимает заявку
 * с сайта и пересылает её тебе в Телеграм через бота.
 *
 * Токен бота и твой chat_id задаются НЕ здесь, а в настройках воркера
 * (Settings → Variables), иначе их увидел бы любой, кто откроет страницу.
 *
 * Что обязательно поменять перед выкладкой:
 *   ALLOWED_ORIGINS — список адресов сайта, с которых принимаются заявки.
 *   Пока там примеры, воркер будет отказывать твоему настоящему сайту.
 */

const ALLOWED_ORIGINS = [
  'null',                              // открытие файла с диска (для проверки)
  'https://ВАШ-ДОМЕН.ru',              // ← сюда свой домен
  'https://ВАШ-НИК.github.io',         // ← и адрес на GitHub Pages, если есть
];

const MAX_LEN = 500;        // сколько символов брать из одного поля
const MAX_FIELDS = 12;      // больше — уже похоже на спам
const MAX_TOTAL = 4000;     // ограничение Телеграма на длину сообщения
const LEADS_PER_DAY = 3;    // сколько заявок может отправить один человек за сутки

// Сутки считаем по московскому времени, а не по всемирному:
// иначе лимит обнулялся бы в три часа ночи.
const MSK_SHIFT = 3 * 60 * 60 * 1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = allowed ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    } : {};

    // --- проверка связи: отправит тебе пробное сообщение ---
    // Открой адрес воркера с /test?key= и допиши последние 8 символов
    // токена бота. Ключ нужен, чтобы кто попало не мог слать тебе сообщения.
    if (request.method === 'GET' && url.pathname === '/test') {
      return testMessage(env, url.searchParams.get('key'));
    }

    // --- страница настройки: показывает твой chat_id ---
    // Открой адрес воркера с /setup в браузере. Она нужна потому, что
    // на некоторых сетях (в том числе российских) api.telegram.org
    // заблокирован, и открыть его из браузера не выйдет. А воркер
    // работает на Cloudflare, вне блокировки, и сходит в Телеграм сам.
    // После настройки этот блок можно удалить.
    if (request.method === 'GET' && url.pathname === '/setup') {
      return setup(env);
    }

    // браузер сначала спрашивает разрешение — отвечаем
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return answer({ ok: false, error: 'принимаю только POST' }, 405, cors);
    }
    if (!allowed) {
      return answer({ ok: false, error: 'заявки с этого адреса не принимаю' }, 403, cors);
    }

    // --- разбираем то, что прислал сайт ---
    let data;
    try {
      const type = request.headers.get('Content-Type') || '';
      data = type.includes('application/json')
        ? await request.json()
        : Object.fromEntries(await request.formData());
    } catch (e) {
      return answer({ ok: false, error: 'не разобрал данные' }, 400, cors);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return answer({ ok: false, error: 'пустая заявка' }, 400, cors);
    }

    // --- ловушка для ботов: человек это поле не видит и не заполняет ---
    if (String(data.hp || '').trim()) {
      return answer({ ok: true }, 200, cors);   // боту отвечаем «всё хорошо», но ничего не шлём
    }

    const fields = Object.entries(data)
      .filter(([key, value]) => key !== 'hp' && String(value || '').trim());
    if (!fields.length) {
      return answer({ ok: false, error: 'пустая заявка' }, 400, cors);
    }
    if (fields.length > MAX_FIELDS) {
      return answer({ ok: false, error: 'слишком много полей' }, 400, cors);
    }

    // --- лимит: не больше трёх заявок в сутки с одного адреса ---
    const limit = await checkLimit(env, request);
    if (!limit.allowed) {
      return answer({ ok: false, reason: 'limit', message: limit.message }, 429, cors);
    }

    // --- собираем сообщение ---
    // Каждое поле одной строкой: Телеграм сам переносит длинный текст,
    // а так сообщение остаётся коротким и читается с одного взгляда.
    const lines = ['🔔 <b>Новая заявка с сайта</b>'];
    for (const [key, value] of fields) {
      const text = String(value).slice(0, MAX_LEN).replace(/\s*\n\s*/g, ' ');
      lines.push('');
      lines.push('<b>' + escapeHtml(key) + ':</b> ' + escapeHtml(text));
    }
    const message = lines.join('\n').slice(0, MAX_TOTAL);

    // --- отправляем в Телеграм ---
    if (!env.BOT_TOKEN || !env.CHAT_ID) {
      return answer({ ok: false, error: 'на воркере не заданы BOT_TOKEN и CHAT_ID' }, 500, cors);
    }

    let response;
    try {
      response = await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.CHAT_ID,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
    } catch (e) {
      return answer({ ok: false, error: 'Телеграм недоступен' }, 502, cors);
    }

    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      return answer({
        ok: false,
        error: 'Телеграм отказал: ' + (result.description || response.status),
      }, 502, cors);
    }

    // заявка ушла — только теперь засчитываем её в лимит
    await rememberLead(env, limit.key, limit.used);

    return answer({ ok: true }, 200, cors);
  },
};

/** Сколько заявок уже отправлено с этого адреса за сегодня */
async function checkLimit(env, request) {
  // Если база не подключена, лимит молча не работает — заявки принимаются.
  // Так сайт не сломается, даже если про базу забыть.
  if (!env.LEADS) return { allowed: true, off: true };

  const key = limitKey(request);
  let used = 0;
  try {
    used = parseInt((await env.LEADS.get(key)) || '0', 10) || 0;
  } catch (e) {
    return { allowed: true, off: true };
  }

  if (used >= LEADS_PER_DAY) {
    return {
      allowed: false,
      message: 'С вашего адреса уже отправлено ' + LEADS_PER_DAY + ' заявки за сегодня — больше сегодня не приму, ' +
               'чтобы не было спама. Если вопрос срочный, позвоните: +7 (961) 999-76-81',
    };
  }
  return { allowed: true, key: key, used: used };
}

/** Записывает, что заявка ушла: следующий раз счётчик будет больше */
async function rememberLead(env, key, used) {
  if (!env.LEADS || !key) return;
  try {
    // храним двое суток — после этого запись сама удалится,
    // чтобы база не забивалась мусором
    await env.LEADS.put(key, String(used + 1), { expirationTtl: 172800 });
  } catch (e) {
    // не записалось — не беда, заявка уже отправлена
  }
}

/** Ключ для счётчика: адрес посетителя плюс сегодняшняя дата */
function limitKey(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'без-адреса';
  const day = new Date(Date.now() + MSK_SHIFT).toISOString().slice(0, 10);
  return 'limit:' + day + ':' + ip;
}

/** Проверка связи: шлём пробное сообщение. Ключ — последние 8 символов токена бота */
async function testMessage(env, key) {
  if (!env.BOT_TOKEN) {
    return answer({ ok: false, ошибка: 'сначала добавь BOT_TOKEN в настройках воркера' }, 500, {});
  }
  if (!env.CHAT_ID) {
    return answer({ ok: false, ошибка: 'сначала добавь CHAT_ID в настройках воркера' }, 500, {});
  }
  if (key !== env.BOT_TOKEN.slice(-8)) {
    return answer({
      ok: false,
      ошибка: 'нужен ключ в адресе: /test?key= и последние 8 символов токена бота',
    }, 403, {});
  }

  let data;
  try {
    const response = await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.CHAT_ID,
        text: '🔔 <b>Проверка связи</b>\n\nЭто пробное сообщение с сервера. Если ты его видишь — заявки с сайта тоже дойдут.',
        parse_mode: 'HTML',
      }),
    });
    data = await response.json();
  } catch (e) {
    return answer({ ok: false, ошибка: 'не смог связаться с Телеграмом' }, 502, {});
  }

  if (!data.ok) {
    return answer({ ok: false, ошибка: 'Телеграм отказал: ' + data.description }, 502, {});
  }
  return answer({
    ok: true,
    'готово': 'сообщение отправлено — открой Телеграм и проверь',
  }, 200, {});
}

/** Подсказка при настройке: спрашиваем у Телеграма, кто писал боту, и показываем chat_id */
async function setup(env) {
  if (!env.BOT_TOKEN) {
    return answer({ ok: false, ошибка: 'сначала добавь BOT_TOKEN в настройках воркера' }, 500, {});
  }
  let data;
  try {
    const response = await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/getUpdates');
    data = await response.json();
  } catch (e) {
    return answer({ ok: false, ошибка: 'не смог связаться с Телеграмом' }, 502, {});
  }
  if (!data.ok) {
    return answer({ ok: false, ошибка: 'Телеграм отказал: ' + data.description }, 502, {});
  }

  const chats = [];
  const seen = {};
  for (const update of data.result || []) {
    const message = update.message || update.edited_message || update.my_chat_member;
    const chat = message && message.chat;
    if (chat && !seen[chat.id]) {
      seen[chat.id] = true;
      chats.push({
        chat_id: chat.id,
        имя: [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.title || '',
        username: chat.username ? '@' + chat.username : '',
      });
    }
  }

  const limitInfo = env.LEADS
    ? 'включён: ' + LEADS_PER_DAY + ' заявки в сутки с одного адреса'
    : 'НЕ ВКЛЮЧЁН — не подключена база KV (Storage → KV → создать и привязать как LEADS)';

  if (!chats.length) {
    return answer({
      ok: false,
      ошибка: 'боту ещё никто не писал. Открой бота в Телеграме, напиши ему «привет» и обнови эту страницу',
      'лимит заявок': limitInfo,
    }, 200, {});
  }

  return answer({
    ok: true,
    'твой chat_id': chats[0].chat_id,
    'кто писал боту': chats,
    'лимит заявок': limitInfo,
  }, 200, {});
}

/** В сообщении нельзя оставлять угловые скобки и амперсанды — иначе Телеграм отвергнет текст */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function answer(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, cors),
  });
}
