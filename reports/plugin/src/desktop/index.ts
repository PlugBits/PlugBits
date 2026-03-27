import { WORKER_BASE_URL } from '../constants';
import type { PluginConfig } from '../config/index.ts';
import { isDebugEnabled } from '../../../src/shared/debugFlag';
import {
  buildRenderJobPdfUrl,
  createRenderJob,
  fetchLatestRenderJob,
  JOB_STATUS_LABEL,
  requestRenderJobPdf,
  waitForRenderJob,
  type RenderJobStatusPayload,
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
    .plugbits-job-box {
      margin-top: 10px;
      padding: 10px 12px;
      border: 1px solid #dbe3f0;
      border-radius: 8px;
      background: #f8fafc;
      min-width: 300px;
    }
    .plugbits-job-box[data-status="running"],
    .plugbits-job-box[data-status="queued"] {
      border-color: #bfdbfe;
      background: #eff6ff;
    }
    .plugbits-job-box[data-status="done"] {
      border-color: #bbf7d0;
      background: #f0fdf4;
    }
    .plugbits-job-box[data-status="error"] {
      border-color: #fecaca;
      background: #fef2f2;
    }
    .plugbits-job-title {
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 4px;
    }
    .plugbits-job-hint {
      font-size: 12px;
      color: #475569;
      margin: 0;
    }
    .plugbits-job-meta {
      font-size: 11px;
      color: #64748b;
      margin-top: 6px;
      word-break: break-all;
    }
    .plugbits-job-actions {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }
    .plugbits-job-actions button {
      padding: 6px 10px;
      border-radius: 6px;
      border: 1px solid #cbd5e1;
      background: #fff;
      cursor: pointer;
      font-weight: 600;
    }
    .plugbits-job-actions button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
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

type PrintJobUiState = {
  visible: boolean;
  status: RenderJobStatus;
  jobId: string | null;
  message: string;
  hint: string;
  pdfUrl: string | null;
  canRetry: boolean;
};

type DetailViewContext = {
  appId: string;
  recordId: string;
  recordRevision: string | null;
  record: any;
  templateId: string | null;
  mode: 'print';
};

const PRINT_STATUS_HINT = 'このまま画面を閉じても処理は継続します';
const RESTORE_CONTEXT_WAIT_MS = 1500;
const RESTORE_CONTEXT_RETRY_MS = 150;

const logDetailEvent = (
  tag:
    | '[RENDER_JOB_DETAIL_SHOW_BEGIN]'
    | '[RENDER_JOB_DETAIL_SHOW_ERROR]'
    | '[RENDER_JOB_RESTORE_BEGIN]'
    | '[RENDER_JOB_RESTORE_DONE]'
    | '[RENDER_JOB_RESTORE_CONTEXT]'
    | '[RENDER_JOB_RESTORE_SKIPPED]'
    | '[RENDER_JOB_RESTORE_REQUEST]'
    | '[RENDER_JOB_RESTORE_RESULT]'
    | '[RENDER_JOB_RESTORE_UI_APPLIED]',
  payload: Record<string, unknown>,
) => {
  const serialized = JSON.stringify(payload);
  if (tag === '[RENDER_JOB_DETAIL_SHOW_ERROR]') {
    console.error(tag, serialized);
    return;
  }
  console.log(tag, serialized);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const resolveRestoreContext = async (detail: DetailViewContext) => {
  const deadline = Date.now() + RESTORE_CONTEXT_WAIT_MS;
  let config = getConfig();
  let appId = detail.appId;
  let templateId = config?.templateId?.trim() || detail.templateId || '';
  const recordId = detail.recordId;

  while (Date.now() < deadline) {
    if (recordId && appId && templateId) {
      return {
        config,
        appId,
        recordId,
        templateId,
      };
    }
    await sleep(RESTORE_CONTEXT_RETRY_MS);
    config = getConfig();
    appId = String((window as any).kintone?.app?.getId?.() ?? detail.appId ?? '').trim();
    templateId = config?.templateId?.trim() || detail.templateId || '';
  }

  return {
    config,
    appId,
    recordId,
    templateId,
  };
};

const createJobBox = (onOpen: () => void, onRetry: () => void) => {
  const box = document.createElement('div');
  box.className = 'plugbits-job-box';
  box.hidden = true;

  const title = document.createElement('p');
  title.className = 'plugbits-job-title';
  box.appendChild(title);

  const hint = document.createElement('p');
  hint.className = 'plugbits-job-hint';
  box.appendChild(hint);

  const meta = document.createElement('div');
  meta.className = 'plugbits-job-meta';
  box.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'plugbits-job-actions';

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.textContent = 'PDFを開く';
  openButton.addEventListener('click', onOpen);
  actions.appendChild(openButton);

  const retryButton = document.createElement('button');
  retryButton.type = 'button';
  retryButton.textContent = '再試行';
  retryButton.addEventListener('click', onRetry);
  actions.appendChild(retryButton);

  box.appendChild(actions);

  return { box, title, hint, meta, openButton, retryButton };
};

const renderJobBox = (
  elements: ReturnType<typeof createJobBox>,
  state: PrintJobUiState,
) => {
  elements.box.hidden = !state.visible;
  elements.box.dataset.status = state.status;
  elements.title.textContent = state.message;
  elements.hint.textContent = state.hint;
  elements.meta.textContent = state.jobId ? `jobId: ${state.jobId}` : '';
  elements.openButton.hidden = !state.pdfUrl;
  elements.retryButton.hidden = !state.canRetry;
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
    mode: 'save',
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

const addButton = (config: PluginConfig | null, detail: DetailViewContext) => {
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
  let activeMonitorId = 0;
  let lastPdfUrl: string | null = null;
  let currentClient:
    | { sessionToken: string; job: RenderJobStatusPayload; baseUrl: string; debugEnabled: boolean }
    | null = null;
  const jobBox = createJobBox(
    () => {
      if (!currentClient?.job?.jobId) return;
      const url = buildRenderJobPdfUrl({
        workerBaseUrl: currentClient.baseUrl,
        jobId: currentClient.job.jobId,
        sessionToken: currentClient.sessionToken,
        debugEnabled: currentClient.debugEnabled,
      });
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    () => {
      void startPrintJob();
    },
  );

  const setPrintUi = (state: PrintJobUiState) => {
    renderJobBox(jobBox, state);
    logDetailEvent('[RENDER_JOB_RESTORE_UI_APPLIED]', {
      appId: detail.appId,
      recordId: detail.recordId,
      templateId: detail.templateId,
      mode: detail.mode,
      appliedState: state.visible ? state.status : 'print',
    });
    if (state.status === 'queued' || state.status === 'running') {
      setButtonStatus(printButton, JOB_STATUS_LABEL[state.status]);
      return;
    }
    setButtonLoading(printButton, false);
  };

  const resetPrintUi = () => {
    setPrintUi({
      visible: false,
      status: 'queued',
      jobId: null,
      message: '印刷用PDFを準備',
      hint: PRINT_STATUS_HINT,
      pdfUrl: null,
      canRetry: false,
    });
    setButtonLoading(printButton, false);
  };

  const applyRenderStatus = (
    payload: RenderJobStatusPayload,
    options?: { autoOpen?: boolean },
  ) => {
    if (currentClient) {
      currentClient.job = payload;
    }
    const pdfUrl =
      payload.status === 'done' && currentClient
        ? buildRenderJobPdfUrl({
            workerBaseUrl: currentClient.baseUrl,
            jobId: payload.jobId,
            sessionToken: currentClient.sessionToken,
            debugEnabled: currentClient.debugEnabled,
          })
        : null;
    const previousPdfUrl = lastPdfUrl;
    lastPdfUrl = pdfUrl;
    const state: PrintJobUiState = payload.status === 'done'
      ? {
          visible: true,
          status: 'done',
          jobId: payload.jobId,
          message: JOB_STATUS_LABEL.done,
          hint: PRINT_STATUS_HINT,
          pdfUrl,
          canRetry: false,
        }
      : payload.status === 'error'
        ? {
            visible: true,
            status: 'error',
            jobId: payload.jobId,
            message: JOB_STATUS_LABEL.error,
            hint: 'もう一度お試しください',
            pdfUrl: null,
            canRetry: true,
          }
        : {
            visible: true,
            status: payload.status,
            jobId: payload.jobId,
            message: JOB_STATUS_LABEL[payload.status],
            hint: PRINT_STATUS_HINT,
            pdfUrl: null,
            canRetry: false,
          };
    setPrintUi(state);
    if (
      options?.autoOpen &&
      pdfUrl &&
      document.visibilityState === 'visible' &&
      pdfUrl !== previousPdfUrl
    ) {
      window.open(pdfUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const monitorPrintJob = (
    client: { sessionToken: string; job: RenderJobStatusPayload; baseUrl: string; debugEnabled: boolean },
    monitorId: number,
    options?: { autoOpenOnDone?: boolean; notifyOnDone?: boolean },
  ) => {
    void (async () => {
      try {
        const finalStatus = await waitForRenderJob({
          baseUrl: client.baseUrl,
          sessionToken: client.sessionToken,
          jobId: client.job.jobId,
          debugEnabled: client.debugEnabled,
          onStatus: (status) => {
            if (activeMonitorId !== monitorId) return;
            applyRenderStatus({
              ...client.job,
              status,
            });
          },
        });
        if (activeMonitorId !== monitorId) return;
        currentClient = { ...client, job: finalStatus };
        applyRenderStatus(finalStatus, { autoOpen: options?.autoOpenOnDone === true && finalStatus.status === 'done' });
        if (options?.notifyOnDone) {
          notify(finalStatus.status === 'done' ? 'PDFの準備ができました' : 'PDF生成に失敗しました', finalStatus.status === 'done' ? 'success' : 'error');
        }
      } catch (error) {
        if (activeMonitorId !== monitorId) return;
        setPrintUi({
          visible: true,
          status: 'running',
          jobId: client.job.jobId,
          message: JOB_STATUS_LABEL.running,
          hint:
            error instanceof Error
              ? error.message
              : '生成に時間がかかっています。しばらくしてから再確認してください。',
          pdfUrl: null,
          canRetry: false,
        });
        notify(
          error instanceof Error
            ? error.message
            : '生成に時間がかかっています。しばらくしてから再確認してください。',
          'info',
        );
      } finally {
        if (activeMonitorId === monitorId) {
          setButtonLoading(printButton, false);
          isPrinting = false;
        }
      }
    })();
  };

  const resumePrintJob = async () => {
    const baseLog = {
      appId: detail.appId,
      recordId: detail.recordId,
      templateId: detail.templateId ?? null,
      mode: detail.mode,
      source: 'detail-show',
    };
    logDetailEvent('[RENDER_JOB_RESTORE_BEGIN]', baseLog);
    let restoredStatus: RenderJobStatus | null = null;
    try {
      const resolved = await resolveRestoreContext(detail);
      logDetailEvent('[RENDER_JOB_RESTORE_CONTEXT]', {
        appId: resolved.appId || null,
        recordId: resolved.recordId || null,
        templateId: resolved.templateId || null,
        mode: detail.mode,
        source: 'detail-show',
      });
      const skipReason =
        !resolved.config ? 'config_not_ready'
        : !resolved.templateId ? 'missing_templateId'
        : !resolved.recordId ? 'missing_recordId'
        : !resolved.appId ? 'missing_appId'
        : null;
      if (skipReason) {
        logDetailEvent('[RENDER_JOB_RESTORE_SKIPPED]', {
          ...baseLog,
          reason: skipReason,
        });
        resetPrintUi();
        return;
      }
      logDetailEvent('[RENDER_JOB_RESTORE_REQUEST]', {
        appId: resolved.appId,
        recordId: resolved.recordId,
        templateId: resolved.templateId,
        mode: detail.mode,
        source: 'detail-show',
      });
      const latest = await fetchLatestRenderJob({
        workerBaseUrl: WORKER_BASE_URL,
        kintoneBaseUrl: location.origin,
        appId: resolved.appId,
        templateId: resolved.templateId,
        recordId: resolved.recordId,
        mode: 'print',
        kintoneApiToken: resolved.config.kintoneApiToken,
        debugEnabled: isDebugEnabled(),
      });
      logDetailEvent('[RENDER_JOB_RESTORE_RESULT]', {
        appId: resolved.appId,
        recordId: resolved.recordId,
        templateId: resolved.templateId,
        mode: detail.mode,
        found: Boolean(latest),
        jobId: latest?.job.jobId ?? null,
        status: latest?.job.status ?? null,
      });
      if (!latest) {
        resetPrintUi();
        return;
      }
      currentClient = latest;
      restoredStatus = latest.job.status;
      applyRenderStatus(latest.job);
      if (latest.job.status === 'queued' || latest.job.status === 'running') {
        isPrinting = true;
        const monitorId = Date.now();
        activeMonitorId = monitorId;
        monitorPrintJob(latest, monitorId, { autoOpenOnDone: false, notifyOnDone: true });
      } else {
        setButtonLoading(printButton, false);
      }
    } catch (error) {
      console.error('PlugBits latest job restore failed', error);
      resetPrintUi();
    } finally {
      logDetailEvent('[RENDER_JOB_RESTORE_DONE]', {
        ...baseLog,
        status: restoredStatus,
      });
    }
  };

  const startPrintJob = async () => {
    if (isPrinting) return;
    isPrinting = true;
    lastPdfUrl = null;
    const monitorId = Date.now();
    activeMonitorId = monitorId;
    setButtonLoading(printButton, true);

    const latestConfig = getConfig();
    if (!latestConfig || !latestConfig.templateId) {
      notify('プラグイン設定でテンプレを選んでください', 'error');
      setButtonLoading(printButton, false);
      isPrinting = false;
      return;
    }
    const record = detail.record;
    if (!record) {
      notify('レコード情報を取得できません', 'error');
      setButtonLoading(printButton, false);
      isPrinting = false;
      return;
    }
    const recordId = record.$id?.value;
    const recordRevision = record.$revision?.value;
    if (!recordId || !recordRevision) {
      notify('レコード情報を取得できません', 'error');
      setButtonLoading(printButton, false);
      isPrinting = false;
      return;
    }

    const templateOk = await checkTemplateAvailability(latestConfig, {
      allowInactiveFallback: true,
      onError: (message) => notify(message, 'error'),
    });
    if (!templateOk) {
      setButtonLoading(printButton, false);
      isPrinting = false;
      return;
    }

    try {
      const appId = detail.appId;
      if (!appId) {
        throw new Error('アプリIDが取得できません');
      }
      const created = await createRenderJob({
        workerBaseUrl: WORKER_BASE_URL,
        kintoneBaseUrl: location.origin,
        appId,
        templateId: latestConfig.templateId,
        recordId: String(recordId),
        recordRevision: String(recordRevision),
        mode: 'print',
        kintoneApiToken: latestConfig.kintoneApiToken,
        debugEnabled: isDebugEnabled(),
        openWhenDone: true,
      });
      if (activeMonitorId !== monitorId) return;
      currentClient = created;
      notify(created.job.reused ? '進行中のPDF生成を引き継ぎました' : 'PDF生成を開始しました', 'info');
      applyRenderStatus(created.job);
      if (created.job.status === 'done' || created.job.status === 'error') {
        applyRenderStatus(created.job, { autoOpen: created.job.status === 'done' });
        setButtonLoading(printButton, false);
        isPrinting = false;
        return;
      }
      monitorPrintJob(created, monitorId, { autoOpenOnDone: true, notifyOnDone: true });
    } catch (error) {
      console.error(error);
      setPrintUi({
        visible: true,
        status: 'error',
        jobId: currentClient?.job.jobId ?? null,
        message: JOB_STATUS_LABEL.error,
        hint: 'もう一度お試しください',
        pdfUrl: null,
        canRetry: true,
      });
      notify('PDF生成に失敗しました', 'error');
      setButtonLoading(printButton, false);
      isPrinting = false;
    }
  };

  printButton.addEventListener('click', () => {
    void startPrintJob();
  });
  root.appendChild(printButton);
  root.appendChild(jobBox.box);
  renderJobBox(jobBox, {
    visible: true,
    status: 'queued',
    jobId: null,
    message: '印刷用PDFを準備',
    hint: PRINT_STATUS_HINT,
    pdfUrl: null,
    canRetry: false,
  });
  setButtonStatus(printButton, '確認中...');
  void resumePrintJob();

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
      const record = detail.record;
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

const handleRecordDetailShow = (event: any) => {
  const config = getConfig();
  if (!config || !isConfigComplete(config)) {
    console.warn('PlugBits: プラグインが未設定です');
    showConfigWarning('PlugBits PDF: プラグインの設定が完了していません');
  }

  const appId = String((window as any).kintone?.app?.getId?.() ?? '');
  const record = event?.record ?? null;
  const recordId = String(event?.recordId ?? record?.$id?.value ?? '').trim();
  const recordRevision = String(record?.$revision?.value ?? '').trim() || null;
  const detail: DetailViewContext = {
    appId,
    recordId,
    recordRevision,
    record,
    templateId: config?.templateId ?? null,
    mode: 'print',
  };

  logDetailEvent('[RENDER_JOB_DETAIL_SHOW_BEGIN]', {
    appId,
    recordId,
    templateId: detail.templateId,
    mode: detail.mode,
  });

  try {
    addButton(config, detail);
  } catch (error) {
    logDetailEvent('[RENDER_JOB_DETAIL_SHOW_ERROR]', {
      appId,
      recordId,
      templateId: detail.templateId,
      mode: detail.mode,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  return event;
};

(window as any).kintone?.events?.on?.(['app.record.detail.show'], handleRecordDetailShow);
