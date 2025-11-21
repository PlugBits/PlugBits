const getPluginId = () => (window as any).kintone?.$PLUGIN_ID || '';

type PluginConfig = {
  apiBaseUrl: string;
  apiKey: string;
  templateId: string;
  attachmentFieldCode: string;
};

const buildInitialConfig = (): PluginConfig => ({
  apiBaseUrl: '',
  apiKey: '',
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
    templateId: rawConfig.templateId ?? '',
    attachmentFieldCode: rawConfig.attachmentFieldCode ?? '',
  };
};

const renderForm = () => {
  const container = document.getElementById('plugbits-plugin-config');
  if (!container) return;

  const config = loadConfig();

  container.innerHTML = `
    <h1>PlugBits 帳票プラグイン設定</h1>
    <div class="field-group">
      <label>API ベースURL</label>
      <input id="apiBaseUrl" type="text" placeholder="https://api.example.com" value="${config.apiBaseUrl}">
    </div>
    <div class="field-group">
      <label>API キー</label>
      <input id="apiKey" type="password" value="${config.apiKey}">
    </div>
    <div class="field-group">
      <label>テンプレートID</label>
      <input id="templateId" type="text" value="${config.templateId}">
    </div>
    <div class="field-group">
      <label>添付ファイルフィールドコード</label>
      <input id="attachmentFieldCode" type="text" value="${config.attachmentFieldCode}">
    </div>
    <div class="button-row">
      <button id="saveButton">保存</button>
      <button id="cancelButton" type="button">キャンセル</button>
    </div>
  `;

  const getInputValue = (id: string) => (document.getElementById(id) as HTMLInputElement)?.value.trim() || '';

  document.getElementById('saveButton')?.addEventListener('click', () => {
    const payload: PluginConfig = {
      apiBaseUrl: getInputValue('apiBaseUrl'),
      apiKey: getInputValue('apiKey'),
      templateId: getInputValue('templateId'),
      attachmentFieldCode: getInputValue('attachmentFieldCode'),
    };

    if (!payload.apiBaseUrl || !payload.templateId || !payload.attachmentFieldCode) {
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
  if ((window as any).kintone?.events?.on) {
    (window as any).kintone.events.on('app.plugin.settings.show', (event: any) => {
      renderForm();
      return event;
    });
  } else {
    document.addEventListener('DOMContentLoaded', renderForm);
  }
};

init();
