import { create } from 'zustand';
import type { CompanyProfile } from '@shared/template';

export type TenantContext = {
  workerBaseUrl: string;
  kintoneBaseUrl: string;
  appId: string;
  sessionToken: string;
  editorToken: string;
  companyProfile?: CompanyProfile;
};

type TenantStore = {
  tenantContext: TenantContext | null;
  setTenantContext: (ctx: TenantContext) => void;
  clearTenantContext: () => void;
};

export const useTenantStore = create<TenantStore>((set) => ({
  tenantContext: null,
  setTenantContext: (ctx) => set({ tenantContext: ctx }),
  clearTenantContext: () => set({ tenantContext: null }),
}));

export const getTenantContext = () => useTenantStore.getState().tenantContext;
