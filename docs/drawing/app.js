'use strict';

/* ------------------------------------------------------------------ */
/* Brevo form endpoint. Empty until configured — see README.md.        */
/* ------------------------------------------------------------------ */
const BREVO_FORM_ACTION = '';

/* ------------------------------------------------------------------ */
/* Hero similarity grid: 4 fixed patterns (query + 6 results each).    */
/* No server communication — everything below is static sample data.   */
/* ------------------------------------------------------------------ */
const PATTERNS = [
  {
    query: { src: 'assets/flange-q.webp', alt: 'サンプル図面: 円形フランジ 図番PB-2041' },
    results: [
      { src: 'assets/flange-1.webp', score: 0.973, alt: 'サンプル図面: 円形フランジ 図番PB-2044' },
      { src: 'assets/flange-2.webp', score: 0.958, alt: 'サンプル図面: 円形フランジ 図番PB-2039' },
      { src: 'assets/flange-3.webp', score: 0.941, alt: 'サンプル図面: 円形フランジ 図番PB-2052' },
      { src: 'assets/flange-4.webp', score: 0.926, alt: 'サンプル図面: 円形フランジ 図番PB-2037' },
      { src: 'assets/flange-5.webp', score: 0.909, alt: 'サンプル図面: 円形フランジ 図番PB-2061' },
      { src: 'assets/flange-6.webp', score: 0.891, alt: 'サンプル図面: 円形フランジ 図番PB-2048' },
    ],
  },
  {
    query: { src: 'assets/bracket-q.webp', alt: 'サンプル図面: L字ブラケット 図番PB-3112' },
    results: [
      { src: 'assets/bracket-1.webp', score: 0.968, alt: 'サンプル図面: L字ブラケット 図番PB-3115' },
      { src: 'assets/bracket-2.webp', score: 0.952, alt: 'サンプル図面: L字ブラケット 図番PB-3109' },
      { src: 'assets/bracket-3.webp', score: 0.937, alt: 'サンプル図面: L字ブラケット 図番PB-3121' },
      { src: 'assets/bracket-4.webp', score: 0.919, alt: 'サンプル図面: L字ブラケット 図番PB-3104' },
      { src: 'assets/bracket-5.webp', score: 0.902, alt: 'サンプル図面: L字ブラケット 図番PB-3130' },
      { src: 'assets/bracket-6.webp', score: 0.884, alt: 'サンプル図面: L字ブラケット 図番PB-3117' },
    ],
  },
  {
    query: { src: 'assets/plate-q.webp', alt: 'サンプル図面: 穴あきプレート 図番PB-4208' },
    results: [
      { src: 'assets/plate-1.webp', score: 0.958, alt: 'サンプル図面: 穴あきプレート 図番PB-4211' },
      { src: 'assets/plate-2.webp', score: 0.941, alt: 'サンプル図面: 穴あきプレート 図番PB-4205' },
      { src: 'assets/plate-3.webp', score: 0.923, alt: 'サンプル図面: 穴あきプレート 図番PB-4219' },
      { src: 'assets/plate-4.webp', score: 0.905, alt: 'サンプル図面: 穴あきプレート 図番PB-4201' },
      { src: 'assets/plate-5.webp', score: 0.887, alt: 'サンプル図面: 穴あきプレート 図番PB-4226' },
      { src: 'assets/plate-6.webp', score: 0.869, alt: 'サンプル図面: 穴あきプレート 図番PB-4214' },
    ],
  },
  {
    query: { src: 'assets/shaft-q.webp', alt: 'サンプル図面: 段付きシャフト 図番PB-5117' },
    results: [
      { src: 'assets/shaft-1.webp', score: 0.947, alt: 'サンプル図面: 段付きシャフト 図番PB-5119' },
      { src: 'assets/shaft-2.webp', score: 0.926, alt: 'サンプル図面: 段付きシャフト 図番PB-5114' },
      { src: 'assets/shaft-3.webp', score: 0.905, alt: 'サンプル図面: 段付きシャフト 図番PB-5123' },
      { src: 'assets/shaft-4.webp', score: 0.884, alt: 'サンプル図面: 段付きシャフト 図番PB-5108' },
      { src: 'assets/shaft-5.webp', score: 0.861, alt: 'サンプル図面: 段付きシャフト 図番PB-5131' },
      { src: 'assets/shaft-6.webp', score: 0.837, alt: 'サンプル図面: 段付きシャフト 図番PB-5121' },
    ],
  },
];

(function initGrid() {
  const queryButton = document.getElementById('grid-query');
  const queryImg = document.getElementById('grid-query-img');
  const resultEls = Array.prototype.slice.call(document.querySelectorAll('.grid-result'));
  const indicatorEls = Array.prototype.slice.call(document.querySelectorAll('.grid-indicator'));
  if (!queryButton || !queryImg || resultEls.length === 0) return;

  let current = 0;
  const preloaded = {};

  function preload(pattern) {
    const urls = [pattern.query.src].concat(pattern.results.map(r => r.src));
    urls.forEach(src => {
      if (preloaded[src]) return;
      preloaded[src] = true;
      const img = new Image();
      img.src = src;
    });
  }

  function render(index) {
    const pattern = PATTERNS[index];

    queryImg.style.opacity = '0';
    resultEls.forEach(el => { el.style.opacity = '0'; });

    window.setTimeout(() => {
      queryImg.src = pattern.query.src;
      queryImg.alt = pattern.query.alt;
      queryImg.style.opacity = '1';

      pattern.results.forEach((result, i) => {
        const el = resultEls[i];
        if (!el) return;
        const img = el.querySelector('img');
        const scoreEl = el.querySelector('.grid-score');
        if (img) {
          img.src = result.src;
          img.alt = result.alt;
        }
        if (scoreEl) {
          scoreEl.textContent = 'SCORE ' + result.score.toFixed(3);
        }
        el.style.opacity = '1';
      });
    }, 20);

    indicatorEls.forEach((el, i) => {
      el.setAttribute('aria-current', i === index ? 'true' : 'false');
    });

    // Preload the next pattern so the following click/keypress feels instant.
    preload(PATTERNS[(index + 1) % PATTERNS.length]);
  }

  function goTo(index) {
    current = ((index % PATTERNS.length) + PATTERNS.length) % PATTERNS.length;
    render(current);
  }

  queryButton.addEventListener('click', () => {
    goTo(current + 1);
  });

  indicatorEls.forEach((el, i) => {
    el.addEventListener('click', () => goTo(i));
  });

  // First pattern is already in the DOM (eager-loaded); just wire up preload
  // for the second pattern and the indicator state.
  indicatorEls.forEach((el, i) => {
    el.setAttribute('aria-current', i === 0 ? 'true' : 'false');
  });
  preload(PATTERNS[1 % PATTERNS.length]);
})();

/* ------------------------------------------------------------------ */
/* Waitlist form                                                       */
/* ------------------------------------------------------------------ */
(function initForm() {
  const form = document.getElementById('waitlist-form');
  if (!form) return;

  const emailInput = form.querySelector('input[name="EMAIL"]');
  const messageEl = document.getElementById('waitlist-message');
  const successEl = document.getElementById('waitlist-success');
  const submitButton = form.querySelector('button[type="submit"]');

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function setMessage(text) {
    if (messageEl) messageEl.textContent = text || '';
  }

  function validate() {
    const value = emailInput ? emailInput.value.trim() : '';
    if (!value) {
      setMessage('メールアドレスを入力してください');
      return false;
    }
    const typeMismatch = emailInput && emailInput.validity && emailInput.validity.typeMismatch;
    if (typeMismatch || !EMAIL_RE.test(value)) {
      setMessage('メールアドレスの形式をご確認ください');
      return false;
    }
    return true;
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!validate()) return;

    if (submitButton) submitButton.disabled = true;
    setMessage('');

    if (!BREVO_FORM_ACTION) {
      setMessage('送信できませんでした。少し時間をおいてもう一度お試しください');
      if (submitButton) submitButton.disabled = false;
      return;
    }

    const formData = new FormData(form);
    formData.set('locale', 'ja');

    fetch(BREVO_FORM_ACTION, {
      method: 'POST',
      mode: 'no-cors',
      body: formData,
    }).then(() => {
      // sibforms responds without CORS headers, so the response here is an
      // opaque object regardless of outcome. resolve() is treated as success;
      // only a network-level rejection counts as a failure.
      try {
        history.pushState({}, '', '/drawing/thanks/');
      } catch (e) {
        /* ignore pushState failures (e.g. sandboxed preview) */
      }
      showSuccess();
    }).catch(() => {
      setMessage('送信できませんでした。少し時間をおいてもう一度お試しください');
      if (submitButton) submitButton.disabled = false;
    });
  });

  window.addEventListener('popstate', function () {
    // Nothing to restore: the form's own success state already persists in
    // the DOM regardless of URL, so a back navigation cannot break it.
  });

  function showSuccess() {
    form.hidden = true;
    if (successEl) {
      successEl.hidden = false;
      successEl.focus();
    }
  }
})();
