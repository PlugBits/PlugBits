// キーを紛失した場合の再送フォーム(data-license-recover)を有効化する共通スクリプト。
// 対象: <form data-license-recover data-product="...">
//   - メール欄(input[type=email] または name="email")、送信ボタン、
//     aria-live="polite" なメッセージ要素(data-license-recover-message、無ければフォーム内の [aria-live])を想定
// 挙動:
//   - 送信時: ページ遷移をやめ、簡易チェックのうえ POST /recover { email, product }
//   - fetch が応答を返した場合(status に関わらず): 既存キーの有無を外に漏らさないため同じ文言を表示
//   - fetch 自体が失敗(ネットワークエラー等)した場合: 別の文言を表示
//   - 送信中はボタンを disabled にして多重送信を防ぐ
(function () {
  var ENDPOINT = "https://api.plugbits.app/recover";
  var MSG_SENT = "登録のメールアドレスに送りました。届かない場合は迷惑メールフォルダをご確認のうえ、support@plugbits.app までご連絡ください。";
  var MSG_ERROR = "送信できませんでした。時間をおいてもう一度お試しいただくか、support@plugbits.app までご連絡ください。";
  var MSG_INVALID = "メールアドレスの形式をご確認ください。";

  // ざっくりとしたメール形式チェック(厳密なRFC準拠は目的としない)
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  var forms = document.querySelectorAll("form[data-license-recover]");
  forms.forEach(function (form) {
    var emailInput = form.querySelector('input[type="email"], input[name="email"]');
    var submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
    var messageEl = form.querySelector("[data-license-recover-message]") || form.querySelector('[aria-live="polite"]');
    var product = form.getAttribute("data-product") || "";

    if (!emailInput || !messageEl) return;

    function showMessage(text) {
      messageEl.textContent = text;
    }

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();

      var email = (emailInput.value || "").trim();
      if (!EMAIL_RE.test(email)) {
        showMessage(MSG_INVALID);
        emailInput.focus();
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      showMessage("送信しています…");

      var body = { email: email };
      if (product) body.product = product;

      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }).then(function () {
        // キーの有無に関わらず同じ文言(存在有無を外に漏らさない)
        showMessage(MSG_SENT);
      }).catch(function () {
        showMessage(MSG_ERROR);
      }).finally(function () {
        if (submitBtn) submitBtn.disabled = false;
      });
    });
  });
})();
