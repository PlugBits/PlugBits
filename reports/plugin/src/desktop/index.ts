const PLUGIN_ID =
  (typeof kintone !== 'undefined' ? (kintone as any).$PLUGIN_ID : '') || '';


import type { PluginConfig } from "../config/index.ts";

// ✅ 修正後
const getConfig = (): PluginConfig | null => {
  // TypeScript 的に型を逃がすためだけ any キャスト
  const raw =
    (kintone as any).plugin?.app?.getConfig(PLUGIN_ID) || {};

  // 設定が一切保存されていないときは null 扱い
  if (!raw || Object.keys(raw).length === 0) return null;

  const workerBaseUrl = raw.workerBaseUrl ?? raw.apiBaseUrl ?? '';
  const workerApiKey = raw.workerApiKey ?? raw.apiKey ?? '';

  return {
    workerBaseUrl,
    workerApiKey,
    kintoneApiToken: raw.kintoneApiToken ?? '',
    templateId: raw.templateId ?? '',
    attachmentFieldCode: raw.attachmentFieldCode ?? '',
    itemsTableFieldCode: raw.itemsTableFieldCode ?? '',
    itemNameFieldCode: raw.itemNameFieldCode ?? '',
    qtyFieldCode: raw.qtyFieldCode ?? '',
    unitPriceFieldCode: raw.unitPriceFieldCode ?? '',
    amountFieldCode: raw.amountFieldCode ?? '',
    apiBaseUrl: workerBaseUrl,
    apiKey: workerApiKey,
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

const getRequestToken = () =>
  (window as any).kintone?.getRequestToken?.() as string | undefined;


const isConfigComplete = (config: PluginConfig) =>
  Boolean(
    config.workerBaseUrl &&
      config.workerApiKey &&
      //config.kintoneApiToken &&
      config.templateId &&
      config.attachmentFieldCode &&
      config.itemsTableFieldCode &&
      config.itemNameFieldCode &&
      config.qtyFieldCode &&
      config.unitPriceFieldCode &&
      config.amountFieldCode,
  );

const uploadFile = async (blob: Blob): Promise<string> => {
  const formData = new FormData();

  // CSRFトークン（フォーム側にも入れておく）
  const token = getRequestToken();
  if (token) {
    formData.append('__REQUEST_TOKEN__', token);
  }

  // ファイル本体
  formData.append('file', blob, 'PlugBitsReport.pdf');

  // ← ここがポイント：X-Requested-With を付ける
  const headers: Record<string, string> = {
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (token) {
    headers['X-Cybozu-Request-Token'] = token;
  }

  const response = await fetch('/k/v1/file.json', {
    method: 'POST',
    headers,
    body: formData,          // Content-Type は書かない！
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('file.json error:', text);
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
  const token = getRequestToken();

  // 送信するJSONペイロード
  const payload: any = {
    app: (window as any).kintone?.app?.getId?.(),
    id: recordId,
    record: {
      [attachmentFieldCode]: {
        value: [
          {
            fileKey,
            name: 'PlugBitsReport.pdf',
          },
        ],
      },
    },
  };

  // ★ ここがポイント：CSRFトークンをボディに入れる
  if (token) {
    payload.__REQUEST_TOKEN__ = token;
  }

  const response = await fetch('/k/v1/record.json', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      // ← ここでは X-Cybozu-Request-Token は付けない（ボディ優先）
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('record.json error:', text);
    throw new Error(`レコード更新に失敗しました: ${text}`);
  }
};


function buildTemplateDataFromKintoneRecord(record: any) {
  const data: Record<string, any> = {};

  Object.keys(record).forEach((fieldCode) => {
    const field = record[fieldCode];
    if (!field) return;

    if (field.type === "SUBTABLE") {
      data[fieldCode] = field.value.map((row: any) => {
        const rowData: Record<string, any> = {};
        Object.keys(row.value).forEach((innerCode) => {
          const innerField = row.value[innerCode];
          rowData[innerCode] = innerField?.value;
        });
        return rowData;
      });
    } else {
      data[fieldCode] = field.value;
    }
  });

  return data;
}

const normalizeItemsFromConfig = (
  record: any,
  config: PluginConfig,
  templateData: Record<string, any>,
): { ok: boolean; data?: Record<string, any> } => {
  const subtableField = record?.[config.itemsTableFieldCode];
  if (!subtableField || subtableField.type !== 'SUBTABLE' || !Array.isArray(subtableField.value)) {
    alert('明細サブテーブルの設定が正しくありません。設定画面でフィールドコードを確認してください。');
    return {
      ok: false,
      data: {
        ...templateData,
        Items: [],
      },
    };
  }

  const safeValue = (value: unknown) => (value === null || value === undefined ? '' : String(value));

  const items = subtableField.value.map((row: any) => {
    const cells = row?.value ?? {};
    return {
      ItemName: safeValue(cells[config.itemNameFieldCode]?.value),
      Qty: safeValue(cells[config.qtyFieldCode]?.value),
      UnitPrice: safeValue(cells[config.unitPriceFieldCode]?.value),
      Amount: safeValue(cells[config.amountFieldCode]?.value),
    };
  });

  return {
    ok: true,
    data: {
      ...templateData,
      Items: items,
    },
  };
};

const callRenderApi = async (
  config: PluginConfig,
  recordId: string,
  templateData: any,
): Promise<Blob> => {
  const baseUrl = config.workerBaseUrl || config.apiBaseUrl || '';
  const apiKey = config.workerApiKey || config.apiKey || '';
  if (!baseUrl) {
    throw new Error('設定エラー: Worker ベースURLが未設定です');
  }
  if (!apiKey) {
    throw new Error('設定エラー: Worker APIキーが未設定です');
  }
  const appId = (window as any).kintone?.app?.getId?.();
  const appIdValue = appId ? String(appId) : '';
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/render`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      templateId: config.templateId,
      data: templateData,
      kintone: {
        baseUrl: location.origin,
        appId: appIdValue,
        recordId,
        apiToken: config.kintoneApiToken,
        kintoneApiToken: config.kintoneApiToken,
      },
    }),
  });

  if (!response.ok) {
    // ★ body は一度だけ読む
    let message = '';
    try {
      const text = await response.text();
      try {
        const payload = JSON.parse(text) as { error?: string };
        message = payload.error ?? text;
      } catch {
        message = text || 'Unknown error';
      }
    } catch {
      message = 'Unknown error (failed to read response body)';
    }

    if (message.includes('Unknown user templateId')) {
      console.info('[PlugBits] render context', {
        workerBaseUrl: baseUrl,
        kintoneBaseUrl: location.origin,
        appId: appIdValue,
        templateId: config.templateId,
      });
      message = `${message}\nこのテンプレは現在のWorker環境に存在しません。プラグイン設定のWorkerベースURLと、エディタの保存先が一致しているか確認してください。`;
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

    const templateData = buildTemplateDataFromKintoneRecord(record);
    const normalized = normalizeItemsFromConfig(record, config, templateData);
    if (!normalized.ok || !normalized.data) {
      setButtonLoading(button, false);
      return;
    }
    console.log('PlugBits templateData:', normalized.data);
    setButtonLoading(button, true);

    try {
      const pdfBlob = await callRenderApi(config, recordId, normalized.data);

      // ① PDF表示
      const url = URL.createObjectURL(pdfBlob);
      window.open(url, "_blank");

      // ここから添付処理 --------------------
      console.log('PlugBits: start upload');  // ← デバッグ用

      const fileKey = await uploadFile(pdfBlob);
      console.log('PlugBits: fileKey', fileKey);

      await updateRecordAttachment(recordId, config.attachmentFieldCode, fileKey);
      console.log('PlugBits: record updated');

      notify('PDFを添付フィールドに保存しました', 'success');

      // 画面リロード（添付を反映）
      location.reload();
      // -----------------------------------
    } catch (error) {
      console.error(error);
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
