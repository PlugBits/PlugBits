"use strict";
(() => {
  // src/desktop/index.ts
  var PLUGIN_ID = window.kintone?.$PLUGIN_ID || "";
  var getConfig = () => {
    if (!PLUGIN_ID) return null;
    const raw = window.kintone?.plugin?.app?.getConfig(PLUGIN_ID);
    if (!raw) return null;
    return {
      apiBaseUrl: raw.apiBaseUrl ?? "",
      apiKey: raw.apiKey ?? "",
      templateId: raw.templateId ?? "",
      attachmentFieldCode: raw.attachmentFieldCode ?? ""
    };
  };
  var createButton = (label) => {
    const button = document.createElement("button");
    button.textContent = label;
    button.className = "kintoneplugin-button-normal plugbits-print-button";
    button.style.marginLeft = "8px";
    return button;
  };
  var notify = (message) => {
    alert(message);
  };
  var uploadFile = async (blob) => {
    const formData = new FormData();
    formData.append("file", blob);
    const response = await fetch("/k/v1/file.json", {
      method: "POST",
      body: formData
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`\u30D5\u30A1\u30A4\u30EB\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${text}`);
    }
    const payload = await response.json();
    return payload.fileKey;
  };
  var updateRecordAttachment = async (recordId, attachmentFieldCode, fileKey) => {
    const response = await fetch("/k/v1/record.json", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app: window.kintone?.app?.getId?.(),
        id: recordId,
        record: {
          [attachmentFieldCode]: {
            value: [
              {
                fileKey
              }
            ]
          }
        }
      })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`\u30EC\u30B3\u30FC\u30C9\u66F4\u65B0\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${text}`);
    }
  };
  var callRenderApi = async (config, recordId) => {
    const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, "")}/render`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey
      },
      body: JSON.stringify({
        templateId: config.templateId,
        kintone: {
          baseUrl: location.origin,
          appId: window.kintone?.app?.getId?.(),
          recordId,
          apiToken: config.apiKey
        }
      })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`PDF\u751F\u6210\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${text}`);
    }
    return response.blob();
  };
  var addButton = (config) => {
    const toolbar = document.querySelector(".gaia-argoui-app-toolbar") || document.body;
    if (!toolbar) return;
    if (document.getElementById("plugbits-print-button")) return;
    const button = createButton("PDF\u51FA\u529B (PlugBits)");
    button.id = "plugbits-print-button";
    button.addEventListener("click", async () => {
      const record = window.kintone?.app?.record?.get()?.record;
      if (!record) {
        notify("\u30EC\u30B3\u30FC\u30C9\u60C5\u5831\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093");
        return;
      }
      const recordId = record.$id?.value;
      if (!recordId) {
        notify("\u30EC\u30B3\u30FC\u30C9ID\u304C\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093");
        return;
      }
      button.disabled = true;
      button.textContent = "PDF\u751F\u6210\u4E2D...";
      try {
        const pdfBlob = await callRenderApi(config, recordId);
        const fileKey = await uploadFile(pdfBlob);
        await updateRecordAttachment(recordId, config.attachmentFieldCode, fileKey);
        notify("PDF\u3092\u6DFB\u4ED8\u30D5\u30A3\u30FC\u30EB\u30C9\u306B\u4FDD\u5B58\u3057\u307E\u3057\u305F");
        window.kintone?.app?.record?.set(record);
      } catch (error) {
        notify(error instanceof Error ? error.message : "PDF\u751F\u6210\u306B\u5931\u6557\u3057\u307E\u3057\u305F");
      } finally {
        button.disabled = false;
        button.textContent = "PDF\u51FA\u529B (PlugBits)";
      }
    });
    toolbar.appendChild(button);
  };
  var setupRecordDetailButton = () => {
    const config = getConfig();
    if (!config || !config.apiBaseUrl || !config.templateId || !config.attachmentFieldCode) {
      console.warn("PlugBits: \u30D7\u30E9\u30B0\u30A4\u30F3\u304C\u672A\u8A2D\u5B9A\u3067\u3059");
      return;
    }
    const events = ["app.record.detail.show"];
    window.kintone?.events?.on(events, (event) => {
      addButton(config);
      return event;
    });
  };
  document.addEventListener("DOMContentLoaded", setupRecordDetailButton);
})();
