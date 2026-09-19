// お得トップ(/deals/)の公開サイト用JS。tiny-pulse には一切アクセスしない
// (fetchを一つも行わない。データは export 時点で index.html に焼き込み済みのDOM/HTMLだけを見る)。
(function () {
  'use strict';
  var SAVED_KEY = 'pb_deals_saved_v1';

  function readSaved() {
    try {
      var raw = localStorage.getItem(SAVED_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function writeSaved(ids) {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(ids)); } catch (e) { /* ignore */ }
  }

  var calendarIndexEl = document.getElementById('deals-calendar-index');
  var calendarIndex = {};
  try { calendarIndex = JSON.parse(calendarIndexEl.textContent) || {}; } catch (e) { calendarIndex = {}; }

  var tabsData = [{"key": "all", "label": "すべて", "scene": null}, {"key": "food", "label": "外食", "scene": "外食テイクアウト"}, {"key": "grocery", "label": "食料品・日用品", "scene": "食料品日用品"}, {"key": "kids", "label": "子ども", "scene": "子どもファミリー"}, {"key": "free", "label": "無料", "scene": "無料でもらえる"}, {"key": "clothes", "label": "服・くつ", "scene": "服くつ"}];

  var state = { activeTab: 'all', activeDate: null, saved: readSaved() };

  function tabByKey(key) {
    for (var i = 0; i < tabsData.length; i++) { if (tabsData[i].key === key) return tabsData[i]; }
    return tabsData[0];
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
    document.querySelectorAll('.date-chip').forEach(function (chip, idx) {
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
      btn.textContent = on ? '\u2665' : '\u2661';
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
    writeSaved(state.saved);
    setHeart(id, on);
    renderSaved();
  }

  function toggleDetail(id) {
    document.querySelectorAll('[data-detail-for="' + id + '"]').forEach(function (el) { el.hidden = !el.hidden; });
    var openEl = document.querySelector('.scene-section [data-detail-for="' + id + '"]') ||
      document.querySelector('[data-detail-for="' + id + '"]');
    var open = openEl ? !openEl.hidden : false;
    document.querySelectorAll('.detail-link[data-id="' + id + '"]').forEach(function (btn) {
      btn.innerHTML = (open ? '閉じる' : 'くわしく') + '<span class="chev">' + (open ? '\u2039' : '\u203a') + '</span>';
    });
  }

  function selectTab(key) { state.activeTab = key; renderTabs(); applyFilters(); }
  function selectDate(dateStr) {
    state.activeDate = (state.activeDate === dateStr) ? null : dateStr;
    renderDateStrip(); applyFilters();
  }

  // 公式ページを見る、のクリックを「仮想ページビュー」として記録する。/drawing/demo の
  // pushState 規約(URLは戻さない・CFのbeaconがHistory APIの変化を拾う)にならう。
  // 実際のリンク遷移(target=_blank)はブラウザ標準の挙動に任せ、preventDefault はしない。
  function trackOutbound(slug) {
    try { history.pushState({}, '', '/deals/out/' + slug + '/'); } catch (e) { /* ignore */ }
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
})();
