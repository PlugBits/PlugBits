export const getQueryParams = (locationSearch?: string, locationHash?: string) => {
  const qs = locationSearch ?? '';
  const searchParams = qs && qs !== '?'
    ? new URLSearchParams(qs.startsWith('?') ? qs : `?${qs}`)
    : new URLSearchParams();

  const hash = locationHash ?? window.location.hash ?? '';
  const hashIndex = hash.indexOf('?');
  if (hashIndex >= 0) {
    const hashParams = new URLSearchParams(hash.slice(hashIndex + 1));
    hashParams.forEach((value, key) => {
      searchParams.set(key, value);
    });
  }

  return searchParams;
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

export const getCompanyProfileFromParams = (params: URLSearchParams) => ({
  companyName: params.get('companyName') ?? '',
  companyAddress: params.get('companyAddress') ?? '',
  companyTel: params.get('companyTel') ?? '',
  companyEmail: params.get('companyEmail') ?? '',
});

export const getReportsApiBaseUrlFromParams = (_params: URLSearchParams) => WORKER_BASE_URL;
import { WORKER_BASE_URL } from '../constants';
