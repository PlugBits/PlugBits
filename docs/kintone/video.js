// kintone 商品ページの主役動画(.hero-media__video)。5 本の商品ページで共通
//  - prefers-reduced-motion の人: 自動再生はしない。代わりに controls を出し、ポスターの上の「▶」で自分で再生できるようにする
//  - それ以外: 自動再生を試し、止められたら(省電力モード・拡張など) controls を出す
//  - 任意メディア(未着でも崩れない): 読み込みに失敗したら枠ごと隠す
(function () {
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var videos = document.querySelectorAll(".hero-media__video");
  videos.forEach(function (video) {
    if (reduceMotion) {
      video.removeAttribute("autoplay");
      video.pause();
      video.controls = true;
    } else {
      var p = video.play();
      if (p && typeof p.catch === "function") {
        p.catch(function () { video.controls = true; });
      }
    }
    var optionalWrap = video.closest("[data-optional-media]");
    if (optionalWrap) {
      video.addEventListener("error", function () {
        optionalWrap.hidden = true;
      }, true);
    }
  });
})();
