// src/editor/Mapping/adapters/label_v1.ts
import type { StructureAdapter, ValidationResult } from "./StructureAdapter";
import type { LabelMapping, TemplateDefinition } from "@shared/template";

const ok = (): ValidationResult => ({ ok: true, errors: [] });

const normalizeMapping = (raw: unknown): LabelMapping => {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const slots = source.slots && typeof source.slots === "object"
    ? (source.slots as Record<string, unknown>)
    : {};
  const normalizeField = (value: unknown) =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : null;

  return {
    slots: {
      title: normalizeField(slots.title),
      code: normalizeField(slots.code),
      qty: normalizeField(slots.qty),
      qr: normalizeField(slots.qr),
      extra: normalizeField(slots.extra),
    },
    copiesFieldCode: normalizeField(source.copiesFieldCode),
  };
};

export const labelV1Adapter: StructureAdapter = {
  structureType: "label_v1",
  regions: [],

  createDefaultMapping(): LabelMapping {
    return normalizeMapping(undefined);
  },

  validate(): ValidationResult {
    return ok();
  },

  applyMappingToTemplate(template: TemplateDefinition, mapping: unknown): TemplateDefinition {
    return {
      ...template,
      structureType: "label_v1",
      mapping: normalizeMapping(mapping),
    };
  },
};
