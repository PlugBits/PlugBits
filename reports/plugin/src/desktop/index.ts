import { WORKER_BASE_URL } from '../constants';
import type { PluginConfig } from '../config/index.ts';
import { isDebugEnabled } from '../../../src/shared/debugFlag';
import {
  JOB_STATUS_LABEL,
  requestRenderJobPdf,
  type RenderJobStatus,
} from '../renderJobs';

const PLUGIN_ID =
  (typeof kintone !== 'undefined' ? (kintone as any).$PLUGIN_ID : '') || '';

const parseBoolean = (value: unknown): boolean => {
  if (value === true) return true;
  if (value === 'true' || value === '1') return true;
  return false;
};

// ✅ 修正後
const getConfig = (): PluginConfig | null => {
  const raw =
    (kintone as any).plugin?.app?.getConfig(PLUGIN_ID) || {};

  if (!raw || Object.keys(raw).length === 0) return null;

  return {
    templateId: raw.templateId ?? '',
    attachmentFieldCode: raw.attachmentFieldCode ?? '',
    enableSaveButton: parseBoolean(raw.enableSaveButton),
    kintoneApiToken: raw.kintoneApiToken ?? '',
    companyName: raw.companyName ?? '',
    companyAddress: raw.companyAddress ?? '',
    companyTel: raw.companyTel ?? '',
    companyEmail: raw.companyEmail ?? '',
  };
};


const createButton = (label: string, variant: 'primary' | 'default' = 'default') => {
  const button = document.createElement('button');
  button.textContent = label;
  button.className = `pb-btn${variant === 'primary' ? ' pb-btn--primary' : ''}`;
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

const setButtonStatus = (button: HTMLButtonElement, message: string) => {
  button.disabled = true;
  button.innerHTML = `<span class="plugbits-spinner" aria-hidden="true"></span>${message}`;
};

const updateJobStatusLabel = (button: HTMLButtonElement, status: RenderJobStatus) => {
  setButtonStatus(button, JOB_STATUS_LABEL[status] ?? 'PDF生成中');
};

const getRequestToken = () =>
  (window as any).kintone?.getRequestToken?.() as string | undefined;


const isConfigComplete = (config: PluginConfig) =>
  Boolean(config.templateId);

const openPdfWindow = () => {
  const w = window.open('', '_blank');
  if (!w) {
    notify('PDFを開くタブを開けませんでした', 'error');
    return null;
  }
  return w;
};

const closePdfWindow = (w: Window | null) => {
  if (!w) return;
  try {
    w.close();
  } catch {
    // ignore
  }
};

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


const callRenderApi = async (
  config: PluginConfig,
  recordId: string,
  recordRevision: string,
  onStatus?: (status: RenderJobStatus) => void,
): Promise<Blob> => {
  const baseUrl = WORKER_BASE_URL;
  const appId = (window as any).kintone?.app?.getId?.();
  const appIdValue = appId ? String(appId) : '';
  if (!appIdValue) {
    throw new Error('アプリIDが取得できません');
  }
  return requestRenderJobPdf({
    workerBaseUrl: baseUrl,
    kintoneBaseUrl: location.origin,
    appId: appIdValue,
    templateId: config.templateId,
    recordId,
    recordRevision,
    kintoneApiToken: config.kintoneApiToken,
    debugEnabled: isDebugEnabled(),
    onStatus,
  });
};

const checkTemplateAvailability = async (
  config: PluginConfig,
  options?: { allowInactiveFallback?: boolean; onError?: (message: string) => void },
): Promise<boolean> => {
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
  const buildUrl = (requireActive: boolean) => {
    const params = new URLSearchParams({
      kintoneBaseUrl: location.origin,
      appId: String(appId),
    });
    if (templateId.startsWith('tpl_') && requireActive) {
      params.set('requireActive', '1');
    }
    return `${baseUrl}/templates/${encodeURIComponent(templateId)}?${params.toString()}`;
  };

  const notifyError = (message: string) => {
    if (options?.onError) {
      options.onError(message);
    } else {
      alert(message);
    }
  };

  const requestTemplate = async (requireActive: boolean) => {
    const url = buildUrl(requireActive);
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) return { ok: true as const };
    const text = await res.text().catch(() => '');
    return { ok: false as const, status: res.status, text };
  };

  try {
    const first = await requestTemplate(true);
    if (first.ok) return true;
    if (first.status === 409 && options?.allowInactiveFallback) {
      const fallback = await requestTemplate(false);
      if (fallback.ok) return true;
      const detail = fallback.text || first.text;
      notifyError(
        `テンプレがActiveでない/アプリ紐付け不一致/環境不一致の可能性があります。${detail ? `詳細: ${detail}` : ''}`,
      );
      return false;
    }
    if (first.status === 409) {
      notifyError(
        `テンプレがActiveでない/アプリ紐付け不一致/環境不一致の可能性があります。${first.text ? `詳細: ${first.text}` : ''}`,
      );
      return false;
    }
    if (
      first.status === 404 ||
      first.status === 410 ||
      first.text.includes('not active') ||
      first.text.includes('not found')
    ) {
      notifyError('テンプレが無効です。プラグイン設定画面でテンプレを選び直してください。');
      return false;
    }
    notifyError(first.text || 'テンプレ確認に失敗しました。プラグイン設定で再選択してください');
    return false;
  } catch {
    notifyError('テンプレ確認に失敗しました。プラグイン設定で再選択してください');
    return false;
  }
};

const addButton = (config: PluginConfig | null) => {
  const headerMenuSpace =
    (window as any).kintone?.app?.record?.getHeaderMenuSpaceElement?.() || null;
  const toolbar = headerMenuSpace || document.querySelector('.gaia-argoui-app-toolbar') || document.body;
  if (!toolbar) return;

  if (document.getElementById('plugbits-print-button-root')) return;

  const root = document.createElement('div');
  root.id = 'plugbits-print-button-root';
  root.className = 'pb-root pb-kintone-header-slot';

  const printButton = createButton('印刷', 'primary');
  printButton.id = 'plugbits-print-button';
  let isPrinting = false;
  printButton.addEventListener('click', async () => {
    if (isPrinting) return;
    isPrinting = true;
    setButtonLoading(printButton, true);
    const pdfWindow = openPdfWindow();
    if (!pdfWindow) return;
    const latestConfig = getConfig();
    if (!latestConfig || !latestConfig.templateId) {
      notify('プラグイン設定でテンプレを選んでください', 'error');
      closePdfWindow(pdfWindow);
      setButtonLoading(printButton, false);
      isPrinting = false;
      return;
    }
    const record = (window as any).kintone?.app?.record?.get()?.record;
    if (!record) {
      notify('レコード情報を取得できません');
      closePdfWindow(pdfWindow);
      setButtonLoading(printButton, false);
      isPrinting = false;
      return;
    }

    const recordId = record.$id?.value;
    if (!recordId) {
      notify('レコードIDが取得できません');
      closePdfWindow(pdfWindow);
      setButtonLoading(printButton, false);
      isPrinting = false;
      return;
    }
    const recordRevision = record.$revision?.value;
    if (!recordRevision) {
      notify('レコードのリビジョンが取得できません', 'error');
      closePdfWindow(pdfWindow);
      setButtonLoading(printButton, false);
      isPrinting = false;
      return;
    }

    const templateOk = await checkTemplateAvailability(latestConfig, {
      allowInactiveFallback: true,
      onError: (message) => notify(message, 'error'),
    });
    if (!templateOk) {
      closePdfWindow(pdfWindow);
      setButtonLoading(printButton, false);
      isPrinting = false;
      return;
    }

    try {
      setButtonStatus(printButton, 'PDFを生成中です...');
      const pdfBlob = await callRenderApi(
        latestConfig,
        String(recordId),
        String(recordRevision),
        (status) => updateJobStatusLabel(printButton, status),
      );
      const url = URL.createObjectURL(pdfBlob);
      pdfWindow.location.href = url;
      notify('ダウンロード可能', 'success');
    } catch (error) {
      console.error(error);
      closePdfWindow(pdfWindow);
      notify(error instanceof Error ? error.message : 'PDF生成に失敗しました', 'error');
    } finally {
      setButtonLoading(printButton, false);
      isPrinting = false;
    }
  });

  root.appendChild(printButton);

  if (config?.enableSaveButton) {
    const saveButton = createButton('保存');
    saveButton.id = 'plugbits-save-button';
    saveButton.dataset.loadingLabel = '保存中...';
    let isSaving = false;
    saveButton.addEventListener('click', async () => {
      if (isSaving) return;
      isSaving = true;
      const pdfWindow = openPdfWindow();
      if (!pdfWindow) {
        isSaving = false;
        return;
      }
      const latestConfig = getConfig();
      if (!latestConfig || !latestConfig.templateId) {
        notify('プラグイン設定でテンプレを選んでください', 'error');
        closePdfWindow(pdfWindow);
        isSaving = false;
        return;
      }
      if (!latestConfig.enableSaveButton) {
        notify('保存ボタンが無効です', 'error');
        closePdfWindow(pdfWindow);
        isSaving = false;
        return;
      }
      if (!latestConfig.attachmentFieldCode) {
        notify('添付フィールドコードが未設定です', 'error');
        closePdfWindow(pdfWindow);
        isSaving = false;
        return;
      }
      const record = (window as any).kintone?.app?.record?.get()?.record;
      if (!record) {
        notify('レコード情報を取得できません');
        closePdfWindow(pdfWindow);
        isSaving = false;
        return;
      }

      const recordId = record.$id?.value;
      if (!recordId) {
        notify('レコードIDが取得できません');
        closePdfWindow(pdfWindow);
        isSaving = false;
        return;
      }
      const recordRevision = record.$revision?.value;
      if (!recordRevision) {
        notify('レコードのリビジョンが取得できません', 'error');
        closePdfWindow(pdfWindow);
        isSaving = false;
        return;
      }

      const templateOk = await checkTemplateAvailability(latestConfig, {
        allowInactiveFallback: false,
        onError: (message) => notify(message, 'error'),
      });
      if (!templateOk) {
        closePdfWindow(pdfWindow);
        isSaving = false;
        return;
      }

      setButtonLoading(saveButton, true);
      try {
        setButtonStatus(saveButton, 'PDFを生成中です...');
        const pdfBlob = await callRenderApi(
          latestConfig,
          String(recordId),
          String(recordRevision),
          (status) => updateJobStatusLabel(saveButton, status),
        );
        const url = URL.createObjectURL(pdfBlob);
        const fileKey = await uploadFile(pdfBlob);
        await updateRecordAttachment(recordId, latestConfig.attachmentFieldCode, fileKey);
        notify('PDFを添付フィールドに保存しました', 'success');
        pdfWindow.location.href = url;
        location.reload();
      } catch (error) {
        console.error(error);
        closePdfWindow(pdfWindow);
        notify(error instanceof Error ? error.message : 'PDF生成に失敗しました', 'error');
      } finally {
        setButtonLoading(saveButton, false);
        isSaving = false;
      }
    });

    root.appendChild(saveButton);
  }

  toolbar.appendChild(root);
};

const setupRecordDetailButton = () => {
  const config = getConfig();
  if (!config || !isConfigComplete(config)) {
    console.warn('PlugBits: プラグインが未設定です');
    showConfigWarning('PlugBits PDF: プラグインの設定が完了していません');
  }

  const events = ['app.record.detail.show'];
  (window as any).kintone?.events?.on(events, (event: any) => {
    addButton(getConfig());
    return event;
  });
};

document.addEventListener('DOMContentLoaded', setupRecordDetailButton);
