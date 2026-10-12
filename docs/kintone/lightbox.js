/* PlugBits kintone 商品ページ: 自前のライトボックス(外部ライブラリなし)
   data-zoom 付きの img をクリック/Enterで暗幕に全画面拡大。
   暗幕クリック・Esc・閉じるボタンで閉じる。閉じたら元のトリガーへフォーカスを戻す。 */
(function () {
  var triggers = document.querySelectorAll("img[data-zoom]");
  if (!triggers.length) return;

  // 各画像を button で包んでキーボード操作(Enter/Space)でも開けるようにする
  triggers.forEach(function (img) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "zoom-trigger";
    btn.setAttribute("aria-label", "拡大表示: " + (img.alt || "画像"));
    img.parentNode.insertBefore(btn, img);
    btn.appendChild(img);
    btn.addEventListener("click", function () {
      openLightbox(img, btn);
    });
  });

  var overlay = document.createElement("div");
  overlay.className = "lightbox";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML =
    '<button class="lightbox__backdrop" type="button" aria-label="閉じる"></button>' +
    '<figure class="lightbox__figure">' +
      '<img class="lightbox__img" alt="">' +
      '<figcaption class="lightbox__caption"></figcaption>' +
    '</figure>' +
    '<button class="lightbox__close" type="button" aria-label="閉じる">×</button>';
  document.body.appendChild(overlay);

  var backdrop = overlay.querySelector(".lightbox__backdrop");
  var closeBtn = overlay.querySelector(".lightbox__close");
  var bigImg = overlay.querySelector(".lightbox__img");
  var caption = overlay.querySelector(".lightbox__caption");
  var lastTrigger = null;

  // 開いている間は後ろのページを動かさない。iOS Safari は overflow:hidden だけでは止まらないので
  // body を fixed にして今の位置で止め、閉じたら元の位置へ戻す。touchmove も暗幕の上では止める
  var savedScrollY = 0;
  function preventTouch(e) { e.preventDefault(); }
  function lockScroll() {
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    var b = document.body.style;
    b.position = "fixed";
    b.top = -savedScrollY + "px";
    b.left = "0";
    b.right = "0";
    b.overflow = "hidden";
    overlay.addEventListener("touchmove", preventTouch, { passive: false });
  }
  function unlockScroll() {
    var b = document.body.style;
    b.position = "";
    b.top = "";
    b.left = "";
    b.right = "";
    b.overflow = "";
    window.scrollTo(0, savedScrollY);
    overlay.removeEventListener("touchmove", preventTouch);
  }

  function openLightbox(img, trigger) {
    lastTrigger = trigger;
    bigImg.src = img.currentSrc || img.src;
    bigImg.alt = img.alt || "";
    caption.textContent = img.alt || "";
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    lockScroll();
    closeBtn.focus();
    document.addEventListener("keydown", onKeydown, true);
  }

  function closeLightbox() {
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    unlockScroll();
    bigImg.src = "";
    document.removeEventListener("keydown", onKeydown, true);
    if (lastTrigger) lastTrigger.focus();
  }

  function onKeydown(e) {
    if (e.key === "Escape" || e.key === "Esc") {
      e.preventDefault();
      closeLightbox();
    }
  }

  backdrop.addEventListener("click", closeLightbox);
  closeBtn.addEventListener("click", closeLightbox);
})();
