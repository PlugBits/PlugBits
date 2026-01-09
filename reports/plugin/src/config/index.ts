
const PLUGIN_ID =
  (typeof kintone !== 'undefined' ? (kintone as any).$PLUGIN_ID : '') || '';


export type PluginConfig = {
  workerBaseUrl: string;
  uiBaseUrl: string;
  workerApiKey: string;
  kintoneApiToken: string;
  templateId: string;
  attachmentFieldCode: string;
  itemsTableFieldCode: string;
  itemNameFieldCode: string;
  qtyFieldCode: string;
  unitPriceFieldCode: string;
  amountFieldCode: string;
  apiBaseUrl?: string;
  apiKey?: string;
};

type TemplateCatalogItem = {
  templateId: string;
  displayName: string;
  structureType: string;
  description?: string;
  version?: number;
  flags?: string[];
};

type TemplateCatalogResponse = {
  templates: TemplateCatalogItem[];
};

const buildInitialConfig = (): PluginConfig => ({
  workerBaseUrl: '',
  uiBaseUrl: '',
  workerApiKey: '',
  kintoneApiToken: '',
  templateId: '',
  attachmentFieldCode: '',
  itemsTableFieldCode: '',
  itemNameFieldCode: '',
  qtyFieldCode: '',
  unitPriceFieldCode: '',
  amountFieldCode: '',
  apiBaseUrl: '',
  apiKey: '',
});

const loadConfig = (): PluginConfig => {
  if (!PLUGIN_ID) {
    // 開発中などで kintone がまだ無い場合用（または初期値）
    return buildInitialConfig();
  }

  const rawConfig =
    (kintone as any).plugin?.app?.getConfig(PLUGIN_ID) || {};
  const workerBaseUrl = rawConfig.workerBaseUrl ?? rawConfig.apiBaseUrl ?? '';
  const workerApiKey = rawConfig.workerApiKey ?? rawConfig.apiKey ?? '';

  return {
    workerBaseUrl,
    uiBaseUrl: rawConfig.uiBaseUrl ?? '',
    workerApiKey,
    kintoneApiToken: rawConfig.kintoneApiToken ?? '',
    templateId: rawConfig.templateId ?? '',
    attachmentFieldCode: rawConfig.attachmentFieldCode ?? '',
    itemsTableFieldCode: rawConfig.itemsTableFieldCode ?? '',
    itemNameFieldCode: rawConfig.itemNameFieldCode ?? '',
    qtyFieldCode: rawConfig.qtyFieldCode ?? '',
    unitPriceFieldCode: rawConfig.unitPriceFieldCode ?? '',
    amountFieldCode: rawConfig.amountFieldCode ?? '',
    apiBaseUrl: workerBaseUrl,
    apiKey: workerApiKey,
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

    <label class="kb-label" for="apiBaseUrl">Worker ベースURL</label>
    <input class="kb-input" id="apiBaseUrl" type="text" placeholder="https://example.workers.dev" />

    <label class="kb-label" for="uiBaseUrl">UI ベースURL</label>
    <input class="kb-input" id="uiBaseUrl" type="text" placeholder="http://localhost:5173" />

    <label class="kb-label" for="apiKey">Worker API キー</label>
    <input class="kb-input" id="apiKey" type="password" />

    <label class="kb-label" for="kintoneApiToken">kintone APIトークン</label>
    <input class="kb-input" id="kintoneApiToken" type="password" placeholder="REST API用のトークン" />

    <label class="kb-label" for="templateSelect">テンプレを選択</label>
    <select class="kb-input" id="templateSelect"></select>
    <div class="kb-desc" id="templateCatalogStatus" style="margin-top:4px;"></div>
    <div class="kb-desc" style="margin-top:6px;">
      <div>説明: <span id="templateDescription">-</span></div>
      <div>structureType: <span id="templateStructureType">-</span></div>
    </div>

    <label class="kb-label" for="templateIdManual">テンプレID（手入力）</label>
    <input class="kb-input" id="templateIdManual" type="text" />
    <div class="kb-desc" id="selectedTemplateNotice" style="margin-top:4px;"></div>
    <div class="kb-desc" id="templateIdStatus" style="margin-top:4px; color:#b42318;"></div>
    <div class="kb-row" style="margin-top:6px;">
      <button id="openTemplatePicker" class="kb-btn" type="button">テンプレ一覧を開く</button>
      <button id="editTemplateButton" class="kb-btn" type="button">このテンプレを編集</button>
      <button id="openPickerEntry" class="kb-btn" type="button">テンプレを選ぶ/編集する</button>
    </div>

    <label class="kb-label" for="attachmentFieldCode">添付ファイルフィールドコード</label>
    <input class="kb-input" id="attachmentFieldCode" type="text" placeholder="attachment" />

    <label class="kb-label" for="itemsTableFieldCode">明細サブテーブル フィールドコード</label>
    <input class="kb-input" id="itemsTableFieldCode" type="text" placeholder="Items" />

    <label class="kb-label" for="itemNameFieldCode">品名フィールドコード</label>
    <input class="kb-input" id="itemNameFieldCode" type="text" placeholder="ItemName" />

    <label class="kb-label" for="qtyFieldCode">数量フィールドコード</label>
    <input class="kb-input" id="qtyFieldCode" type="text" placeholder="Qty" />

    <label class="kb-label" for="unitPriceFieldCode">単価フィールドコード</label>
    <input class="kb-input" id="unitPriceFieldCode" type="text" placeholder="UnitPrice" />

    <label class="kb-label" for="amountFieldCode">金額フィールドコード</label>
    <input class="kb-input" id="amountFieldCode" type="text" placeholder="Amount" />

    <div class="kb-row kb-toolbar">
      <button id="saveButton" class="kb-btn kb-primary" type="button">保存</button>
      <button id="cancelButton" class="kb-btn" type="button">キャンセル</button>
    </div>
  `;

  const setInputValue = (id: string, value: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = value;
  };
  setInputValue('apiBaseUrl', config.workerBaseUrl);
  setInputValue('uiBaseUrl', config.uiBaseUrl || 'http://localhost:5173');
  setInputValue('apiKey', config.workerApiKey);
  setInputValue('kintoneApiToken', config.kintoneApiToken);
  const selectedTemplateIdFromUrl = (() => {
    const hash = window.location.hash ?? '';
    const hashIndex = hash.indexOf('?');
    let qs = hashIndex >= 0 ? hash.slice(hashIndex + 1) : '';
    if (!qs) {
      qs = window.location.search ?? '';
    }
    if (!qs) return '';
    const params = new URLSearchParams(qs.startsWith('?') ? qs : `?${qs}`);
    return params.get('selectedTemplateId') ?? '';
  })();
  const initialTemplateId = selectedTemplateIdFromUrl || config.templateId;
  setInputValue('templateIdManual', initialTemplateId);
  setInputValue('attachmentFieldCode', config.attachmentFieldCode);
  setInputValue('itemsTableFieldCode', config.itemsTableFieldCode);
  setInputValue('itemNameFieldCode', config.itemNameFieldCode);
  setInputValue('qtyFieldCode', config.qtyFieldCode);
  setInputValue('unitPriceFieldCode', config.unitPriceFieldCode);
  setInputValue('amountFieldCode', config.amountFieldCode);

  const getInputValue = (id: string) => (document.getElementById(id) as HTMLInputElement)?.value.trim() || '';
  const templateSelect = document.getElementById('templateSelect') as HTMLSelectElement | null;
  const templateIdManual = document.getElementById('templateIdManual') as HTMLInputElement | null;
  const templateDescription = document.getElementById('templateDescription') as HTMLElement | null;
  const templateStructureType = document.getElementById('templateStructureType') as HTMLElement | null;
  const catalogStatus = document.getElementById('templateCatalogStatus') as HTMLElement | null;
  const selectedTemplateNotice = document.getElementById('selectedTemplateNotice') as HTMLElement | null;
  const templateIdStatus = document.getElementById('templateIdStatus') as HTMLElement | null;
  const openTemplatePicker = document.getElementById('openTemplatePicker') as HTMLButtonElement | null;
  const editTemplateButton = document.getElementById('editTemplateButton') as HTMLButtonElement | null;
  const openPickerEntry = document.getElementById('openPickerEntry') as HTMLButtonElement | null;
  const CUSTOM_OPTION = '__custom__';
  let catalogCache: TemplateCatalogItem[] | null = null;

  const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');
  const getUiOrigin = (value: string) => {
    if (!value) return '';
    try {
      return new URL(normalizeBaseUrl(value)).origin;
    } catch {
      return '';
    }
  };

  const updateSelectedTemplateNotice = (templateId: string) => {
    if (!selectedTemplateNotice) return;
    selectedTemplateNotice.textContent = templateId ? `選択中: ${templateId}` : '';
  };

  const showTemplateWarning = (message: string) => {
    if (templateIdStatus) templateIdStatus.textContent = message;
    if (openPickerEntry) openPickerEntry.classList.add('kb-primary');
  };

  const clearTemplateWarning = () => {
    if (templateIdStatus) templateIdStatus.textContent = '';
    if (openPickerEntry) openPickerEntry.classList.remove('kb-primary');
  };

  const checkTemplateExists = async (templateId: string) => {
    if (!templateId.startsWith('tpl_')) {
      clearTemplateWarning();
      return;
    }
    const workerBaseUrl = normalizeBaseUrl(getInputValue('apiBaseUrl'));
    const kintoneBaseUrl = normalizeBaseUrl(location.origin);
    const appId = (kintone as any)?.app?.getId?.() ?? '';
    if (!workerBaseUrl || !appId) return;
    const url = `${workerBaseUrl}/templates/${encodeURIComponent(templateId)}?` +
      `kintoneBaseUrl=${encodeURIComponent(kintoneBaseUrl)}&appId=${encodeURIComponent(String(appId))}`;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        showTemplateWarning('テンプレが見つかりません。再選択してください。');
        return;
      }
      clearTemplateWarning();
    } catch {
      showTemplateWarning('テンプレが見つかりません。再選択してください。');
    }
  };

  const handleTemplateIdChanged = (templateId: string) => {
    updateSelectedTemplateNotice(templateId);
    void checkTemplateExists(templateId);
  };

  const setTemplateMeta = (item?: TemplateCatalogItem) => {
    if (templateDescription) {
      templateDescription.textContent = item?.description || '-';
    }
    if (templateStructureType) {
      templateStructureType.textContent = item?.structureType || '-';
    }
  };

  const applyTemplateSelection = (
    selectedId: string,
    catalog: TemplateCatalogItem[] | null,
  ) => {
    if (!templateSelect || !templateIdManual) return;
    const match = catalog?.find((tpl) => tpl.templateId === selectedId);
    if (match) {
      templateSelect.value = match.templateId;
      templateIdManual.value = match.templateId;
      templateIdManual.disabled = true;
      setTemplateMeta(match);
      handleTemplateIdChanged(match.templateId);
      return;
    }
    templateSelect.value = CUSTOM_OPTION;
    templateIdManual.value = selectedId;
    templateIdManual.disabled = false;
    setTemplateMeta(undefined);
    handleTemplateIdChanged(selectedId);
  };

  const renderCatalogOptions = (
    catalog: TemplateCatalogItem[] | null,
    selectedId: string,
  ) => {
    if (!templateSelect) return;
    templateSelect.innerHTML = '';
    catalogCache = catalog;
    if (catalog && catalog.length > 0) {
      for (const tpl of catalog) {
        const opt = document.createElement('option');
        opt.value = tpl.templateId;
        opt.textContent = `${tpl.displayName} (${tpl.templateId})`;
        templateSelect.appendChild(opt);
      }
    }
    const customOpt = document.createElement('option');
    customOpt.value = CUSTOM_OPTION;
    customOpt.textContent = 'カスタム（手入力）';
    templateSelect.appendChild(customOpt);
    applyTemplateSelection(selectedId, catalog);
  };

  const loadCatalog = async (baseUrl: string, selectedId: string) => {
    if (!templateSelect || !templateIdManual) return;
    if (!baseUrl) {
      renderCatalogOptions(null, selectedId);
      if (catalogStatus) catalogStatus.textContent = 'APIベースURLが未設定のためカタログは取得できません。';
      return;
    }
    const catalogUrl = `${normalizeBaseUrl(baseUrl)}/templates-catalog`;
    try {
      const res = await fetch(catalogUrl, { method: 'GET' });
      if (!res.ok) {
        throw new Error(`status ${res.status}`);
      }
      const data = (await res.json()) as TemplateCatalogResponse;
      const templates = Array.isArray(data.templates) ? data.templates : [];
      renderCatalogOptions(templates, selectedId);
      if (catalogStatus) catalogStatus.textContent = '';
    } catch (error) {
      console.warn('テンプレカタログ取得に失敗しました', error);
      renderCatalogOptions(null, selectedId);
      if (catalogStatus) {
        catalogStatus.textContent = 'テンプレカタログの取得に失敗しました。手入力で指定してください。';
      }
    }
  };

  templateSelect?.addEventListener('change', () => {
    if (!templateSelect || !templateIdManual) return;
    if (templateSelect.value === CUSTOM_OPTION) {
      templateIdManual.disabled = false;
      templateIdManual.focus();
      setTemplateMeta(undefined);
      updateEditButtonState();
      return;
    }
    templateIdManual.value = templateSelect.value;
    templateIdManual.disabled = true;
    const match = catalogCache?.find((tpl) => tpl.templateId === templateSelect.value);
    setTemplateMeta(match);
    updateEditButtonState();
    handleTemplateIdChanged(templateSelect.value);
  });

  templateIdManual?.addEventListener('input', () => {
    if (!templateSelect) return;
    if (templateSelect.value !== CUSTOM_OPTION) return;
    setTemplateMeta(undefined);
    updateEditButtonState();
    handleTemplateIdChanged(templateIdManual.value);
  });

  const updateEditButtonState = () => {
    if (!editTemplateButton) return;
    const templateId = getInputValue('templateIdManual');
    editTemplateButton.disabled = !templateId;
  };

  updateEditButtonState();
  handleTemplateIdChanged(initialTemplateId);

  const handleTemplatePicked = (event: MessageEvent) => {
    if (!event?.data || event.data.type !== 'PB_TEMPLATE_PICKED') return;
    const expectedOrigin = getUiOrigin(getInputValue('uiBaseUrl'));
    if (!expectedOrigin || event.origin !== expectedOrigin) return;
    const templateId = String(event.data.templateId ?? '');
    if (!templateId) return;
    applyTemplateSelection(templateId, catalogCache);
    updateEditButtonState();
  };

  window.addEventListener('message', handleTemplatePicked);

  openTemplatePicker?.addEventListener('click', () => {
    const uiBaseUrl = normalizeBaseUrl(getInputValue('uiBaseUrl'));
    if (!uiBaseUrl) {
      alert('UIベースURLが未設定です');
      return;
    }
    const ui = uiBaseUrl.replace(/\/$/, '');
    const returnOrigin = location.href;
    const kintoneBaseUrl = location.origin;
    const appId = (kintone as any)?.app?.getId?.() ?? '';
    const token = getInputValue('kintoneApiToken');
    const workerBaseUrl = getInputValue('apiBaseUrl');
    const params = new URLSearchParams({
      mode: 'picker',
      returnOrigin,
      kintoneBaseUrl,
      appId: String(appId),
      ...(workerBaseUrl ? { workerBaseUrl } : {}),
      ...(token ? { kintoneApiToken: token } : {}),
    });
    const openUrl = `${ui}/#/templates?${params.toString()}`;
    console.log('[PlugBits] open picker url', openUrl);
    location.assign(openUrl);
  });

  openPickerEntry?.addEventListener('click', async () => {
    const editorOrigin = normalizeBaseUrl(getInputValue('uiBaseUrl'));
    const workerBaseUrl = normalizeBaseUrl(getInputValue('apiBaseUrl'));
    const kintoneBaseUrl = normalizeBaseUrl(location.origin);
    const appId = (kintone as any)?.app?.getId?.() ?? '';
    const kintoneApiToken = getInputValue('kintoneApiToken');
    const returnOrigin = location.href;
    if (!editorOrigin) {
      alert('UIベースURLが未設定です');
      return;
    }
    if (!workerBaseUrl) {
      alert('WorkerベースURLが未設定です');
      return;
    }
    if (!appId) {
      alert('アプリIDが取得できません');
      return;
    }

    let sessionToken = '';
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
        alert('Editor セッションの作成に失敗しました');
        return;
      }
      const json = (await res.json()) as { sessionToken?: string };
      sessionToken = json.sessionToken ?? '';
    } catch {
      alert('Editor セッションの作成に失敗しました');
      return;
    }

    if (!sessionToken) {
      alert('sessionToken が取得できません');
      return;
    }

    const params = new URLSearchParams({
      mode: 'picker',
      sessionToken,
      workerBaseUrl,
      kintoneBaseUrl,
      appId: String(appId),
      returnOrigin,
    });
    const url = `${editorOrigin}/#/picker?${params.toString()}`;
    console.log('[PlugBits] session issued', sessionToken);
    console.log('[PlugBits] open picker url', url);
    location.assign(url);
  });

  editTemplateButton?.addEventListener('click', () => {
    if (!editTemplateButton || editTemplateButton.disabled) return;
    const uiBaseUrl = normalizeBaseUrl(getInputValue('uiBaseUrl'));
    if (!uiBaseUrl) {
      alert('UI ベースURLが未設定です');
      return;
    }
    const templateId = getInputValue('templateIdManual');
    if (!templateId) {
      alert('テンプレIDが未設定です');
      return;
    }
    const kintoneBaseUrl = location.origin;
    const appId = (kintone as any)?.app?.getId?.() ?? '';
    const token = getInputValue('kintoneApiToken');
    const workerBaseUrl = getInputValue('apiBaseUrl');
    const params = new URLSearchParams({
      kintoneBaseUrl,
      appId: String(appId),
      ...(workerBaseUrl ? { workerBaseUrl } : {}),
      ...(token ? { kintoneApiToken: token } : {}),
    });
    const editUrl =
      `${uiBaseUrl.replace(/\/$/, '')}/#/templates/${encodeURIComponent(templateId)}/edit` +
      `?${params.toString()}`;
    location.assign(editUrl);
  });

  if (selectedTemplateIdFromUrl) {
    console.log('[PlugBits] selectedTemplateId', selectedTemplateIdFromUrl);
  }
  loadCatalog(config.workerBaseUrl, initialTemplateId);

  document.getElementById('saveButton')?.addEventListener('click', () => {
    const resolvedTemplateId =
      templateSelect && templateSelect.value !== CUSTOM_OPTION
        ? templateSelect.value
        : getInputValue('templateIdManual');

    const workerBaseUrl = getInputValue('apiBaseUrl');
    const workerApiKey = getInputValue('apiKey');
    const payload: PluginConfig = {
      workerBaseUrl,
      uiBaseUrl: getInputValue('uiBaseUrl'),
      workerApiKey,
      kintoneApiToken: getInputValue('kintoneApiToken'),
      templateId: resolvedTemplateId,
      attachmentFieldCode: getInputValue('attachmentFieldCode'),
      itemsTableFieldCode: getInputValue('itemsTableFieldCode'),
      itemNameFieldCode: getInputValue('itemNameFieldCode'),
      qtyFieldCode: getInputValue('qtyFieldCode'),
      unitPriceFieldCode: getInputValue('unitPriceFieldCode'),
      amountFieldCode: getInputValue('amountFieldCode'),
      apiBaseUrl: workerBaseUrl,
      apiKey: workerApiKey,
    };

    if (
      !payload.workerBaseUrl ||
      !payload.uiBaseUrl ||
      !payload.templateId ||
      !payload.attachmentFieldCode
    ) {
      alert('必須項目が未入力です');
      return;
    }

    (kintone as any).plugin?.app?.setConfig(payload);
    console.log('[PlugBits] config saved');

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
