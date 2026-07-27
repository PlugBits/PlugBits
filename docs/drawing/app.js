'use strict';

/* ------------------------------------------------------------------ */
/* Brevo form endpoint. Empty until configured — see README.md.        */
/* ------------------------------------------------------------------ */
const BREVO_FORM_ACTION = 'https://dca617a2.sibforms.com/serve/MUIFAADJ4N3DbJz4RS9TRz43ZFlD9TvMZa8m6VZiqHvtg__tVPVKMXt2zHU_OqRUpqAjYOn8b1tUjKBI5rZe1BC3KiBMb69dYxRPMWbTFiCeaw0lJuDlr4h8C_NsgB7mcMUqQO4jX-zChqCgqiM0SZvteV257IdAHQ79fCGtdo_4g3nEQq1jO1MWDsr_p0fmeDKbauPzPIA3bsc2jw==';

/* ------------------------------------------------------------------ */
/* Hero pseudo-app: 4 fixed patterns (query + 6 results each).         */
/* No server communication — everything below is static sample data.   */
/* ------------------------------------------------------------------ */
const PATTERNS = [
  {
    query: { src: '/drawing/assets/flange-q.webp', alt: 'サンプル図面: 円形フランジ 図番PB-2041', partNo: 'PB-2041', partName: '円形フランジ' },
    results: [
      { src: '/drawing/assets/flange-1.webp', score: 0.973, alt: 'サンプル図面: 円形フランジ 図番PB-2044' },
      { src: '/drawing/assets/flange-2.webp', score: 0.958, alt: 'サンプル図面: 円形フランジ 図番PB-2039' },
      { src: '/drawing/assets/flange-3.webp', score: 0.941, alt: 'サンプル図面: 円形フランジ 図番PB-2052' },
      { src: '/drawing/assets/flange-4.webp', score: 0.926, alt: 'サンプル図面: 円形フランジ 図番PB-2037' },
      { src: '/drawing/assets/flange-5.webp', score: 0.909, alt: 'サンプル図面: 円形フランジ 図番PB-2061' },
      { src: '/drawing/assets/flange-6.webp', score: 0.891, alt: 'サンプル図面: 円形フランジ 図番PB-2048' },
    ],
  },
  {
    query: { src: '/drawing/assets/bracket-q.webp', alt: 'サンプル図面: L字ブラケット 図番PB-3112', partNo: 'PB-3112', partName: 'L字ブラケット' },
    results: [
      { src: '/drawing/assets/bracket-1.webp', score: 0.968, alt: 'サンプル図面: L字ブラケット 図番PB-3115' },
      { src: '/drawing/assets/bracket-2.webp', score: 0.952, alt: 'サンプル図面: L字ブラケット 図番PB-3109' },
      { src: '/drawing/assets/bracket-3.webp', score: 0.937, alt: 'サンプル図面: L字ブラケット 図番PB-3121' },
      { src: '/drawing/assets/bracket-4.webp', score: 0.919, alt: 'サンプル図面: L字ブラケット 図番PB-3104' },
      { src: '/drawing/assets/bracket-5.webp', score: 0.902, alt: 'サンプル図面: L字ブラケット 図番PB-3130' },
      { src: '/drawing/assets/bracket-6.webp', score: 0.884, alt: 'サンプル図面: L字ブラケット 図番PB-3117' },
    ],
  },
  {
    query: { src: '/drawing/assets/plate-q.webp', alt: 'サンプル図面: 穴あきプレート 図番PB-4208', partNo: 'PB-4208', partName: '穴あきプレート' },
    results: [
      { src: '/drawing/assets/plate-1.webp', score: 0.958, alt: 'サンプル図面: 穴あきプレート 図番PB-4211' },
      { src: '/drawing/assets/plate-2.webp', score: 0.941, alt: 'サンプル図面: 穴あきプレート 図番PB-4205' },
      { src: '/drawing/assets/plate-3.webp', score: 0.923, alt: 'サンプル図面: 穴あきプレート 図番PB-4219' },
      { src: '/drawing/assets/plate-4.webp', score: 0.905, alt: 'サンプル図面: 穴あきプレート 図番PB-4201' },
      { src: '/drawing/assets/plate-5.webp', score: 0.887, alt: 'サンプル図面: 穴あきプレート 図番PB-4226' },
      { src: '/drawing/assets/plate-6.webp', score: 0.869, alt: 'サンプル図面: 穴あきプレート 図番PB-4214' },
    ],
  },
  {
    query: { src: '/drawing/assets/shaft-q.webp', alt: 'サンプル図面: 段付きシャフト 図番PB-5117', partNo: 'PB-5117', partName: '段付きシャフト' },
    results: [
      { src: '/drawing/assets/shaft-1.webp', score: 0.947, alt: 'サンプル図面: 段付きシャフト 図番PB-5119' },
      { src: '/drawing/assets/shaft-2.webp', score: 0.926, alt: 'サンプル図面: 段付きシャフト 図番PB-5114' },
      { src: '/drawing/assets/shaft-3.webp', score: 0.905, alt: 'サンプル図面: 段付きシャフト 図番PB-5123' },
      { src: '/drawing/assets/shaft-4.webp', score: 0.884, alt: 'サンプル図面: 段付きシャフト 図番PB-5108' },
      { src: '/drawing/assets/shaft-5.webp', score: 0.861, alt: 'サンプル図面: 段付きシャフト 図番PB-5131' },
      { src: '/drawing/assets/shaft-6.webp', score: 0.837, alt: 'サンプル図面: 段付きシャフト 図番PB-5121' },
    ],
  },
];

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ */
/* Hero pseudo-app: autoplay loop + click/keyboard override            */
/* ------------------------------------------------------------------ */
(function initHeroApp() {
  const queryBtn = document.getElementById('app-query');
  const queryImg = document.getElementById('app-query-img');
  const searchBtn = document.getElementById('app-search-btn');
  const fieldPartNoEl = document.getElementById('field-partno');
  const fieldPartNameEl = document.getElementById('field-partname');
  const appWindow = document.querySelector('.dw-app-window');
  const resultEls = Array.prototype.slice.call(document.querySelectorAll('.app-result'));
  const indicatorEls = Array.prototype.slice.call(document.querySelectorAll('.app-indicator'));
  if (!queryBtn || !queryImg || resultEls.length === 0) return;

  const CYCLE_MS = 5000;
  const FADE_MS = 350;

  let current = 0;
  let advanceTimer = null;
  let paused = false;

  // Preload every pattern's images up front so the autoplay loop never
  // shows a blank frame mid-cycle.
  PATTERNS.forEach(pattern => {
    [pattern.query.src].concat(pattern.results.map(r => r.src)).forEach(src => {
      const img = new Image();
      img.src = src;
    });
  });

  function animateScore(el, target) {
    if (prefersReducedMotion) {
      el.textContent = 'SCORE ' + target.toFixed(3);
      return;
    }
    const duration = 500;
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      el.textContent = 'SCORE ' + (target * t).toFixed(3);
      if (t < 1) window.requestAnimationFrame(step);
      else el.textContent = 'SCORE ' + target.toFixed(3);
    }
    window.requestAnimationFrame(step);
  }

  function applyContent(pattern) {
    queryImg.src = pattern.query.src;
    queryImg.alt = pattern.query.alt;
    if (fieldPartNoEl) fieldPartNoEl.textContent = pattern.query.partNo;
    if (fieldPartNameEl) fieldPartNameEl.textContent = pattern.query.partName;
    pattern.results.forEach((result, i) => {
      const el = resultEls[i];
      if (!el) return;
      const img = el.querySelector('img');
      const scoreEl = el.querySelector('.app-score');
      if (img) { img.src = result.src; img.alt = result.alt; }
      if (scoreEl) scoreEl.textContent = 'SCORE 0.000';
    });
  }

  function revealContent(pattern, animate) {
    if (!animate || prefersReducedMotion) {
      pattern.results.forEach((result, i) => {
        const el = resultEls[i];
        if (!el) return;
        const scoreEl = el.querySelector('.app-score');
        if (scoreEl) scoreEl.textContent = 'SCORE ' + result.score.toFixed(3);
      });
      return;
    }
    // query card: fade + translateY in
    queryBtn.classList.add('is-entering');
    // results: each card carries a CSS transition-delay derived from --i, so
    // toggling the class on all of them at once still reveals them staggered.
    resultEls.forEach(el => el.classList.add('is-entering'));

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        queryBtn.classList.remove('is-entering');
        resultEls.forEach(el => el.classList.remove('is-entering'));
      });
    });

    // Score count-up starts roughly when each card becomes visible.
    resultEls.forEach((el, i) => {
      window.setTimeout(() => {
        animateScore(el.querySelector('.app-score'), pattern.results[i].score);
      }, i * 90 + 120);
    });
  }

  function updateIndicators(index) {
    indicatorEls.forEach((el, i) => {
      el.setAttribute('aria-current', i === index ? 'true' : 'false');
    });
  }

  function scheduleAdvance() {
    window.clearTimeout(advanceTimer);
    if (prefersReducedMotion || paused) return;
    advanceTimer = window.setTimeout(() => {
      goTo(current + 1);
    }, CYCLE_MS);
  }

  function goTo(index, opts) {
    const isInitial = !!(opts && opts.initial);
    current = ((index % PATTERNS.length) + PATTERNS.length) % PATTERNS.length;
    const pattern = PATTERNS[current];
    updateIndicators(current);

    if (prefersReducedMotion) {
      applyContent(pattern);
      revealContent(pattern, false);
      scheduleAdvance();
      return;
    }

    if (isInitial) {
      applyContent(pattern);
      revealContent(pattern, true);
    } else {
      // crossfade: fade current content out, swap, fade new content in
      queryBtn.classList.add('is-entering');
      resultEls.forEach(el => el.classList.add('is-entering'));
      window.setTimeout(() => {
        applyContent(pattern);
        revealContent(pattern, true);
      }, FADE_MS);
    }
    scheduleAdvance();
  }

  queryBtn.addEventListener('click', () => goTo(current + 1));

  // Decorative "類似図面検索" button above the record fields: same action as
  // clicking the query drawing itself.
  if (searchBtn) {
    searchBtn.addEventListener('click', () => goTo(current + 1));
  }

  indicatorEls.forEach((el, i) => {
    el.addEventListener('click', () => goTo(i));
  });

  if (appWindow) {
    appWindow.addEventListener('mouseenter', () => {
      paused = true;
      window.clearTimeout(advanceTimer);
    });
    appWindow.addEventListener('mouseleave', () => {
      paused = false;
      scheduleAdvance();
    });
  }

  goTo(0, { initial: true });
})();

/* ------------------------------------------------------------------ */
/* Scroll reveal: IntersectionObserver fades [data-reveal] elements in */
/* ------------------------------------------------------------------ */
(function initScrollReveal() {
  const targets = document.querySelectorAll('[data-reveal]');
  if (targets.length === 0) return;

  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    targets.forEach(t => t.classList.add('is-revealed'));
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-revealed');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  targets.forEach(t => io.observe(t));
})();

/* ------------------------------------------------------------------ */
/* Verification stats: count up on scroll into view                    */
/* ------------------------------------------------------------------ */
(function initCountUp() {
  const targets = document.querySelectorAll('.dw-stat-value[data-count-to]');
  if (targets.length === 0) return;

  function format(value, el) {
    const decimals = parseInt(el.getAttribute('data-count-decimals') || '0', 10);
    const prefix = el.getAttribute('data-count-prefix') || '';
    const suffix = el.getAttribute('data-count-suffix') || '';
    const text = decimals > 0 ? value.toFixed(decimals) : Math.round(value).toLocaleString('ja-JP');
    return prefix + text + suffix;
  }

  function animate(el) {
    const target = parseFloat(el.getAttribute('data-count-to'));
    if (prefersReducedMotion || !('requestAnimationFrame' in window)) {
      el.textContent = format(target, el);
      return;
    }
    const duration = 800;
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      el.textContent = format(target * t, el);
      if (t < 1) window.requestAnimationFrame(step);
      else el.textContent = format(target, el);
    }
    window.requestAnimationFrame(step);
  }

  if (!('IntersectionObserver' in window)) {
    targets.forEach(animate);
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animate(entry.target);
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.4 });

  targets.forEach(t => io.observe(t));
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
    // ハニーポットはブラウザの自動入力(特にSafari)が値を入れてしまうことがあり、
    // 値が入っているとBrevoは成功を返しつつ登録を黙って破棄する。人間の送信では
    // 常に空が正なので、送信直前に必ず空へ戻す
    formData.set('email_address_check', '');
    // sibformsはmultipart/form-dataを受け付けないため、ホスト版フォームと同じ
    // application/x-www-form-urlencoded に変換して送る
    const body = new URLSearchParams();
    formData.forEach((value, key) => { body.append(key, String(value)); });

    const fail = () => {
      setMessage('送信できませんでした。少し時間をおいてもう一度お試しください');
      if (submitButton) submitButton.disabled = false;
    };
    const succeed = () => {
      try {
        history.pushState({}, '', '/drawing/thanks/');
      } catch (e) {
        /* ignore pushState failures (e.g. sandboxed preview) */
      }
      showSuccess();
    };

    // Brevoの公式埋め込みJSと同じ ?isAjax=1 のエンドポイントはCORSに対応して
    // おり、JSONで成否が返る。まずこちらで送信し、レスポンスを読んで判定する。
    // CORSがブロックされる環境ではno-cors送信にフォールバックし、従来どおり
    // 「通信が通れば成功」とみなす。
    fetch(BREVO_FORM_ACTION + (BREVO_FORM_ACTION.indexOf('?') === -1 ? '?isAjax=1' : '&isAjax=1'), {
      method: 'POST',
      body: body,
    }).then(res => res.json().then(data => ({ ok: res.ok, data })), err => Promise.reject(err))
      .then(({ ok, data }) => {
        if (ok && data && (data.success === true || data.success === undefined)) {
          succeed();
        } else {
          console.error('Brevo form rejected:', data);
          fail();
        }
      })
      .catch(err => {
        console.warn('Brevo ajax submit failed, falling back to no-cors:', err);
        fetch(BREVO_FORM_ACTION, { method: 'POST', mode: 'no-cors', body: body })
          .then(succeed)
          .catch(fail);
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
