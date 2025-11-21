const PLUGIN_ID = (window as any).kintone?.$PLUGIN_ID || '';

type PluginConfig = {
  apiBaseUrl: string;
  apiKey: string;
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
    templateId: raw.templateId ?? '',
    attachmentFieldCode: raw.attachmentFieldCode ?? '',
  };
};

const createButton = (label: string) => {
  const button = document.createElement('button');
  button.textContent = label;
  button.className = 'kintoneplugin-button-normal plugbits-print-button';
  button.style.marginLeft = '8px';
  return button;
};

const notify = (message: string) => {
  alert(message);
};

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
        apiToken: config.apiKey,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PDF生成に失敗しました: ${text}`);
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

    button.disabled = true;
    button.textContent = 'PDF生成中...';

    try {
      const pdfBlob = await callRenderApi(config, recordId);
      const fileKey = await uploadFile(pdfBlob);
      await updateRecordAttachment(recordId, config.attachmentFieldCode, fileKey);
      notify('PDFを添付フィールドに保存しました');
      (window as any).kintone?.app?.record?.set(record);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'PDF生成に失敗しました');
    } finally {
      button.disabled = false;
      button.textContent = 'PDF出力 (PlugBits)';
    }
  });

  toolbar.appendChild(button);
};

const setupRecordDetailButton = () => {
  const config = getConfig();
  if (!config || !config.apiBaseUrl || !config.templateId || !config.attachmentFieldCode) {
    console.warn('PlugBits: プラグインが未設定です');
    return;
  }

  const events = ['app.record.detail.show'];
  (window as any).kintone?.events?.on(events, (event: any) => {
    addButton(config);
    return event;
  });
};

document.addEventListener('DOMContentLoaded', setupRecordDetailButton);
