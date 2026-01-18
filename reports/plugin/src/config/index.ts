const PLUGIN_ID =
  (typeof kintone !== 'undefined' ? (kintone as any).$PLUGIN_ID : '') || '';
const UI_BASE_URL = 'https://b8bb990a.plugbits.pages.dev';

export type PluginConfig = {
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

const normalizeConfig = (rawConfig: Record<string, any>) => {
  const legacyUiBaseUrl =
    rawConfig.uiBaseUrl ?? rawConfig.ui_base_url ?? rawConfig.uiBase ?? rawConfig.uiUrl ?? '';
  return {
    config: {
      apiBaseUrl: rawConfig.apiBaseUrl ?? rawConfig.workerBaseUrl ?? '',
      apiKey: rawConfig.apiKey ?? rawConfig.workerApiKey ?? '',
      kintoneApiToken: rawConfig.kintoneApiToken ?? '',
      templateId: rawConfig.templateId ?? '',
      attachmentFieldCode: rawConfig.attachmentFieldCode ?? '',
    },
    legacy: {
      workerBaseUrl: rawConfig.workerBaseUrl ?? '',
      workerApiKey: rawConfig.workerApiKey ?? '',
      uiBaseUrl: legacyUiBaseUrl,
    },
    rawConfig,
  };
};

const loadConfig = (): {
  config: PluginConfig;
  legacy: { workerBaseUrl: string; workerApiKey: string; uiBaseUrl: string };
  rawConfig: Record<string, any>;
} => {
  if (!PLUGIN_ID) {
    return {
      config: buildInitialConfig(),
      legacy: { workerBaseUrl: '', workerApiKey: '', uiBaseUrl: '' },
      rawConfig: {},
    };
  }

  const rawConfig = (kintone as any).plugin?.app?.getConfig(PLUGIN_ID) || {};
  return normalizeConfig(rawConfig);
};

const renderForm = () => {
  const resolveContainer = (): HTMLElement => {
    const direct = document.getElementById('plugbits-plugin-config');
    if (direct) return direct;

    const fallbackIds = ['settings', 'root', 'app', 'content', 'plugin-config'];
    for (const id of fallbackIds) {
      const el = document.getElementById(id);
      if (el) {
        el.id = 'plugbits-plugin-config';
        return el;
      }
    }

    const created = document.createElement('div');
    created.id = 'plugbits-plugin-config';
    document.body.appendChild(created);
    return created;
  };

  const removeLoading = () => {
    const targets = document.querySelectorAll<HTMLElement>(
      '#loading, .kb-loading, .spinner, .loading',
    );
    targets.forEach((el) => el.remove());
  };

  const container = resolveContainer();

  const { config, legacy, rawConfig } = loadConfig();

  container.innerHTML = `
    <h1 class="kb-title">PlugBits 帳票プラグイン設定</h1>
    <p class="kb-desc">
      Cloudflare Workers で稼働する PlugBits Reports API の接続情報と、生成した PDF
      を添付するフィールドコードを入力してください。
    </p>

    <label class="kb-label" for="apiBaseUrl">API ベースURL</label>
    <input class="kb-input" id="apiBaseUrl" type="text" placeholder="https://example.workers.dev" />
    <div class="kb-row" style="margin-top:4px; gap:8px; align-items:center; flex-wrap:wrap;">
      <span
        id="apiBaseUrlStatus"
        style="display:inline-flex; align-items:center; padding:2px 10px; border-radius:999px; border:1px solid #e4e7ec; background:#f2f4f7; color:#667085; font-size:12px;"
      >API URL: 未確認</span>
      <span
        id="apiBaseUrlCheckedAt"
        style="display:inline-flex; align-items:center; padding:2px 10px; border-radius:999px; border:1px solid #e4e7ec; background:#f2f4f7; color:#667085; font-size:12px;"
      >最終確認: -</span>
    </div>
    <div
      id="apiBaseUrlAlert"
      style="display:none; margin-top:6px; padding:8px 10px; border-radius:6px; background:#fef3f2; border:1px solid #fecdca; color:#b42318;"
    >
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <span id="apiBaseUrlAlertText">API ベースURLが無効です。</span>
        <button id="fixApiBaseUrl" class="kb-btn" type="button">Fix API URL</button>
      </div>
    </div>

    <label class="kb-label" for="apiKey">Worker API キー</label>
    <input class="kb-input" id="apiKey" type="password" />

    <label class="kb-label" for="kintoneApiToken">kintone APIトークン</label>
    <input class="kb-input" id="kintoneApiToken" type="password" placeholder="REST API用のトークン" />

    <label class="kb-label">選択中テンプレート</label>
    <div class="kb-row" style="margin-top:4px; gap:8px; align-items:center; flex-wrap:wrap;">
      <span
        id="selectedTemplateBadge"
        style="display:inline-flex; align-items:center; padding:2px 10px; border-radius:999px; border:1px solid #e4e7ec; background:#f2f4f7; color:#344054; font-size:12px;"
      >テンプレ: 未選択</span>
      <span
        id="selectedTemplateUpdatedAt"
        style="display:inline-flex; align-items:center; padding:2px 10px; border-radius:999px; border:1px solid #e4e7ec; background:#f2f4f7; color:#667085; font-size:12px;"
      >更新: -</span>
      <span
        id="selectedTemplateStatus"
        style="display:inline-flex; align-items:center; padding:2px 10px; border-radius:999px; border:1px solid #e4e7ec; background:#f2f4f7; color:#667085; font-size:12px;"
      >状態: -</span>
      <span
        id="selectedTemplateState"
        style="display:inline-flex; align-items:center; padding:2px 10px; border-radius:999px; border:1px solid #e4e7ec; background:#f2f4f7; color:#667085; font-size:12px;"
      >未確認</span>
      <span
        id="selectedTemplateCheckedAt"
        style="display:inline-flex; align-items:center; padding:2px 10px; border-radius:999px; border:1px solid #e4e7ec; background:#f2f4f7; color:#667085; font-size:12px;"
      >最終確認: -</span>
    </div>
    <div class="kb-desc" id="templateIdStatus" style="margin-top:4px; color:#b42318;"></div>
    <div class="kb-row" style="margin-top:6px;">
      <button id="openTemplatePicker" class="kb-btn" type="button">テンプレを選ぶ</button>
      <button id="openTemplateEditor" class="kb-btn" type="button">選択中テンプレを編集</button>
    </div>

    <details id="templateIdDetails" style="margin-top:8px;">
      <summary class="kb-label">詳細設定</summary>
      <label class="kb-label" for="templateId">テンプレートID（手入力）</label>
      <input class="kb-input" id="templateId" type="text" placeholder="tpl_xxx または list_v1" />
    </details>

    <label class="kb-label" for="attachmentFieldCode">添付ファイルフィールドコード</label>
    <input class="kb-input" id="attachmentFieldCode" type="text" placeholder="attachment" />

    <div class="kb-row kb-toolbar">
      <button id="saveButton" class="kb-btn kb-primary" type="button">保存</button>
      <button id="cancelButton" class="kb-btn" type="button">キャンセル</button>
      <button id="resetConfigButton" class="kb-btn" type="button">設定をリセット</button>
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

  const getInputValue = (id: string) =>
    (document.getElementById(id) as HTMLInputElement | null)?.value.trim() || '';

  const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

  const readSelectedTemplateId = (): string | null => {
    const hash = window.location.hash ?? '';
    const hashIndex = hash.indexOf('?');
    let qs = hashIndex >= 0 ? hash.slice(hashIndex + 1) : '';
    if (!qs) {
      qs = window.location.search ?? '';
    }
    if (!qs) return null;
    const params = new URLSearchParams(qs.startsWith('?') ? qs : `?${qs}`);
    if (!params.has('selectedTemplateId')) return null;
    return params.get('selectedTemplateId') ?? '';
  };

  const cleanSelectedTemplateIdFromUrl = () => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('selectedTemplateId')) {
        url.searchParams.delete('selectedTemplateId');
      }
      const hash = url.hash ?? '';
      if (hash.includes('?')) {
        const [path, rawQuery] = hash.split('?');
        const hashParams = new URLSearchParams(rawQuery);
        if (hashParams.has('selectedTemplateId')) {
          hashParams.delete('selectedTemplateId');
          const nextQuery = hashParams.toString();
          url.hash = nextQuery ? `${path}?${nextQuery}` : path;
        }
      }
      history.replaceState(null, '', url.toString());
    } catch {
      // ignore
    }
  };

  const getReturnOrigin = () => window.location.href;

  const buildPickerUrl = (params: {
    workerBaseUrl: string;
    kintoneBaseUrl: string;
    appId: string;
    returnOrigin: string;
    sessionToken: string;
  }) => {
    const query = new URLSearchParams({
      mode: 'picker',
      sessionToken: params.sessionToken,
      workerBaseUrl: params.workerBaseUrl,
      kintoneBaseUrl: params.kintoneBaseUrl,
      appId: String(params.appId),
      returnOrigin: params.returnOrigin,
    });
    return `${UI_BASE_URL}/#/picker?${query.toString()}`;
  };

  const buildEditUrl = (params: {
    templateId: string;
    workerBaseUrl: string;
    kintoneBaseUrl: string;
    appId: string;
    returnOrigin: string;
    sessionToken: string;
  }) => {
    const query = new URLSearchParams({
      sessionToken: params.sessionToken,
      workerBaseUrl: params.workerBaseUrl,
      kintoneBaseUrl: params.kintoneBaseUrl,
      appId: String(params.appId),
      returnOrigin: params.returnOrigin,
    });
    return `${UI_BASE_URL}/#/templates/${encodeURIComponent(params.templateId)}/edit?${query.toString()}`;
  };

  const apiBaseUrlStatus = document.getElementById('apiBaseUrlStatus');
  const apiBaseUrlCheckedAt = document.getElementById('apiBaseUrlCheckedAt');
  const apiBaseUrlAlert = document.getElementById('apiBaseUrlAlert');
  const apiBaseUrlAlertText = document.getElementById('apiBaseUrlAlertText');
  const fixApiBaseUrlButton = document.getElementById('fixApiBaseUrl') as HTMLButtonElement | null;
  const selectedTemplateBadge = document.getElementById('selectedTemplateBadge');
  const selectedTemplateUpdatedAt = document.getElementById('selectedTemplateUpdatedAt');
  const selectedTemplateStatus = document.getElementById('selectedTemplateStatus');
  const selectedTemplateState = document.getElementById('selectedTemplateState');
  const selectedTemplateCheckedAt = document.getElementById('selectedTemplateCheckedAt');
  const templateIdStatus = document.getElementById('templateIdStatus');
  const openTemplatePicker = document.getElementById('openTemplatePicker') as HTMLButtonElement | null;
  const openTemplateEditor = document.getElementById('openTemplateEditor') as HTMLButtonElement | null;

  let currentTemplateValidity: 'valid' | 'invalid' | 'unset' | 'unknown' = 'unknown';
  let currentTemplateStatus: 'active' | 'archived' | 'deleted' | 'not_found' | 'unknown' = 'unknown';
  let currentApiStatus: 'valid' | 'invalid' | 'unknown' | 'unset' = 'unknown';

  const updateSelectedTemplateBadge = (label: string) => {
    if (!selectedTemplateBadge) return;
    selectedTemplateBadge.textContent = label
      ? `テンプレ: ${label}`
      : 'テンプレ: 未選択';
  };

  const setTemplateStateBadge = (
    state: 'valid' | 'invalid' | 'unset' | 'unknown',
    message?: string,
  ) => {
    currentTemplateValidity = state;
    if (templateIdStatus) templateIdStatus.textContent = message ?? '';
    if (openTemplatePicker) {
      openTemplatePicker.classList.toggle('kb-primary', state === 'invalid');
    }
    if (!selectedTemplateState) return;
    if (state === 'valid') {
      selectedTemplateState.textContent = '有効';
      selectedTemplateState.style.background = '#ecfdf3';
      selectedTemplateState.style.color = '#027a48';
      selectedTemplateState.style.borderColor = '#abefc6';
      return;
    }
    if (state === 'invalid') {
      selectedTemplateState.textContent = '無効';
      selectedTemplateState.style.background = '#fef3f2';
      selectedTemplateState.style.color = '#b42318';
      selectedTemplateState.style.borderColor = '#fecdca';
      return;
    }
    if (state === 'unset') {
      selectedTemplateState.textContent = '未選択';
      selectedTemplateState.style.background = '#f2f4f7';
      selectedTemplateState.style.color = '#667085';
      selectedTemplateState.style.borderColor = '#e4e7ec';
      return;
    }
    selectedTemplateState.textContent = '未確認';
    selectedTemplateState.style.background = '#f2f4f7';
    selectedTemplateState.style.color = '#667085';
    selectedTemplateState.style.borderColor = '#e4e7ec';
  };

  const formatUpdatedAt = (value?: string) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
  };

  const updateTemplateUpdatedAt = (value?: string) => {
    if (!selectedTemplateUpdatedAt) return;
    selectedTemplateUpdatedAt.textContent = `更新: ${formatUpdatedAt(value)}`;
  };

  const updateTemplateStatus = (status: typeof currentTemplateStatus) => {
    currentTemplateStatus = status;
    if (!selectedTemplateStatus) return;
    const label =
      status === 'active'
        ? 'Active'
        : status === 'archived'
          ? 'Archived'
          : status === 'deleted'
            ? 'Trash'
            : status === 'not_found'
              ? 'Missing'
              : '不明';
    selectedTemplateStatus.textContent = `状態: ${label}`;
  };

  const updateTemplateCheckedAt = (value?: string) => {
    if (!selectedTemplateCheckedAt) return;
    selectedTemplateCheckedAt.textContent = `最終確認: ${value ?? '-'}`;
  };

  const isLikelyPagesUrl = (value: string) => {
    try {
      const url = new URL(value);
      const host = url.host.toLowerCase();
      if (host.endsWith('.pages.dev') || host.includes('.pages.dev')) return true;
      if (host.endsWith('.pages.cloudflare.com') || host.includes('.pages.cloudflare.com')) return true;
      if (host.endsWith('.github.io') || host.includes('.github.io')) return true;
      if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
        const port = url.port || (url.protocol === 'https:' ? '443' : '80');
        if (['5173', '3000', '4173'].includes(port)) return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const isValidHttpUrl = (value: string) => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const isLikelyWorkersUrl = (value: string) => {
    try {
      const url = new URL(value);
      const host = url.host.toLowerCase();
      if (host.endsWith('.workers.dev') || host.includes('.workers.dev')) return true;
      return false;
    } catch {
      return false;
    }
  };

  const updateApiCheckedAt = (value?: string) => {
    if (!apiBaseUrlCheckedAt) return;
    apiBaseUrlCheckedAt.textContent = `最終確認: ${value ?? '-'}`;
  };

  const updateApiStatus = (
    status: typeof currentApiStatus,
    note?: string,
  ) => {
    currentApiStatus = status;
    if (!apiBaseUrlStatus) return;
    if (status === 'valid') {
      apiBaseUrlStatus.textContent = 'API URL: Workers';
      apiBaseUrlStatus.style.background = '#ecfdf3';
      apiBaseUrlStatus.style.color = '#027a48';
      apiBaseUrlStatus.style.borderColor = '#abefc6';
      return;
    }
    if (status === 'invalid') {
      apiBaseUrlStatus.textContent = `API URL: ${note ?? '不正'}`;
      apiBaseUrlStatus.style.background = '#fef3f2';
      apiBaseUrlStatus.style.color = '#b42318';
      apiBaseUrlStatus.style.borderColor = '#fecdca';
      return;
    }
    if (status === 'unset') {
      apiBaseUrlStatus.textContent = 'API URL: 未設定';
      apiBaseUrlStatus.style.background = '#f2f4f7';
      apiBaseUrlStatus.style.color = '#667085';
      apiBaseUrlStatus.style.borderColor = '#e4e7ec';
      return;
    }
    apiBaseUrlStatus.textContent = `API URL: ${note ?? '未確認'}`;
    apiBaseUrlStatus.style.background = '#f2f4f7';
    apiBaseUrlStatus.style.color = '#667085';
    apiBaseUrlStatus.style.borderColor = '#e4e7ec';
  };

  const showApiAlert = (message: string, showFix: boolean) => {
    if (!apiBaseUrlAlert) return;
    if (apiBaseUrlAlertText) apiBaseUrlAlertText.textContent = message;
    if (fixApiBaseUrlButton) fixApiBaseUrlButton.style.display = showFix ? 'inline-flex' : 'none';
    apiBaseUrlAlert.style.display = 'block';
  };

  const hideApiAlert = () => {
    if (!apiBaseUrlAlert) return;
    apiBaseUrlAlert.style.display = 'none';
  };

  const suggestedWorkerBaseUrl = [legacy.workerBaseUrl, config.apiBaseUrl]
    .find((value) => value && isLikelyWorkersUrl(value)) || '';

  const refreshApiDiagnostics = () => {
    const value = getInputValue('apiBaseUrl');
    if (!value) {
      updateApiStatus('unset');
      updateApiCheckedAt('-');
      hideApiAlert();
      return;
    }
    const now = new Date().toLocaleString();
    updateApiCheckedAt(now);
    if (!isValidHttpUrl(value)) {
      updateApiStatus('invalid', 'URL不正');
      showApiAlert('API ベースURLは https:// から始まるURLを入力してください。', false);
      return;
    }
    if (isLikelyPagesUrl(value)) {
      updateApiStatus('invalid', 'Pages/UI');
      showApiAlert('これはUI(Pages)のURLです。APIはWorkersのURL(例: https://xxx.workers.dev)を入力してください', true);
      return;
    }
    if (isLikelyWorkersUrl(value)) {
      updateApiStatus('valid');
      hideApiAlert();
      return;
    }
    updateApiStatus('unknown', '要確認');
    hideApiAlert();
  };

  let cachedEditorToken = '';
  let cachedEditorTokenExpiresAt = 0;

  const requestEditorSession = async (
    workerBaseUrl: string,
    kintoneBaseUrl: string,
    appId: string,
    options?: { silent?: boolean },
  ) => {
    const kintoneApiToken = getInputValue('kintoneApiToken');
    try {
      const res = await fetch(`${workerBaseUrl}/editor/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kintoneBaseUrl,
          appId: String(appId),
          ...(kintoneApiToken ? { kintoneApiToken } : {}),
        }),
      });
      if (!res.ok) {
        if (!options?.silent) {
          alert('Editor セッションの作成に失敗しました');
        }
        return '';
      }
      const json = (await res.json()) as { sessionToken?: string };
      return json.sessionToken ?? '';
    } catch {
      if (!options?.silent) {
        alert('Editor セッションの作成に失敗しました');
      }
      return '';
    }
  };

  const exchangeEditorToken = async (
    workerBaseUrl: string,
    sessionToken: string,
    options?: { silent?: boolean },
  ) => {
    if (!sessionToken) return '';
    try {
      const res = await fetch(`${workerBaseUrl}/editor/session/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: sessionToken }),
      });
      if (!res.ok) {
        if (!options?.silent) {
          alert('Editor トークンの取得に失敗しました');
        }
        return '';
      }
      const json = (await res.json()) as { editorToken?: string; expiresAt?: number };
      cachedEditorToken = json.editorToken ?? '';
      cachedEditorTokenExpiresAt = json.expiresAt ? Number(json.expiresAt) : 0;
      return cachedEditorToken;
    } catch {
      if (!options?.silent) {
        alert('Editor トークンの取得に失敗しました');
      }
      return '';
    }
  };

  const getEditorToken = async (
    workerBaseUrl: string,
    kintoneBaseUrl: string,
    appId: string,
  ) => {
    if (cachedEditorToken && cachedEditorTokenExpiresAt - Date.now() > 30_000) {
      return cachedEditorToken;
    }
    const sessionToken = await requestEditorSession(workerBaseUrl, kintoneBaseUrl, appId, {
      silent: true,
    });
    if (!sessionToken) return '';
    return exchangeEditorToken(workerBaseUrl, sessionToken, { silent: true });
  };

  const fetchUserTemplateMeta = async (
    workerBaseUrl: string,
    editorToken: string,
    templateId: string,
  ) => {
    const headers = { Authorization: `Bearer ${editorToken}` };
    const statuses = ['active', 'archived', 'deleted'] as const;
    for (const status of statuses) {
      let cursor = '';
      for (let page = 0; page < 5; page += 1) {
        const params = new URLSearchParams({ status, limit: '200' });
        if (cursor) params.set('cursor', cursor);
        const url = `${workerBaseUrl}/user-templates?${params.toString()}`;
        const res = await fetch(url, { headers, cache: 'no-store' });
        if (!res.ok) break;
        const data = (await res.json()) as { items?: Array<Record<string, any>>; nextCursor?: string };
        const items = Array.isArray(data.items) ? data.items : [];
        const found = items.find((item) => item?.templateId === templateId);
        if (found) return found;
        if (!data.nextCursor) break;
        cursor = data.nextCursor;
      }
    }
    return null;
  };

  let templateCheckSeq = 0;

  const applyTemplateInfo = (info: {
    label: string;
    updatedAt?: string;
    status: typeof currentTemplateStatus;
    validity: 'valid' | 'invalid' | 'unset' | 'unknown';
  }) => {
    updateSelectedTemplateBadge(info.label);
    updateTemplateUpdatedAt(info.updatedAt);
    updateTemplateStatus(info.status);
    updateTemplateCheckedAt(info.validity === 'unset' ? '-' : new Date().toLocaleString());
    if (info.validity === 'invalid') {
      setTemplateStateBadge('invalid', '選択中テンプレが存在しません。再選択してください。');
      return;
    }
    setTemplateStateBadge(info.validity);
  };

  const checkTemplateExists = async (templateId: string) => {
    const seq = (templateCheckSeq += 1);
    const applyIfLatest = (info: Parameters<typeof applyTemplateInfo>[0]) => {
      if (seq !== templateCheckSeq) return;
      applyTemplateInfo(info);
    };
    const clearTemplateSelection = (info?: {
      label?: string;
      updatedAt?: string;
      status?: typeof currentTemplateStatus;
    }) => {
      setInputValue('templateId', '');
      applyIfLatest({
        label: info?.label ?? '',
        updatedAt: info?.updatedAt,
        status: info?.status ?? 'not_found',
        validity: 'invalid',
      });
    };

    if (!templateId) {
      applyIfLatest({ label: '', status: 'unknown', validity: 'unset' });
      return;
    }
    const workerBaseUrl = normalizeBaseUrl(getInputValue('apiBaseUrl'));
    const kintoneBaseUrl = normalizeBaseUrl(location.origin);
    const appId = (kintone as any)?.app?.getId?.() ?? '';
    if (!workerBaseUrl || !appId) {
      applyIfLatest({ label: templateId, status: 'unknown', validity: 'unknown' });
      return;
    }
    if (isLikelyPagesUrl(workerBaseUrl)) {
      showApiAlert('これはUI(Pages)のURLです。APIはWorkersのURL(例: https://xxx.workers.dev)を入力してください', true);
      applyIfLatest({ label: templateId, status: 'unknown', validity: 'unknown' });
      return;
    }

    if (!templateId.startsWith('tpl_')) {
      const url = `${workerBaseUrl}/templates/${encodeURIComponent(templateId)}`;
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as { name?: string };
          applyIfLatest({
            label: data?.name || templateId,
            status: 'active',
            validity: 'valid',
          });
          return;
        }
      } catch {
        // fallthrough to invalid
      }
      applyIfLatest({ label: templateId, status: 'not_found', validity: 'invalid' });
      return;
    }

    const editorToken = await getEditorToken(workerBaseUrl, kintoneBaseUrl, String(appId));
    if (editorToken) {
      try {
        const meta = await fetchUserTemplateMeta(workerBaseUrl, editorToken, templateId);
        if (meta) {
          const status =
            meta.status === 'active' || meta.status === 'archived' || meta.status === 'deleted'
              ? meta.status
              : 'unknown';
          if (status !== 'active') {
            clearTemplateSelection({
              label: meta.name || templateId,
              updatedAt: meta.updatedAt,
              status,
            });
            return;
          }
          applyIfLatest({
            label: meta.name || templateId,
            updatedAt: meta.updatedAt,
            status,
            validity: 'valid',
          });
          return;
        }
      } catch {
        // fallthrough to query check
      }
    }

    const params = new URLSearchParams({
      kintoneBaseUrl,
      appId: String(appId),
      requireActive: '1',
    });
    const url = `${workerBaseUrl}/templates/${encodeURIComponent(templateId)}?${params.toString()}`;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { name?: string };
        applyIfLatest({
          label: data?.name || templateId,
          status: 'active',
          validity: 'valid',
        });
        return;
      }
    } catch {
      // fallthrough to invalid
    }
    clearTemplateSelection({ label: templateId, status: 'not_found' });
  };

  const handleTemplateIdChanged = (templateId: string) => {
    void checkTemplateExists(templateId);
  };

  const selectedTemplateIdFromUrl = readSelectedTemplateId();
  const initialTemplateId = selectedTemplateIdFromUrl !== null ? selectedTemplateIdFromUrl : config.templateId;
  setInputValue('templateId', initialTemplateId);
  refreshApiDiagnostics();
  handleTemplateIdChanged(initialTemplateId);
  if (selectedTemplateIdFromUrl !== null) {
    cleanSelectedTemplateIdFromUrl();
  }

  const templateIdInput = document.getElementById('templateId') as HTMLInputElement | null;
  templateIdInput?.addEventListener('input', () => {
    handleTemplateIdChanged(templateIdInput.value.trim());
  });

  const apiBaseUrlInput = document.getElementById('apiBaseUrl') as HTMLInputElement | null;
  apiBaseUrlInput?.addEventListener('input', () => {
    refreshApiDiagnostics();
    handleTemplateIdChanged(templateIdInput?.value.trim() ?? '');
  });

  fixApiBaseUrlButton?.addEventListener('click', () => {
    const apiInput = document.getElementById('apiBaseUrl') as HTMLInputElement | null;
    if (!apiInput) return;
    if (suggestedWorkerBaseUrl) {
      apiInput.value = suggestedWorkerBaseUrl;
    }
    apiInput.focus();
    apiInput.select();
    refreshApiDiagnostics();
    handleTemplateIdChanged(templateIdInput?.value.trim() ?? '');
  });

  document.getElementById('resetConfigButton')?.addEventListener('click', () => {
    if (!window.confirm('このプラグイン設定をリセットしますか？')) return;
    if (!PLUGIN_ID) {
      alert('プラグインIDが検出できませんでした');
      return;
    }
    (kintone as any).plugin?.app?.setConfig({
      apiBaseUrl: '',
      apiKey: '',
      kintoneApiToken: '',
      templateId: '',
      attachmentFieldCode: '',
      workerBaseUrl: '',
      workerApiKey: '',
      ui_base_url: '',
    });
    alert('設定をリセットしました。画面を更新してください。');
  });

  openTemplatePicker?.addEventListener('click', async () => {
    const workerBaseUrl = normalizeBaseUrl(getInputValue('apiBaseUrl'));
    const kintoneBaseUrl = normalizeBaseUrl(location.origin);
    const appId = (kintone as any)?.app?.getId?.() ?? '';
    const returnOrigin = getReturnOrigin();

    if (!workerBaseUrl) {
      alert('Worker接続情報が未設定です');
      return;
    }
    if (!/^https?:\/\//i.test(workerBaseUrl)) {
      alert('API ベースURLは https:// から始まるURLを入力してください。');
      return;
    }
    if (isLikelyPagesUrl(workerBaseUrl)) {
      showApiAlert('これはUI(Pages)のURLです。APIはWorkersのURL(例: https://xxx.workers.dev)を入力してください', true);
      alert('これはUI(Pages)のURLです。APIはWorkersのURL(例: https://xxx.workers.dev)を入力してください');
      return;
    }
    if (!appId) {
      alert('アプリIDが取得できません');
      return;
    }

    const sessionToken = await requestEditorSession(workerBaseUrl, kintoneBaseUrl, String(appId));
    if (!sessionToken) {
      alert('sessionToken が取得できません');
      return;
    }

    const url = buildPickerUrl({
      workerBaseUrl,
      kintoneBaseUrl,
      appId: String(appId),
      returnOrigin,
      sessionToken,
    });
    location.href = url;
  });

  openTemplateEditor?.addEventListener('click', async () => {
    const workerBaseUrl = normalizeBaseUrl(getInputValue('apiBaseUrl'));
    const kintoneBaseUrl = normalizeBaseUrl(location.origin);
    const appId = (kintone as any)?.app?.getId?.() ?? '';
    const templateId = getInputValue('templateId');
    const returnOrigin = getReturnOrigin();

    if (!workerBaseUrl) {
      alert('Worker接続情報が未設定です');
      return;
    }
    if (!/^https?:\/\//i.test(workerBaseUrl)) {
      alert('API ベースURLは https:// から始まるURLを入力してください。');
      return;
    }
    if (isLikelyPagesUrl(workerBaseUrl)) {
      showApiAlert('これはUI(Pages)のURLです。APIはWorkersのURL(例: https://xxx.workers.dev)を入力してください', true);
      alert('これはUI(Pages)のURLです。APIはWorkersのURL(例: https://xxx.workers.dev)を入力してください');
      return;
    }
    if (!appId) {
      alert('アプリIDが取得できません');
      return;
    }
    if (!templateId) {
      alert('テンプレートが未選択です');
      return;
    }
    if (!getInputValue('kintoneApiToken')) {
      alert('kintone APIトークンが未設定のため、フィールド一覧が取得できない可能性があります');
    }

    const sessionToken = await requestEditorSession(workerBaseUrl, kintoneBaseUrl, String(appId));
    if (!sessionToken) {
      alert('sessionToken が取得できません');
      return;
    }

    const url = buildEditUrl({
      templateId,
      workerBaseUrl,
      kintoneBaseUrl,
      appId: String(appId),
      returnOrigin,
      sessionToken,
    });
    location.href = url;
  });

  document.getElementById('saveButton')?.addEventListener('click', () => {
    const payload: PluginConfig = {
      apiBaseUrl: getInputValue('apiBaseUrl'),
      apiKey: getInputValue('apiKey'),
      kintoneApiToken: getInputValue('kintoneApiToken'),
      templateId: getInputValue('templateId'),
      attachmentFieldCode: getInputValue('attachmentFieldCode'),
    };

    if (!payload.apiBaseUrl || !payload.apiKey || !payload.attachmentFieldCode) {
      alert('必須項目が未入力です');
      return;
    }
    if (!/^https?:\/\//i.test(payload.apiBaseUrl)) {
      alert('API ベースURLは https:// から始まるURLを入力してください。');
      return;
    }
    if (isLikelyPagesUrl(payload.apiBaseUrl)) {
      alert('これはUI(Pages)のURLです。APIはWorkersのURL(例: https://xxx.workers.dev)を入力してください');
      return;
    }
    if (payload.templateId && currentTemplateValidity !== 'valid') {
      alert('選択中テンプレが存在しません。選び直してください。');
      return;
    }

    if (!PLUGIN_ID) {
      alert('プラグインIDが検出できませんでした');
      return;
    }

    const merged = { ...rawConfig, ...payload };
    (kintone as any).plugin?.app?.setConfig(merged);
  });

  document.getElementById('cancelButton')?.addEventListener('click', () => {
    history.back();
  });

  removeLoading();
};

const init = () => {
  if (window.kintone?.events?.on) {
    window.kintone.events.on('app.plugin.settings.show', (event) => {
      renderForm();
      return event;
    });
  }

  if (document.readyState !== 'loading') {
    renderForm();
  } else {
    document.addEventListener('DOMContentLoaded', renderForm);
  }
};

init();
