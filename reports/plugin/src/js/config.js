"use strict";
(() => {
  // src/config/index.ts
  var getPluginId = () => window.kintone?.$PLUGIN_ID || "";
  var buildInitialConfig = () => ({
    apiBaseUrl: "",
    uiBaseUrl: "",
    apiKey: "",
    kintoneApiToken: "",
    templateId: "",
    attachmentFieldCode: ""
  });
  var loadConfig = () => {
    const pluginId = getPluginId();
    if (!pluginId) {
      return buildInitialConfig();
    }
    const rawConfig = window.kintone?.plugin?.app?.getConfig(pluginId) || {};
    return {
      apiBaseUrl: rawConfig.apiBaseUrl ?? "",
      uiBaseUrl: rawConfig.uiBaseUrl ?? "",
      apiKey: rawConfig.apiKey ?? "",
      kintoneApiToken: rawConfig.kintoneApiToken ?? "",
      templateId: rawConfig.templateId ?? "",
      attachmentFieldCode: rawConfig.attachmentFieldCode ?? ""
    };
  };
  function handleTemplateIdChanged(nextTemplateId) {
    try {
      const input = document.getElementById("templateId");
      if (input) {
        input.value = nextTemplateId || "";
      }
      const notice = document.getElementById("selectedTemplateNotice");
      if (notice) {
        notice.textContent = nextTemplateId ? `Selected: ${nextTemplateId}` : "";
      }
    } catch (error) {
      console.warn("[PlugBits][config] handleTemplateIdChanged noop", error);
    }
  }
  var renderForm = () => {
    const container = document.getElementById("plugbits-plugin-config");
    if (!container) return;
    const config = loadConfig();
    container.innerHTML = `
    <h1 class="kb-title">PlugBits \u5E33\u7968\u30D7\u30E9\u30B0\u30A4\u30F3\u8A2D\u5B9A</h1>
    <p class="kb-desc">
      Cloudflare Workers \u3067\u7A3C\u50CD\u3059\u308B PlugBits Reports API \u306E\u63A5\u7D9A\u60C5\u5831\u3068\u3001\u751F\u6210\u3057\u305F PDF
      \u3092\u6DFB\u4ED8\u3059\u308B\u30D5\u30A3\u30FC\u30EB\u30C9\u30B3\u30FC\u30C9\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002
    </p>

    <label class="kb-label" for="apiBaseUrl">API \u30D9\u30FC\u30B9URL</label>
    <input class="kb-input" id="apiBaseUrl" type="text" placeholder="https://example.workers.dev" />

    <label class="kb-label" for="uiBaseUrl">UI \u30D9\u30FC\u30B9URL</label>
    <input class="kb-input" id="uiBaseUrl" type="text" placeholder="http://localhost:5173" />

    <label class="kb-label" for="apiKey">Worker API \u30AD\u30FC</label>
    <input class="kb-input" id="apiKey" type="password" />

    <label class="kb-label" for="kintoneApiToken">kintone API\u30C8\u30FC\u30AF\u30F3</label>
    <input class="kb-input" id="kintoneApiToken" type="password" placeholder="REST API\u7528\u306E\u30C8\u30FC\u30AF\u30F3" />

    <label class="kb-label" for="templateId">\u30C6\u30F3\u30D7\u30EC\u30FC\u30C8ID</label>
    <input class="kb-input" id="templateId" type="text" />
    <div class="kb-desc" id="selectedTemplateNotice" style="margin-top:4px;"></div>
    <div class="kb-desc" id="templateIdStatus" style="margin-top:4px; color:#b42318;"></div>
    <div class="kb-row" style="margin-top:6px;">
      <button id="openPickerEntry" class="kb-btn" type="button">\u30C6\u30F3\u30D7\u30EC\u3092\u9078\u3076/\u7DE8\u96C6\u3059\u308B</button>
    </div>

    <label class="kb-label" for="attachmentFieldCode">\u6DFB\u4ED8\u30D5\u30A1\u30A4\u30EB\u30D5\u30A3\u30FC\u30EB\u30C9\u30B3\u30FC\u30C9</label>
    <input class="kb-input" id="attachmentFieldCode" type="text" placeholder="attachment" />

    <div class="kb-row kb-toolbar">
      <button id="saveButton" class="kb-btn kb-primary" type="button">\u4FDD\u5B58</button>
      <button id="cancelButton" class="kb-btn" type="button">\u30AD\u30E3\u30F3\u30BB\u30EB</button>
    </div>
  `;
    const setInputValue = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    };
    setInputValue("apiBaseUrl", config.apiBaseUrl);
    setInputValue("uiBaseUrl", config.uiBaseUrl || "http://localhost:5173");
    setInputValue("apiKey", config.apiKey);
    setInputValue("kintoneApiToken", config.kintoneApiToken);
    const selectedTemplateIdFromUrl = (() => {
      const hash = window.location.hash ?? "";
      const hashIndex = hash.indexOf("?");
      let qs = hashIndex >= 0 ? hash.slice(hashIndex + 1) : "";
      if (!qs) {
        qs = window.location.search ?? "";
      }
      if (!qs) return "";
      const params2 = new URLSearchParams(qs.startsWith("?") ? qs : `?${qs}`);
      return params2.get("selectedTemplateId") ?? "";
    })();
    const initialTemplateId = selectedTemplateIdFromUrl || config.templateId;
    setInputValue("templateId", initialTemplateId);
    setInputValue("attachmentFieldCode", config.attachmentFieldCode);
    const getInputValue = (id) => document.getElementById(id)?.value.trim() || "";
    const normalizeBaseUrl = (value) => value.replace(/\/+$/, "");
    const selectedTemplateNotice = document.getElementById("selectedTemplateNotice");
    const templateIdStatus = document.getElementById("templateIdStatus");
    const openPickerEntry = document.getElementById("openPickerEntry");
    const updateSelectedTemplateNotice = (templateId) => {
      if (!selectedTemplateNotice) return;
      selectedTemplateNotice.textContent = templateId ? `\u9078\u629E\u4E2D: ${templateId}` : "";
    };
    const showTemplateWarning = (message) => {
      if (templateIdStatus) templateIdStatus.textContent = message;
      if (openPickerEntry) openPickerEntry.classList.add("kb-primary");
    };
    const clearTemplateWarning = () => {
      if (templateIdStatus) templateIdStatus.textContent = "";
      if (openPickerEntry) openPickerEntry.classList.remove("kb-primary");
    };
    const checkTemplateExists = async (templateId) => {
      if (!templateId.startsWith("tpl_")) {
        clearTemplateWarning();
        return;
      }
      const workerBaseUrl = normalizeBaseUrl(getInputValue("apiBaseUrl"));
      const kintoneBaseUrl = normalizeBaseUrl(location.origin);
      const appId = window.kintone?.app?.getId?.() ?? "";
      if (!workerBaseUrl || !appId) return;
      const url = `${workerBaseUrl}/templates/${encodeURIComponent(templateId)}?` + `kintoneBaseUrl=${encodeURIComponent(kintoneBaseUrl)}&appId=${encodeURIComponent(String(appId))}`;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          showTemplateWarning("\u30C6\u30F3\u30D7\u30EC\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002\u518D\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
          return;
        }
        clearTemplateWarning();
      } catch {
        showTemplateWarning("\u30C6\u30F3\u30D7\u30EC\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002\u518D\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      }
    };
    const handleTemplateIdChanged = (templateId) => {
      updateSelectedTemplateNotice(templateId);
      void checkTemplateExists(templateId);
    };
    const templateIdInput = document.getElementById("templateId");
    templateIdInput?.addEventListener("input", () => {
      handleTemplateIdChanged(templateIdInput.value.trim());
    });
    handleTemplateIdChanged(initialTemplateId);
    openPickerEntry?.addEventListener("click", async () => {
      const editorOrigin = normalizeBaseUrl(getInputValue("uiBaseUrl"));
      const workerBaseUrl = normalizeBaseUrl(getInputValue("apiBaseUrl"));
      const kintoneBaseUrl = normalizeBaseUrl(location.origin);
      const appId = window.kintone?.app?.getId?.() ?? "";
      const kintoneApiToken = getInputValue("kintoneApiToken");
      const returnOrigin = location.href;
      if (!editorOrigin) {
        alert("UI\u30D9\u30FC\u30B9URL\u304C\u672A\u8A2D\u5B9A\u3067\u3059");
        return;
      }
      if (!workerBaseUrl) {
        alert("Worker\u30D9\u30FC\u30B9URL\u304C\u672A\u8A2D\u5B9A\u3067\u3059");
        return;
      }
      if (!appId) {
        alert("\u30A2\u30D7\u30EAID\u304C\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093");
        return;
      }
      let sessionToken = "";
      try {
        const res = await fetch(`${workerBaseUrl}/editor/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kintoneBaseUrl,
            appId: String(appId),
            ...kintoneApiToken ? { kintoneApiToken } : {}
          })
        });
        if (!res.ok) {
          alert("Editor \u30BB\u30C3\u30B7\u30E7\u30F3\u306E\u4F5C\u6210\u306B\u5931\u6557\u3057\u307E\u3057\u305F");
          return;
        }
        const json = await res.json();
        sessionToken = json.sessionToken ?? "";
      } catch {
        alert("Editor \u30BB\u30C3\u30B7\u30E7\u30F3\u306E\u4F5C\u6210\u306B\u5931\u6557\u3057\u307E\u3057\u305F");
        return;
      }
      if (!sessionToken) {
        alert("sessionToken \u304C\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093");
        return;
      }
      const params = new URLSearchParams({
        mode: "picker",
        sessionToken,
        workerBaseUrl,
        kintoneBaseUrl,
        appId: String(appId),
        returnOrigin
      });
      const url = `${editorOrigin}/#/picker?${params.toString()}`;
      console.log("[PlugBits] session issued", sessionToken);
      console.log("[PlugBits] open picker url", url);
      window.open(url, "_blank", "noopener,noreferrer");
    });
    if (selectedTemplateIdFromUrl) {
      console.log("[PlugBits] selectedTemplateId", selectedTemplateIdFromUrl);
    }
    document.getElementById("saveButton")?.addEventListener("click", () => {
      const payload = {
        apiBaseUrl: getInputValue("apiBaseUrl"),
        uiBaseUrl: getInputValue("uiBaseUrl"),
        apiKey: getInputValue("apiKey"),
        kintoneApiToken: getInputValue("kintoneApiToken"),
        templateId: getInputValue("templateId"),
        attachmentFieldCode: getInputValue("attachmentFieldCode")
      };
      if (!payload.apiBaseUrl || !payload.apiKey || !payload.templateId || !payload.attachmentFieldCode) {
        alert("\u5FC5\u9808\u9805\u76EE\u304C\u672A\u5165\u529B\u3067\u3059");
        return;
      }
      const pluginId = getPluginId();
      if (!pluginId) {
        alert("\u30D7\u30E9\u30B0\u30A4\u30F3ID\u304C\u691C\u51FA\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F");
        return;
      }
      window.kintone?.plugin?.app?.setConfig(payload);
      console.log("[PlugBits] config saved");
    });
    document.getElementById("cancelButton")?.addEventListener("click", () => {
      history.back();
    });
  };
  var init = () => {
    if (window.kintone?.events?.on) {
      window.kintone.events.on("app.plugin.settings.show", (event) => {
        renderForm();
        return event;
      });
    } else {
      document.addEventListener("DOMContentLoaded", renderForm);
    }
  };
  init();
})();
