// src/editor/Mapping/adapters/StructureAdapter.ts
import type { TemplateDefinition } from '@shared/template';

export type SlotKind = "text" | "date" | "number" | "currency" | "image" | "multiline";
export type AllowedSource = "recordField" | "staticText" | "imageUrl";

export type SlotDef = {
  id: string;
  label: string;
  required?: boolean;
  kind: SlotKind;
  allowedSources?: AllowedSource[];
};

export type SlotsRegionDef = {
  kind: "slots";
  id: string;     // "header" | "footer" | "card" | etc
  label: string;  // UI表示名
  slots: SlotDef[];
};

export type TableBaseColumnDef = {
  id: string;
  label: string;
  required?: boolean;
  defaultWidthPct: number;
  kind: Exclude<SlotKind, "image">; // table columns never image
};

export type TableRegionDef = {
  kind: "table";
  id: string;    // usually "table"
  label: string;
  sourceRequired: boolean;
  minCols: number;
  maxCols: number;
  baseColumns: TableBaseColumnDef[];
};

export type CardListFieldDef = {
  id: string;
  label: string;
  required?: boolean;
  kind?: SlotKind;
};

export type CardListRegionDef = {
  kind: "cardList";
  id: string;
  label: string;
  sourceRequired: boolean;
  fields: CardListFieldDef[];
};

export type RegionDef = SlotsRegionDef | TableRegionDef | CardListRegionDef;

export type ValidationError = { path: string; message: string };
export type ValidationResult = { ok: boolean; errors: ValidationError[] };

export type StructureAdapter = {
  structureType: string;
  regions: RegionDef[];

  // 初期mapping（template新規作成時や、既存テンプレにmappingが無い時）
  createDefaultMapping(): unknown;

  // 構造ごとの必須チェック等（MVPは軽くてOK）
  validate(mapping: unknown): ValidationResult;
  applyMappingToTemplate: (template: TemplateDefinition, mapping: unknown) => TemplateDefinition;
};
