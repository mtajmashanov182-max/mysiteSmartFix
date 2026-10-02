/* ============================================================
   Плавные переходы между страницами.
   Подключается в <head> — до отрисовки, чтобы страница не мигнула.
   Логика: ставим на <html> класс .anim (страница пока скрыта),
   потом .is-ready — и она плавно проявляется.
   ============================================================ */
(function () {
  'use strict';

  var root = document.documentElement;

  // Кому анимации мешают (настройка в системе) — показываем сразу, без движения
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  root.classList.add('anim');

  function ready() {
    root.classList.add('is-ready');
  }
  function showSoon() {
    requestAnimationFrame(ready);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showSoon);
  } else {
    showSoon();
  }

  // Страховка: если скрипты ниже упадут, страница всё равно покажется
  setTimeout(ready, 900);

  // Возврат назад или из кэша браузера — показываем сразу, без повторного проявления
  window.addEventListener('pageshow', function () {
    root.classList.remove('is-leaving');
    ready();
  });
})();
