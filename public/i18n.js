// Language switch: English (default) or Malayalam. Loaded with `defer` before the page scripts,
// so window.t() exists when they run and static text is swapped before anything renders on top.
(() => {
  const KEY = 'oneupload.lang';
  const lang = localStorage.getItem(KEY) === 'ml' ? 'ml' : 'en';
  window.LANG = lang;
  document.documentElement.lang = lang;
  // The server reads this cookie to pick the language of its error messages.
  document.cookie = `ou_lang=${lang}; path=/; max-age=31536000; samesite=lax`;

  /** t('മലയാളം text', 'English text') → the text for the current language. */
  window.t = (ml, en) => (lang === 'en' ? en : ml);

  window.setLang = (next) => {
    localStorage.setItem(KEY, next);
    location.reload();
  };

  if (lang === 'en') {
    document.querySelectorAll('[data-en]').forEach((el) => (el.innerHTML = el.dataset.en));
    document.querySelectorAll('[data-en-ph]').forEach((el) => (el.placeholder = el.dataset.enPh));
  }
  document.querySelectorAll('.lang-switch button').forEach((b) => {
    b.classList.toggle('on', b.dataset.lang === lang);
    b.addEventListener('click', () => b.dataset.lang !== lang && window.setLang(b.dataset.lang));
  });
})();
