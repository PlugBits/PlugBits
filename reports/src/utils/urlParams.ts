export const getQueryParams = (locationSearch?: string, locationHash?: string) => {
  const hash = locationHash ?? window.location.hash ?? '';
  const hashIndex = hash.indexOf('?');
  if (hashIndex >= 0) {
    return new URLSearchParams(hash.slice(hashIndex + 1));
  }

  const qs = locationSearch ?? '';
  if (!qs || qs === '?') return new URLSearchParams();

  return new URLSearchParams(qs.startsWith('?') ? qs : `?${qs}`);
};

export const getKintoneContextFromParams = (params: URLSearchParams) => {
  const kintoneBaseUrl =
    params.get('kintoneBaseUrl') ??
    params.get('baseUrl') ??
    '';

  const appId =
    params.get('appId') ??
    params.get('kintoneAppId') ??
    '';

  const kintoneApiToken =
    params.get('kintoneApiToken') ??
    params.get('apiToken') ??
    '';

  return {
    kintoneBaseUrl,
    appId,
    kintoneApiToken,
  };
};

export const getSessionTokenFromParams = (params: URLSearchParams) =>
  params.get('sessionToken') ?? '';

export const getEditorTokenFromParams = (params: URLSearchParams) =>
  params.get('editorToken') ??
  params.get('token') ??
  '';

export const getReportsApiBaseUrlFromParams = (params: URLSearchParams) =>
  params.get('workerBaseUrl') ??
  params.get('reportsApiBaseUrl') ??
  params.get('apiBaseUrl') ??
  '';
