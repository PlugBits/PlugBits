import { WORKER_BASE_URL } from '../constants';
import type { PluginConfig } from '../config/index.ts';
import { isDebugEnabled } from '../../../src/shared/debugFlag';
import {
  buildRenderJobPdfUrl,
  createRenderJob,
  fetchLatestRenderJob,
  JOB_STATUS_LABEL,
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

const isConfigComplete = (config: PluginConfig) =>
  Boolean(config.templateId);

const injectStyles = () => {
  if (document.getElementById('plugbits-mobile-style')) return;
  const style = document.createElement('style');
  style.id = 'plugbits-mobile-style';
  style.textContent = `
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
    .plugbits-mobile-job-box {
      margin-top: 10px;
      padding: 10px 12px;
      border: 1px solid #dbe3f0;
      border-radius: 8px;
      background: #f8fafc;
      font-size: 12px;
    }
    .plugbits-mobile-job-box[data-status="running"],
    .plugbits-mobile-job-box[data-status="queued"] {
      border-color: #bfdbfe;
      background: #eff6ff;
    }
    .plugbits-mobile-job-box[data-status="done"] {
      border-color: #bbf7d0;
      background: #f0fdf4;
    }
    .plugbits-mobile-job-box[data-status="error"] {
      border-color: #fecaca;
      background: #fef2f2;
    }
    .plugbits-mobile-job-title {
      font-weight: 700;
      margin-bottom: 4px;
    }
    .plugbits-mobile-job-hint {
      color: #475569;
      margin-bottom: 6px;
    }
    .plugbits-mobile-job-meta {
      color: #64748b;
      font-size: 11px;
      word-break: break-all;
    }
    .plugbits-mobile-job-actions {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }
    .plugbits-mobile-job-actions button {
      padding: 6px 10px;
      border-radius: 6px;
      border: 1px solid #cbd5e1;
      background: #fff;
      font-weight: 600;
    }
  `;
  document.head.appendChild(style);
};

const createButton = (label: string, variant: 'primary' | 'default' = 'default') => {
  const button = document.createElement('button');
  button.textContent = label;
  button.className = `pb-btn${variant === 'primary' ? ' pb-btn--primary' : ''}`;
  return button;
};

const notify = (message: string) => {
  alert(message);
};

type MobileJobUiState = {
  visible: boolean;
  status: RenderJobStatus;
  jobId: string | null;
  message: string;
  hint: string;
  pdfUrl: string | null;
  canRetry: boolean;
};

type MobileDetailViewContext = {
  appId: string;
  recordId: string;
  recordRevision: string | null;
  record: any;
  templateId: string | null;
  mode: 'print';
};

const MOBILE_PRINT_STATUS_HINT = 'このまま画面を閉じても処理は継続します';
const RESTORE_CONTEXT_WAIT_MS = 1500;
const RESTORE_CONTEXT_RETRY_MS = 150;

const logMobileDetailEvent = (
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

const resolveMobileRestoreContext = async (detail: MobileDetailViewContext) => {
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
    appId = String(getAppId() ?? detail.appId ?? '').trim();
    templateId = config?.templateId?.trim() || detail.templateId || '';
  }

  return {
    config,
    appId,
    recordId,
    templateId,
  };
};

const createMobileJobBox = (onOpen: () => void, onRetry: () => void) => {
  const box = document.createElement('div');
  box.className = 'plugbits-mobile-job-box';
  box.hidden = true;

  const title = document.createElement('div');
  title.className = 'plugbits-mobile-job-title';
  box.appendChild(title);

  const hint = document.createElement('div');
  hint.className = 'plugbits-mobile-job-hint';
  box.appendChild(hint);

  const meta = document.createElement('div');
  meta.className = 'plugbits-mobile-job-meta';
  box.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'plugbits-mobile-job-actions';

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

const renderMobileJobBox = (
  elements: ReturnType<typeof createMobileJobBox>,
  state: MobileJobUiState,
) => {
  elements.box.hidden = !state.visible;
  elements.box.dataset.status = state.status;
  elements.title.textContent = state.message;
  elements.hint.textContent = state.hint;
  elements.meta.textContent = state.jobId ? `jobId: ${state.jobId}` : '';
  elements.openButton.hidden = !state.pdfUrl;
  elements.retryButton.hidden = !state.canRetry;
};

const getAppId = () =>
  (window as any).kintone?.mobile?.app?.getId?.() ??
  (window as any).kintone?.app?.getId?.();

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
  const appId = getAppId();
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

const addMobilePrintButton = (config: PluginConfig | null, detail: MobileDetailViewContext) => {
  injectStyles();
  const headerMenuSpace =
    (window as any).kintone?.mobile?.app?.record?.getHeaderSpaceElement?.() ||
    (window as any).kintone?.mobile?.app?.record?.getHeaderMenuSpaceElement?.() ||
    document.querySelector('.gaia-mobile-header-space') ||
    document.querySelector('.gaia-mobile-header-menu') ||
    null;
  if (document.getElementById('plugbits-print-only-mobile')) return;

  const root = document.createElement('div');
  root.id = 'plugbits-print-only-mobile';
  root.className = 'pb-root pb-kintone-header-slot';

  const button = createButton('印刷', 'primary');
  let isGenerating = false;
  let activeMonitorId = 0;
  let currentClient:
    | { sessionToken: string; job: RenderJobStatusPayload; baseUrl: string; debugEnabled: boolean }
    | null = null;
  const setMobileButtonStatus = (message: string) => {
    button.disabled = true;
    button.innerHTML = `<span class="plugbits-spinner" aria-hidden="true"></span>${message}`;
  };
  const jobBox = createMobileJobBox(
    () => {
      if (!currentClient?.job?.jobId) return;
      const url = buildRenderJobPdfUrl({
        workerBaseUrl: currentClient.baseUrl,
        jobId: currentClient.job.jobId,
        sessionToken: currentClient.sessionToken,
        debugEnabled: currentClient.debugEnabled,
      });
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (!opened) {
        window.location.href = url;
      }
    },
    () => {
      void startMobilePrintJob();
    },
  );

  const setMobileUi = (state: MobileJobUiState) => {
    renderMobileJobBox(jobBox, state);
    logMobileDetailEvent('[RENDER_JOB_RESTORE_UI_APPLIED]', {
      appId: detail.appId,
      recordId: detail.recordId,
      templateId: detail.templateId,
      mode: detail.mode,
      appliedState: state.visible ? state.status : 'print',
    });
    if (state.status === 'queued' || state.status === 'running') {
      setMobileButtonStatus(JOB_STATUS_LABEL[state.status]);
      return;
    }
    button.disabled = false;
    button.textContent = '印刷';
  };

  const resetMobileUi = () => {
    setMobileUi({
      visible: false,
      status: 'queued',
      jobId: null,
      message: '印刷用PDFを準備',
      hint: MOBILE_PRINT_STATUS_HINT,
      pdfUrl: null,
      canRetry: false,
    });
  };

  const applyMobileRenderStatus = (
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
    setMobileUi(
      payload.status === 'done'
        ? {
            visible: true,
            status: 'done',
            jobId: payload.jobId,
            message: JOB_STATUS_LABEL.done,
            hint: MOBILE_PRINT_STATUS_HINT,
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
              hint: MOBILE_PRINT_STATUS_HINT,
              pdfUrl: null,
              canRetry: false,
            },
    );
    if (options?.autoOpen && pdfUrl) {
      const opened = window.open(pdfUrl, '_blank', 'noopener,noreferrer');
      if (!opened) {
        window.location.href = pdfUrl;
      }
    }
  };

  const monitorMobilePrintJob = (
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
            applyMobileRenderStatus({
              ...client.job,
              status,
            });
          },
        });
        if (activeMonitorId !== monitorId) return;
        currentClient = { ...client, job: finalStatus };
        applyMobileRenderStatus(finalStatus, {
          autoOpen: options?.autoOpenOnDone === true && finalStatus.status === 'done',
        });
        if (options?.notifyOnDone) {
          notify(finalStatus.status === 'done' ? 'PDFの準備ができました' : 'PDF生成に失敗しました');
        }
      } catch (error) {
        if (activeMonitorId !== monitorId) return;
        setMobileUi({
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
        );
      } finally {
        if (activeMonitorId === monitorId) {
          button.disabled = false;
          button.textContent = '印刷';
          isGenerating = false;
        }
      }
    })();
  };

  const resumeMobilePrintJob = async () => {
    const baseLog = {
      appId: detail.appId,
      recordId: detail.recordId,
      templateId: detail.templateId ?? null,
      mode: detail.mode,
      source: 'detail-show',
    };
    logMobileDetailEvent('[RENDER_JOB_RESTORE_BEGIN]', baseLog);
    let restoredStatus: RenderJobStatus | null = null;
    try {
      const resolved = await resolveMobileRestoreContext(detail);
      logMobileDetailEvent('[RENDER_JOB_RESTORE_CONTEXT]', {
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
        logMobileDetailEvent('[RENDER_JOB_RESTORE_SKIPPED]', {
          ...baseLog,
          reason: skipReason,
        });
        resetMobileUi();
        return;
      }
      logMobileDetailEvent('[RENDER_JOB_RESTORE_REQUEST]', {
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
      logMobileDetailEvent('[RENDER_JOB_RESTORE_RESULT]', {
        appId: resolved.appId,
        recordId: resolved.recordId,
        templateId: resolved.templateId,
        mode: detail.mode,
        found: Boolean(latest),
        jobId: latest?.job.jobId ?? null,
        status: latest?.job.status ?? null,
      });
      if (!latest) {
        resetMobileUi();
        return;
      }
      currentClient = latest;
      restoredStatus = latest.job.status;
      applyMobileRenderStatus(latest.job);
      if (latest.job.status === 'queued' || latest.job.status === 'running') {
        isGenerating = true;
        const monitorId = Date.now();
        activeMonitorId = monitorId;
        monitorMobilePrintJob(latest, monitorId, { autoOpenOnDone: false, notifyOnDone: true });
      } else {
        button.disabled = false;
        button.textContent = '印刷';
      }
    } catch (error) {
      console.error('PlugBits mobile latest job restore failed', error);
      resetMobileUi();
    } finally {
      logMobileDetailEvent('[RENDER_JOB_RESTORE_DONE]', {
        ...baseLog,
        status: restoredStatus,
      });
    }
  };

  const startMobilePrintJob = async () => {
    if (isGenerating) return;
    isGenerating = true;
    const monitorId = Date.now();
    activeMonitorId = monitorId;

    const latestConfig = getConfig();
    if (!latestConfig || !latestConfig.templateId) {
      notify('プラグイン設定でテンプレを選んでください');
      isGenerating = false;
      return;
    }

    const record = detail.record;
    if (!record) {
      notify('レコード情報を取得できません');
      isGenerating = false;
      return;
    }

    const recordId = record.$id?.value;
    const recordRevision = record.$revision?.value;
    const appIdValue = detail.appId;
    if (!recordId || !recordRevision || !appIdValue) {
      notify('レコード情報を取得できません');
      isGenerating = false;
      return;
    }

    button.disabled = true;
    setMobileButtonStatus(JOB_STATUS_LABEL.running);

    try {
      const templateOk = await checkTemplateAvailability(latestConfig, {
        allowInactiveFallback: true,
        onError: (message) => notify(message),
      });
      if (!templateOk) {
        button.disabled = false;
        button.textContent = '印刷';
        isGenerating = false;
        return;
      }

      const created = await createRenderJob({
        workerBaseUrl: WORKER_BASE_URL,
        kintoneBaseUrl: location.origin,
        appId: appIdValue,
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
      notify(created.job.reused ? '進行中のPDF生成を引き継ぎました' : 'PDF生成を開始しました');
      applyMobileRenderStatus(created.job);
      if (created.job.status === 'done' || created.job.status === 'error') {
        applyMobileRenderStatus(created.job, { autoOpen: created.job.status === 'done' });
        isGenerating = false;
        return;
      }
      monitorMobilePrintJob(created, monitorId, { autoOpenOnDone: true, notifyOnDone: true });
    } catch (error) {
      setMobileUi({
        visible: true,
        status: 'error',
        jobId: currentClient?.job.jobId ?? null,
        message: JOB_STATUS_LABEL.error,
        hint: 'もう一度お試しください',
        pdfUrl: null,
        canRetry: true,
      });
      notify('PDF生成に失敗しました');
      button.disabled = false;
      button.textContent = '印刷';
      isGenerating = false;
    }
  };

  button.addEventListener('click', () => {
    void startMobilePrintJob();
  });

  root.appendChild(button);
  root.appendChild(jobBox.box);
  renderMobileJobBox(jobBox, {
    visible: true,
    status: 'queued',
    jobId: null,
    message: '印刷用PDFを準備',
    hint: MOBILE_PRINT_STATUS_HINT,
    pdfUrl: null,
    canRetry: false,
  });
  button.disabled = true;
  button.textContent = '確認中...';
  void resumeMobilePrintJob();

  if (headerMenuSpace) {
    headerMenuSpace.appendChild(root);
    return;
  }

  root.style.position = 'fixed';
  root.style.right = '16px';
  root.style.bottom = '16px';
  root.style.zIndex = '9999';
  root.style.boxShadow = '0 8px 16px rgba(0, 0, 0, 0.18)';
  document.body.appendChild(root);
};

const handleMobileRecordDetailShow = (event: any) => {
  const config = getConfig();
  if (!config || !isConfigComplete(config)) {
    console.warn('PlugBits: プラグインが未設定です');
  }
  const record = event?.record ?? null;
  const recordId = String(event?.recordId ?? record?.$id?.value ?? '').trim();
  const recordRevision = String(record?.$revision?.value ?? '').trim() || null;
  const appId = String(getAppId() ?? '').trim();
  const detail: MobileDetailViewContext = {
    appId,
    recordId,
    recordRevision,
    record,
    templateId: config?.templateId ?? null,
    mode: 'print',
  };
  logMobileDetailEvent('[RENDER_JOB_DETAIL_SHOW_BEGIN]', {
    appId,
    recordId,
    templateId: detail.templateId,
    mode: detail.mode,
  });
  try {
    addMobilePrintButton(config, detail);
  } catch (error) {
    logMobileDetailEvent('[RENDER_JOB_DETAIL_SHOW_ERROR]', {
      appId,
      recordId,
      templateId: detail.templateId,
      mode: detail.mode,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
  return event;
};

(window as any).kintone?.events?.on?.('mobile.app.record.detail.show', handleMobileRecordDetailShow);

if (location.hostname === 'localhost' || location.search.includes('plugbitsDebug=1')) {
  console.log('[PlugBits] mobile.js loaded');
}
