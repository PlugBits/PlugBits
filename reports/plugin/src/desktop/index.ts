const PLUGIN_ID = (window as any).kintone?.$PLUGIN_ID || '';

type PluginConfig = {
  apiBaseUrl: string;
  apiKey: string;
  kintoneApiToken: string;
  templateId: string;
  attachmentFieldCode: string;
};

const getConfig = (): PluginConfig | null => {
  if (!PLUGIN_ID) return null;
  const raw = (window as any).kintone?.plugin?.app?.getConfig(PLUGIN_ID);
  if (!raw) return null;
  return {
    apiBaseUrl: raw.apiBaseUrl ?? '',
    apiKey: raw.apiKey ?? '',
    kintoneApiToken: raw.kintoneApiToken ?? '',
    templateId: raw.templateId ?? '',
    attachmentFieldCode: raw.attachmentFieldCode ?? '',
  };
};

const createButton = (label: string) => {
  const button = document.createElement('button');
  button.textContent = label;
  button.className = 'kintoneplugin-button-normal plugbits-print-button';
  button.style.marginLeft = '8px';
  button.dataset.defaultLabel = label;
  button.dataset.loadingLabel = 'PDF生成中...';
  return button;
};

type ToastType = 'info' | 'success' | 'error';

const injectStyles = () => {
  if (document.getElementById('plugbits-style')) return;
  const style = document.createElement('style');
  style.id = 'plugbits-style';
  style.textContent = `
    .plugbits-toast-container {
      position: fixed;
      top: 16px;
      right: 24px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .plugbits-toast {
      min-width: 240px;
      padding: 10px 14px;
      border-radius: 6px;
      background: #111827;
      color: #fff;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      opacity: 0.98;
      transition: opacity 0.3s ease, transform 0.3s ease;
    }
    .plugbits-toast-success { background: #16a34a; }
    .plugbits-toast-error { background: #dc2626; }
    .plugbits-toast-hide { opacity: 0; transform: translateY(-6px); }
    .plugbits-spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      margin-right: 6px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.4);
      border-top-color: #fff;
      animation: plugbits-spin 0.8s linear infinite;
      vertical-align: middle;
    }
    @keyframes plugbits-spin {
      from { transform: rotate(0); }
      to { transform: rotate(360deg); }
    }
    .plugbits-banner {
      padding: 8px 12px;
      border-radius: 4px;
      margin-right: 12px;
      font-size: 12px;
      line-height: 1.4;
    }
    .plugbits-banner-error {
      background: #fee2e2;
      color: #991b1b;
      border: 1px solid #fecaca;
    }
  `;
  document.head.appendChild(style);
};

const getToastContainer = () => {
  injectStyles();
  let container = document.getElementById('plugbits-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'plugbits-toast-container';
    container.className = 'plugbits-toast-container';
    document.body.appendChild(container);
  }
  return container;
};

const showToast = (message: string, type: ToastType = 'info') => {
  try {
    const container = getToastContainer();
    const toast = document.createElement('div');
    toast.className = `plugbits-toast plugbits-toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('plugbits-toast-hide');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  } catch (error) {
    console.error('PlugBits toast failed', error);
    alert(message);
  }
};

const notify = (message: string, type: ToastType = 'info') => {
  showToast(message, type);
};

const showConfigWarning = (message: string) => {
  injectStyles();
  if (document.getElementById('plugbits-config-warning')) return;
  const toolbar = document.querySelector('.gaia-argoui-app-toolbar');
  const banner = document.createElement('div');
  banner.id = 'plugbits-config-warning';
  banner.className = 'plugbits-banner plugbits-banner-error';
  banner.textContent = message;
  if (toolbar) {
    toolbar.prepend(banner);
  } else {
    document.body.prepend(banner);
  }
};

const setButtonLoading = (button: HTMLButtonElement, loading: boolean) => {
  if (loading) {
    const label = button.dataset.loadingLabel ?? '処理中...';
    button.disabled = true;
    button.innerHTML = `<span class="plugbits-spinner" aria-hidden="true"></span>${label}`;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.defaultLabel ?? 'PDF出力';
  }
};

const isConfigComplete = (config: PluginConfig) =>
  Boolean(
    config.apiBaseUrl &&
      config.apiKey &&
      config.kintoneApiToken &&
      config.templateId &&
      config.attachmentFieldCode,
  );

const uploadFile = async (blob: Blob): Promise<string> => {
  const formData = new FormData();
  formData.append('file', blob);

  const response = await fetch('/k/v1/file.json', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ファイルアップロードに失敗しました: ${text}`);
  }

  const payload = await response.json();
  return payload.fileKey as string;
};

const updateRecordAttachment = async (
  recordId: string,
  attachmentFieldCode: string,
  fileKey: string,
) => {
  const response = await fetch('/k/v1/record.json', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app: (window as any).kintone?.app?.getId?.(),
      id: recordId,
      record: {
        [attachmentFieldCode]: {
          value: [
            {
              fileKey,
            },
          ],
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`レコード更新に失敗しました: ${text}`);
  }
};

const callRenderApi = async (config: PluginConfig, recordId: string): Promise<Blob> => {
  const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, '')}/render`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
    },
    body: JSON.stringify({
      templateId: config.templateId,
      kintone: {
        baseUrl: location.origin,
        appId: (window as any).kintone?.app?.getId?.(),
        recordId,
        apiToken: config.kintoneApiToken,
      },
    }),
  });

  if (!response.ok) {
    let message: string;
    try {
      const payload = (await response.json()) as { error?: string };
      message = payload.error ?? (await response.text());
    } catch {
      message = await response.text();
    }
    throw new Error(`PDF生成に失敗しました: ${message}`);
  }

  return response.blob();
};

const addButton = (config: PluginConfig) => {
  const toolbar = document.querySelector('.gaia-argoui-app-toolbar') || document.body;
  if (!toolbar) return;

  if (document.getElementById('plugbits-print-button')) return;

  const button = createButton('PDF出力 (PlugBits)');
  button.id = 'plugbits-print-button';
  button.addEventListener('click', async () => {
    const record = (window as any).kintone?.app?.record?.get()?.record;
    if (!record) {
      notify('レコード情報を取得できません');
      return;
    }

    const recordId = record.$id?.value;
    if (!recordId) {
      notify('レコードIDが取得できません');
      return;
    }

    setButtonLoading(button, true);

    try {
      const pdfBlob = await callRenderApi(config, recordId);
      const fileKey = await uploadFile(pdfBlob);
      await updateRecordAttachment(recordId, config.attachmentFieldCode, fileKey);
      notify('PDFを添付フィールドに保存しました', 'success');
      (window as any).kintone?.app?.record?.set(record);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'PDF生成に失敗しました', 'error');
    } finally {
      setButtonLoading(button, false);
    }
  });

  toolbar.appendChild(button);
};

const setupRecordDetailButton = () => {
  const config = getConfig();
  if (!config || !isConfigComplete(config)) {
    console.warn('PlugBits: プラグインが未設定です');
    showConfigWarning('PlugBits PDF: プラグインの設定が完了していません');
    return;
  }

  const events = ['app.record.detail.show'];
  (window as any).kintone?.events?.on(events, (event: any) => {
    addButton(config);
    return event;
  });
};

document.addEventListener('DOMContentLoaded', setupRecordDetailButton);
