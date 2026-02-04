import { UI_BASE_URL, WORKER_BASE_URL } from '../constants';
import type { PluginConfig } from '../config/index.ts';

const PLUGIN_ID =
  (typeof kintone !== 'undefined' ? (kintone as any).$PLUGIN_ID : '') || '';

// ✅ 修正後
const getConfig = (): PluginConfig | null => {
  const raw =
    (kintone as any).plugin?.app?.getConfig(PLUGIN_ID) || {};

  if (!raw || Object.keys(raw).length === 0) return null;

  return {
    templateId: raw.templateId ?? '',
    attachmentFieldCode: raw.attachmentFieldCode ?? '',
  };
};


const createButton = (label: string) => {
  const button = document.createElement('button');
  button.textContent = label;
  button.className = 'kintoneplugin-button-normal plugbits-print-button plugbits-pdf-btn';
  button.style.marginLeft = '8px';
  button.dataset.defaultLabel = label;
  button.dataset.loadingLabel = '出力中...';
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
    .plugbits-pdf-btn {
      background: #2563eb;
      color: #fff;
      border: 1px solid #1d4ed8;
      border-radius: 6px;
      padding: 6px 12px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08);
      transition: background 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
    }
    .plugbits-pdf-btn:hover:not(:disabled) {
      background: #1d4ed8;
    }
    .plugbits-pdf-btn:active:not(:disabled) {
      background: #1e40af;
      transform: translateY(1px);
      box-shadow: 0 0 0 rgba(16, 24, 40, 0.08);
    }
    .plugbits-pdf-btn:disabled {
      background: #9ca3af;
      border-color: #9ca3af;
      cursor: not-allowed;
      opacity: 0.9;
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
  Boolean(config.templateId && config.attachmentFieldCode);

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

const callRenderApi = async (
  config: PluginConfig,
  recordId: string,
  templateData: any,
): Promise<Blob> => {
  const baseUrl = WORKER_BASE_URL;
  const appId = (window as any).kintone?.app?.getId?.();
  const appIdValue = appId ? String(appId) : '';
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/render`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      templateId: config.templateId,
      data: templateData,
      kintone: {
        baseUrl: location.origin,
        appId: appIdValue,
        recordId,
      },
    }),
  });

  if (!response.ok) {
    let text = '';
    try {
      text = await response.text();
    } catch {
      text = '';
    }
    let message = '';
    const textLower = text.toLowerCase();
    const isTemplateInactive =
      response.status >= 400 &&
      response.status < 500 &&
      (textLower.includes('not active') || textLower.includes('not found'));

    if (isTemplateInactive) {
      message = 'テンプレが削除/無効です。プラグイン設定で再選択してください';
    } else if (text.includes('Unknown user templateId')) {
      console.info('[PlugBits] render context', {
        workerBaseUrl: baseUrl,
        kintoneBaseUrl: location.origin,
        appId: appIdValue,
        recordId,
        templateId: config.templateId,
      });
      message = 'テンプレが見つかりません（保存先のWorker/テナントが違う可能性）';
    } else if (response.status === 400) {
      const detail = text || '不明なエラー';
      message = `テンプレ設定が不正です（templateId / 必須フィールド / tenant情報）。詳細: ${detail}`;
    } else if (response.status === 401 || response.status === 403) {
      message = '認証に失敗しました。';
    } else if (response.status === 404) {
      message = 'テンプレが見つかりません（templateId が存在しない可能性）。';
    } else if (response.status === 500) {
      message = 'サーバー側でPDF生成に失敗しました。少し時間をおいて再試行してください。';
    } else {
      message = text || `PDF生成に失敗しました（${response.status}）`;
    }

    throw new Error(message);
  }

  return response.blob();
};

const checkTemplateAvailability = async (config: PluginConfig): Promise<boolean> => {
  const baseUrl = WORKER_BASE_URL.replace(/\/$/, '');
  const templateId = config.templateId;
  if (!templateId) {
    alert('テンプレートが未選択です');
    return false;
  }
  const appId = (window as any).kintone?.app?.getId?.();
  if (!appId) {
    alert('アプリIDが取得できません');
    return false;
  }
  const params = new URLSearchParams({
    kintoneBaseUrl: location.origin,
    appId: String(appId),
  });
  if (templateId.startsWith('tpl_')) {
    params.set('requireActive', '1');
  }
  const url = `${baseUrl}/templates/${encodeURIComponent(templateId)}?${params.toString()}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) return true;
    const text = await res.text().catch(() => '');
    if (res.status === 404 || res.status === 410 || text.includes('not active') || text.includes('not found')) {
      alert('テンプレが無効です。プラグイン設定画面でテンプレを選び直してください。');
      return false;
    }
    alert(text || 'テンプレ確認に失敗しました。プラグイン設定で再選択してください');
    return false;
  } catch {
    alert('テンプレ確認に失敗しました。プラグイン設定で再選択してください');
    return false;
  }
};

const addButton = (config: PluginConfig) => {
  const headerMenuSpace =
    (window as any).kintone?.app?.record?.getHeaderMenuSpaceElement?.() || null;
  const toolbar = headerMenuSpace || document.querySelector('.gaia-argoui-app-toolbar') || document.body;
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

    const templateOk = await checkTemplateAvailability(config);
    if (!templateOk) return;

    const templateData = buildTemplateDataFromKintoneRecord(record);
    console.log('PlugBits templateData:', templateData);
    setButtonLoading(button, true);

    try {
      const pdfBlob = await callRenderApi(config, recordId, templateData);

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

  const printButton = createButton('印刷');
  printButton.id = 'plugbits-print-only-button';
  printButton.addEventListener('click', async () => {
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

    const templateOk = await checkTemplateAvailability(config);
    if (!templateOk) return;

    const appId = (window as any).kintone?.app?.getId?.();
    const appIdValue = appId ? String(appId) : '';
    const params = new URLSearchParams({
      workerBaseUrl: WORKER_BASE_URL,
      kintoneBaseUrl: location.origin,
      appId: appIdValue,
      recordId,
      templateId: config.templateId,
    });
    const printUrl = `${UI_BASE_URL.replace(/\/$/, '')}/print.html?${params.toString()}`;
    const printWindow = window.open(printUrl, '_blank');
    if (!printWindow) {
      notify('印刷ページを開けませんでした', 'error');
      return;
    }

    const templateData = buildTemplateDataFromKintoneRecord(record);
    const targetOrigin = new URL(UI_BASE_URL).origin;
    const sendData = () => {
      try {
        printWindow.postMessage(
          { type: 'plugbits-print-data', data: templateData },
          targetOrigin,
        );
      } catch {
        // ignore
      }
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== targetOrigin) return;
      if (event.source !== printWindow) return;
      if (event.data?.type !== 'plugbits-print-ready') return;
      sendData();
      window.removeEventListener('message', handleMessage);
    };
    window.addEventListener('message', handleMessage);
    setTimeout(sendData, 500);
    setTimeout(sendData, 1500);
  });

  toolbar.appendChild(printButton);
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
