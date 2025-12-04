const getPluginId = () => (window as any).kintone?.$PLUGIN_ID || '';

type PluginConfig = {
  apiBaseUrl: string;
  apiKey: string;
  kintoneApiToken: string;
  templateId: string;
  attachmentFieldCode: string;
};

const buildInitialConfig = (): PluginConfig => ({
  apiBaseUrl: '',
  apiKey: '',
  kintoneApiToken: '',
  templateId: '',
  attachmentFieldCode: '',
});

const loadConfig = (): PluginConfig => {
  const pluginId = getPluginId();
  if (!pluginId) {
    return buildInitialConfig();
  }

  const rawConfig = (window as any).kintone?.plugin?.app?.getConfig(pluginId) || {};
  return {
    apiBaseUrl: rawConfig.apiBaseUrl ?? '',
    apiKey: rawConfig.apiKey ?? '',
    kintoneApiToken: rawConfig.kintoneApiToken ?? '',
    templateId: rawConfig.templateId ?? '',
    attachmentFieldCode: rawConfig.attachmentFieldCode ?? '',
  };
};

const renderForm = () => {
  const container = document.getElementById('plugbits-plugin-config');
  if (!container) return;

  const config = loadConfig();

  container.innerHTML = `
    <h1 class="kb-title">PlugBits 帳票プラグイン設定</h1>
    <p class="kb-desc">
      Cloudflare Workers で稼働する PlugBits Reports API の接続情報と、生成した PDF
      を添付するフィールドコードを入力してください。
    </p>

    <label class="kb-label" for="apiBaseUrl">API ベースURL</label>
    <input class="kb-input" id="apiBaseUrl" type="text" placeholder="https://example.workers.dev" />

    <label class="kb-label" for="apiKey">API キー</label>
    <input class="kb-input" id="apiKey" type="password" />

    <label class="kb-label" for="kintoneApiToken">kintone APIトークン</label>
    <input class="kb-input" id="kintoneApiToken" type="password" placeholder="REST API用のトークン" />

    <label class="kb-label" for="templateId">テンプレートID</label>
    <input class="kb-input" id="templateId" type="text" />

    <label class="kb-label" for="attachmentFieldCode">添付ファイルフィールドコード</label>
    <input class="kb-input" id="attachmentFieldCode" type="text" placeholder="attachment" />

    <div class="kb-row kb-toolbar">
      <button id="saveButton" class="kb-btn kb-primary" type="button">保存</button>
      <button id="cancelButton" class="kb-btn" type="button">キャンセル</button>
    </div>
  `;

  const setInputValue = (id: string, value: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = value;
  };
  setInputValue('apiBaseUrl', config.apiBaseUrl);
  setInputValue('apiKey', config.apiKey);
  setInputValue('kintoneApiToken', config.kintoneApiToken);
  setInputValue('templateId', config.templateId);
  setInputValue('attachmentFieldCode', config.attachmentFieldCode);

  const getInputValue = (id: string) => (document.getElementById(id) as HTMLInputElement)?.value.trim() || '';

  document.getElementById('saveButton')?.addEventListener('click', () => {
    const payload: PluginConfig = {
      apiBaseUrl: getInputValue('apiBaseUrl'),
      apiKey: getInputValue('apiKey'),
      kintoneApiToken: getInputValue('kintoneApiToken'),
      templateId: getInputValue('templateId'),
      attachmentFieldCode: getInputValue('attachmentFieldCode'),
    };

    if (
      !payload.apiBaseUrl ||
      !payload.apiKey ||
      !payload.kintoneApiToken ||
      !payload.templateId ||
      !payload.attachmentFieldCode
    ) {
      alert('必須項目が未入力です');
      return;
    }

    const pluginId = getPluginId();
    if (!pluginId) {
      alert('プラグインIDが検出できませんでした');
      return;
    }

    (window as any).kintone?.plugin?.app?.setConfig(payload);
  });

  document.getElementById('cancelButton')?.addEventListener('click', () => {
    history.back();
  });
};

const init = () => {
  const start = () => renderForm();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
};

init();
