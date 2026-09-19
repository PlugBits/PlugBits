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
    var scenesRoot = document.getElementById('scenes');
    if (!scenesRoot) return;   // /cards ページにはこの id が無い。何もしない

    var calendarIndexEl = document.getElementById('deals-calendar-index');
    var calendarIndex = {};
    try { calendarIndex = JSON.parse(calendarIndexEl.textContent) || {}; } catch (e) { calendarIndex = {}; }

    var state = { activeTab: 'all', activeDate: null, saved: personalApi.savedGet() };

    function tabByKey(key) {
      for (var i = 0; i < TABS.length; i++) { if (TABS[i].key === key) return TABS[i]; }
      return TABS[0];
    }

    function applyFilters() {
      var tab = tabByKey(state.activeTab);
      var dateIds = state.activeDate ? (calendarIndex[state.activeDate] || []) : null;
      var dateSet = null;
      if (dateIds) { dateSet = {}; dateIds.forEach(function (id) { dateSet[id] = true; }); }
      document.querySelectorAll('.scene-section').forEach(function (sec) {
        var sceneKey = sec.getAttribute('data-scene');
        var showSection = !tab.scene || sceneKey === tab.scene;
        sec.hidden = !showSection;
        if (!showSection) return;
        var anyVisible = false;
        sec.querySelectorAll('.card').forEach(function (card) {
          var id = card.getAttribute('data-id');
          var show = !dateSet || !!dateSet[id];
          card.hidden = !show;
          if (show) anyVisible = true;
        });
        var note = sec.querySelector('.empty-note');
        var cardsWrap = sec.querySelector('.cards');
        var hasAnyCard = cardsWrap && cardsWrap.querySelector('.card');
        if (note && hasAnyCard) note.hidden = anyVisible;
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
        var master = document.querySelector('.scene-section .card[data-id="' + id + '"]');
        if (!master) return;
        var clone = master.cloneNode(true);
        clone.hidden = false;
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
      var openEl = document.querySelector('.scene-section [data-detail-for="' + id + '"]') ||
        document.querySelector('[data-detail-for="' + id + '"]');
      var open = openEl ? !openEl.hidden : false;
      document.querySelectorAll('.detail-link[data-id="' + id + '"]').forEach(function (btn) {
        btn.innerHTML = (open ? '閉じる' : 'くわしく') + '<span class="chev">' + (open ? '‹' : '›') + '</span>';
      });
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

    state.saved.forEach(function (id) { setHeart(id, true); });
    renderSaved();
    applyFilters();

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
