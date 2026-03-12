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

const addMobilePrintButton = (config: PluginConfig | null, event: any) => {
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
  const setMobileButtonStatus = (message: string) => {
    button.disabled = true;
    button.innerHTML = `<span class="plugbits-spinner" aria-hidden="true"></span>${message}`;
  };
  const updateMobileJobStatus = (status: RenderJobStatus) => {
    const nextMessage = JOB_STATUS_LABEL[status] ?? 'PDF生成中';
    setMobileButtonStatus(nextMessage);
  };
  button.addEventListener('click', async () => {
    if (isGenerating) return;
    const latestConfig = getConfig();
    if (!latestConfig || !latestConfig.templateId) {
      notify('プラグイン設定でテンプレを選んでください');
      return;
    }

    const record = event?.record || (window as any).kintone?.mobile?.app?.record?.get?.()?.record;
    if (!record) {
      notify('レコード情報を取得できません');
      return;
    }

    const recordId = record.$id?.value;
    if (!recordId) {
      notify('レコードIDが取得できません');
      return;
    }
    const recordRevision = record.$revision?.value;
    if (!recordRevision) {
      notify('レコードのリビジョンが取得できません');
      return;
    }

    const appId = getAppId();
    const appIdValue = appId ? String(appId) : '';
    if (!appIdValue) {
      notify('アプリIDが取得できません');
      return;
    }
    isGenerating = true;
    button.disabled = true;
    setMobileButtonStatus('PDFを生成中です...');

    const openWindow =
      navigator.share ? null : window.open('', '_blank');
    if (!navigator.share && !openWindow) {
      notify('印刷用のタブを開けませんでした');
    }

    try {
      const templateOk = await checkTemplateAvailability(latestConfig, {
        allowInactiveFallback: true,
        onError: (message) => notify(message),
      });
      if (!templateOk) return;

      const blob = await requestRenderJobPdf({
        workerBaseUrl: WORKER_BASE_URL,
        kintoneBaseUrl: location.origin,
        appId: appIdValue,
        templateId: latestConfig.templateId,
        recordId: String(recordId),
        recordRevision: String(recordRevision),
        kintoneApiToken: latestConfig.kintoneApiToken,
        debugEnabled: isDebugEnabled(),
        onStatus: (status) => updateMobileJobStatus(status),
      });
      if (navigator.share) {
        try {
          const file = new File([blob], 'plugbits-report.pdf', {
            type: 'application/pdf',
          });
          if (navigator.canShare && !navigator.canShare({ files: [file] })) {
            notify('この端末では共有が利用できません');
            return;
          }
          await navigator.share({ files: [file], title: 'PlugBits PDF' });
          return;
        } catch {
          notify('共有に失敗しました。PDFを開いてください。');
        }
      }

      const blobUrl = URL.createObjectURL(blob);
      if (openWindow) {
        openWindow.location.href = blobUrl;
      } else {
        window.location.href = blobUrl;
      }
      notify('ダウンロード可能');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'PDF生成に失敗しました');
    } finally {
      isGenerating = false;
      button.disabled = false;
      button.textContent = '印刷';
    }
  });

  root.appendChild(button);

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

const setupMobileRecordDetailButton = () => {
  const config = getConfig();
  if (!config || !isConfigComplete(config)) {
    console.warn('PlugBits: プラグインが未設定です');
  }
  addMobilePrintButton(config, null);
};

(window as any).kintone?.events?.on?.('mobile.app.record.detail.show', (event: any) => {
  const config = getConfig();
  addMobilePrintButton(config, event);
  return event;
});

setupMobileRecordDetailButton();

if (location.hostname === 'localhost' || location.search.includes('plugbitsDebug=1')) {
  console.log('[PlugBits] mobile.js loaded');
}
