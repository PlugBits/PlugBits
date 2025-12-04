"use strict";
(() => {
  // src/config/index.ts
  var getPluginId = () => window.kintone?.$PLUGIN_ID || "";
  var buildInitialConfig = () => ({
    apiBaseUrl: "",
    apiKey: "",
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
      apiKey: rawConfig.apiKey ?? "",
      templateId: rawConfig.templateId ?? "",
      attachmentFieldCode: rawConfig.attachmentFieldCode ?? ""
    };
  };
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

    <label class="kb-label" for="apiKey">API \u30AD\u30FC</label>
    <input class="kb-input" id="apiKey" type="password" />

    <label class="kb-label" for="templateId">\u30C6\u30F3\u30D7\u30EC\u30FC\u30C8ID</label>
    <input class="kb-input" id="templateId" type="text" />

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
    setInputValue("apiKey", config.apiKey);
    setInputValue("templateId", config.templateId);
    setInputValue("attachmentFieldCode", config.attachmentFieldCode);
    const getInputValue = (id) => document.getElementById(id)?.value.trim() || "";
    document.getElementById("saveButton")?.addEventListener("click", () => {
      const payload = {
        apiBaseUrl: getInputValue("apiBaseUrl"),
        apiKey: getInputValue("apiKey"),
        templateId: getInputValue("templateId"),
        attachmentFieldCode: getInputValue("attachmentFieldCode")
      };
      if (!payload.apiBaseUrl || !payload.templateId || !payload.attachmentFieldCode) {
        alert("\u5FC5\u9808\u9805\u76EE\u304C\u672A\u5165\u529B\u3067\u3059");
        return;
      }
      const pluginId = getPluginId();
      if (!pluginId) {
        alert("\u30D7\u30E9\u30B0\u30A4\u30F3ID\u304C\u691C\u51FA\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F");
        return;
      }
      window.kintone?.plugin?.app?.setConfig(payload);
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
