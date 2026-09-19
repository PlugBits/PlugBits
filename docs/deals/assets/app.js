// web/app.js — お得(/deals)・カードページの共有クライアントロジック。
// mode(document.body.dataset.mode)は "public"(公開サイト、fetch無し・データは埋め込み済み)と
// "local"(司令室、web/personal.js が追加の個人機能を足す)の両方で同じこのファイルを読む。
// このファイルには個人データへの参照(fetch /api/... 等)を一切書かない。個人データは
// window.personalApi(既定はlocalStorageだけの実装。mode=local では personal.js が上書きする)
// を通してだけ触る。これが「一つの層」(personalApi)を守るための境界線。
(function () {
  'use strict';

  // ---------------- personalApi: 既定は localStorage(公開版のデフォルト実装) ----------------
  window.personalApi = window.personalApi || {
    savedGet: function () {
      try {
        var raw = localStorage.getItem('pb_deals_saved_v1');
        var arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
      } catch (e) { return []; }
    },
    savedSet: function (ids) {
      try { localStorage.setItem('pb_deals_saved_v1', JSON.stringify(ids)); } catch (e) { /* ignore */ }
    },
    // 単品特価を既定で畳まず常に表示するか(v2, 2026-09-19)。公開サイトは端末のlocalStorageだけ。
    singlesAlwaysGet: function () {
      try { return localStorage.getItem('pb_deals_singles_always_v1') === '1'; } catch (e) { return false; }
    },
    singlesAlwaysSet: function (on) {
      try { localStorage.setItem('pb_deals_singles_always_v1', on ? '1' : '0'); } catch (e) { /* ignore */ }
    },
  };

  var TABS = [
    { key: 'all', label: 'すべて', scene: null },
    { key: 'food', label: '外食', scene: '外食テイクアウト' },
    { key: 'grocery', label: '食料品・日用品', scene: '食料品日用品' },
    { key: 'kids', label: '子ども', scene: '子どもファミリー' },
    { key: 'free', label: '無料', scene: '無料でもらえる' },
    { key: 'clothes', label: '服・くつ', scene: '服くつ' },
  ];

  function initDealsPage() {
    var tabsWrap = document.getElementById('tabs-wrap');
    if (!tabsWrap) return;   // /cards ページにはこの id が無い。何もしない

    var calendarIndexEl = document.getElementById('deals-calendar-index');
    var calendarIndex = {};
    try { calendarIndex = JSON.parse(calendarIndexEl.textContent) || {}; } catch (e) { calendarIndex = {}; }

    var state = { activeTab: 'all', activeDate: null, saved: personalApi.savedGet() };

    function tabByKey(key) {
      for (var i = 0; i < TABS.length; i++) { if (TABS[i].key === key) return TABS[i]; }
      return TABS[0];
    }

    // v2(2026-09-19): セクションは時間軸(今日やること/今週/先の予定)なので、絞り込みは
    // カード単位(.card[data-scene]・.bundle-item[data-scene])で行う。バンドルは中の1件でも
    // 見えていれば表示し、全部隠れたら畳む。セクションはカードが1件も残らなければ丸ごと隠す
    // (ただし「今日やることはありません」等の空文言だけの節=.cards が無い節はそのまま触らない)。
    function applyFilters() {
      var tab = tabByKey(state.activeTab);
      var dateIds = state.activeDate ? (calendarIndex[state.activeDate] || []) : null;
      var dateSet = null;
      if (dateIds) { dateSet = {}; dateIds.forEach(function (id) { dateSet[id] = true; }); }
      document.querySelectorAll('.card[data-id], .bundle-item[data-id]').forEach(function (el) {
        var id = el.getAttribute('data-id');
        var scene = el.getAttribute('data-scene') || '';
        var sceneOk = !tab.scene || scene.indexOf(tab.scene) !== -1;
        var dateOk = !dateSet || !!dateSet[id];
        el.hidden = !(sceneOk && dateOk);
      });
      document.querySelectorAll('.store-bundle').forEach(function (bundle) {
        var anyVisible = false;
        bundle.querySelectorAll('.bundle-item').forEach(function (bi) { if (!bi.hidden) anyVisible = true; });
        bundle.hidden = !anyVisible;
      });
      ['section-today', 'section-week', 'section-later'].forEach(function (id) {
        var sec = document.getElementById(id);
        if (!sec) return;
        var cardsWrap = sec.querySelector('.cards');
        if (!cardsWrap) return;   // 元々0件で空文言だけの節はそのまま(絞り込みでは触らない)
        var anyVisible = false;
        cardsWrap.querySelectorAll(':scope > .card, :scope > .store-bundle').forEach(function (c) {
          if (!c.hidden) anyVisible = true;
        });
        sec.hidden = !anyVisible;
      });
    }

    function renderTabs() {
      document.querySelectorAll('.tab-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === state.activeTab);
      });
    }

    function renderDateStrip() {
      document.querySelectorAll('.date-chip').forEach(function (chip) {
        chip.classList.toggle('selected', chip.getAttribute('data-date') === state.activeDate);
      });
      var chipWrap = document.getElementById('filter-chip-wrap');
      var chip = document.getElementById('filter-chip');
      if (!state.activeDate) { chipWrap.hidden = true; return; }
      var btn = document.querySelector('.date-chip[data-date="' + state.activeDate + '"]');
      var md = btn ? btn.querySelector('.md').textContent : state.activeDate;
      chip.textContent = md + 'で絞り込み中 ✕';
      chipWrap.hidden = false;
    }

    function setHeart(id, on) {
      document.querySelectorAll('.heart-btn[data-id="' + id + '"]').forEach(function (btn) {
        btn.classList.toggle('on', on);
        btn.textContent = on ? '♥' : '♡';
      });
    }

    function renderSaved() {
      var wrap = document.getElementById('saved-cards');
      var empty = document.getElementById('saved-empty');
      if (!wrap) return;
      wrap.innerHTML = '';
      var any = false;
      state.saved.forEach(function (id) {
        var master = document.querySelector('#section-today .card[data-id="' + id + '"], ' +
          '#section-week .card[data-id="' + id + '"], #section-week .bundle-item[data-id="' + id + '"], ' +
          '#section-later .card[data-id="' + id + '"], #section-singles .card[data-id="' + id + '"]');
        if (!master) return;
        var clone = master.cloneNode(true);
        clone.hidden = false;
        clone.classList.remove('bundle-item');
        clone.classList.add('card');
        wrap.appendChild(clone);
        any = true;
      });
      if (empty) empty.hidden = any;
    }

    function toggleSaved(id) {
      var on = state.saved.indexOf(id) === -1;
      if (on) { state.saved.push(id); } else { state.saved = state.saved.filter(function (x) { return x !== id; }); }
      personalApi.savedSet(state.saved);
      setHeart(id, on);
      renderSaved();
    }

    function toggleDetail(id) {
      document.querySelectorAll('[data-detail-for="' + id + '"]').forEach(function (el) { el.hidden = !el.hidden; });
      var openEl = document.querySelector('[data-detail-for="' + id + '"]');
      var open = openEl ? !openEl.hidden : false;
      document.querySelectorAll('.detail-link[data-id="' + id + '"]').forEach(function (btn) {
        btn.innerHTML = (open ? '閉じる' : 'くわしく') + '<span class="chev">' + (open ? '‹' : '›') + '</span>';
      });
    }

    // ---------------- 単品特価「次回から常に表示する」設定(v2, 2026-09-19) ----------------
    function applySinglesPref() {
      var det = document.getElementById('section-singles');
      if (!det) return;
      var show = personalApi.singlesAlwaysGet ? personalApi.singlesAlwaysGet() : false;
      det.open = show;
      var cb = document.getElementById('singles-always-show');
      if (cb) cb.checked = show;
    }

    function selectTab(key) { state.activeTab = key; renderTabs(); applyFilters(); }
    function selectDate(dateStr) {
      state.activeDate = (state.activeDate === dateStr) ? null : dateStr;
      renderDateStrip(); applyFilters();
    }

    // 公式ページを見る、のクリックを「仮想ページビュー」として記録する(実際のリンク遷移は
    // ブラウザ標準の挙動に任せ、preventDefault はしない)
    function trackOutbound(slug) {
      try { history.pushState({}, '', (location.pathname.indexOf('/deals') === 0 ? '/deals' : '') + '/out/' + slug + '/'); } catch (e) { /* ignore */ }
    }

    document.addEventListener('click', function (e) {
      var tabBtn = e.target.closest('.tab-btn');
      if (tabBtn) { selectTab(tabBtn.getAttribute('data-tab')); return; }
      var chip = e.target.closest('.date-chip');
      if (chip) { selectDate(chip.getAttribute('data-date')); return; }
      var clearChip = e.target.closest('#filter-chip');
      if (clearChip) { selectDate(state.activeDate); return; }
      var heart = e.target.closest('[data-action="heart"]');
      if (heart) { toggleSaved(heart.getAttribute('data-id')); return; }
      var detail = e.target.closest('[data-action="detail"]');
      if (detail) { toggleDetail(detail.getAttribute('data-id')); return; }
      var official = e.target.closest('.official');
      if (official) { trackOutbound(official.getAttribute('data-out-slug') || 'unknown'); return; }
    });
    document.addEventListener('change', function (e) {
      var cb = e.target.closest('#singles-always-show');
      if (!cb) return;
      if (personalApi.singlesAlwaysSet) personalApi.singlesAlwaysSet(cb.checked);
      var det = document.getElementById('section-singles');
      if (det) det.open = cb.checked;
    });

    state.saved.forEach(function (id) { setHeart(id, true); });
    renderSaved();
    applyFilters();
    applySinglesPref();

    // mode=local: personal.js がサーバーから saved を取り直したら呼ぶ再同期フック
    window.tpApp = window.tpApp || {};
    window.tpApp.refreshSaved = function () {
      state.saved = personalApi.savedGet();
      state.saved.forEach(function (id) { setHeart(id, true); });
      renderSaved();
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDealsPage);
  } else {
    initDealsPage();
  }
})();
