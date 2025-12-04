// src/services/templateService.ts

import type { TemplateDefinition } from '@shared/template';
import { SAMPLE_TEMPLATE } from '@shared/template';

const STORAGE_KEY = 'plugbits_reports_templates_v1';

// ---- 共通ユーティリティ ----

function readFromStorage(): TemplateDefinition[] {
  if (typeof localStorage === 'undefined') {
    // Worker や SSR で呼ばれた時の保険
    return [SAMPLE_TEMPLATE];
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [SAMPLE_TEMPLATE];
    }

    const parsed = JSON.parse(raw) as TemplateDefinition[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [SAMPLE_TEMPLATE];
    }

    return parsed;
  } catch {
    return [SAMPLE_TEMPLATE];
  }
}

function writeToStorage(templates: TemplateDefinition[]): void {
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  } catch {
    // 容量オーバーやシークレットモードなどで失敗することもあるが、
    // ここでは例外を投げずに無視しておく
  }
}

// ---- 公開 API（templateStore から呼ぶやつ） ----

/**
 * テンプレート一覧を取得
 * 将来的に Cloudflare Worker / D1 に差し替える場合も
 * この関数の中身だけ変えれば OK な想定。
 */
export async function fetchTemplates(): Promise<TemplateDefinition[]> {
  const templates = readFromStorage();
  return templates;
}

/**
 * テンプレートを新規作成 or 上書き保存
 * - id が既存と被っていれば上書き
 * - そうでなければ追加
 */
export async function createTemplateRemote(
  template: TemplateDefinition,
): Promise<TemplateDefinition> {
  const templates = readFromStorage();

  const existingIndex = templates.findIndex((t) => t.id === template.id);
  let next: TemplateDefinition[];

  if (existingIndex >= 0) {
    next = [...templates];
    next[existingIndex] = template;
  } else {
    next = [...templates, template];
  }

  writeToStorage(next);
  return template;
}

/**
 * テンプレートを削除
 */
export async function deleteTemplateRemote(templateId: string): Promise<void> {
  const templates = readFromStorage();
  const next = templates.filter((t) => t.id !== templateId);
  writeToStorage(next);
}
