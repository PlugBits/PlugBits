// src/editor/Mapping/adapters/cards_v1.ts
import type { StructureAdapter, ValidationResult } from "./StructureAdapter";
import type { TemplateDefinition, TemplateElement, CardListElement } from "@shared/template";

const ok = (): ValidationResult => ({ ok: true, errors: [] });
const ng = (errors: ValidationResult["errors"]): ValidationResult => ({ ok: false, errors });

type FieldRef =
  | { kind: "recordField"; fieldCode: string }
  | { kind: "staticText"; text: string }
  | { kind: "imageUrl"; url: string }
  | { kind: "subtable"; fieldCode: string }
  | { kind: "subtableField"; subtableCode: string; fieldCode: string };

type CardListMapping = {
  source?: { kind: "subtable"; fieldCode: string };
  fields?: Record<string, FieldRef | undefined>;
};

export type CardsV1Mapping = {
  header: Record<string, FieldRef | undefined>;
  cardList: CardListMapping;
  footer: Record<string, FieldRef | undefined>;
};

export const cardsV1Adapter: StructureAdapter = {
  structureType: "cards_v1",

  regions: [
    {
      kind: "slots",
      id: "header",
      label: "Header",
      slots: [
        { id: "doc_title", label: "タイトル", kind: "text", allowedSources: ["staticText", "recordField"] },
        { id: "to_name", label: "宛先名", kind: "text", required: true, allowedSources: ["recordField"] },
        { id: "date_label", label: "日付ラベル", kind: "text", allowedSources: ["staticText", "recordField"] },
        { id: "issue_date", label: "日付", kind: "date", required: true, allowedSources: ["recordField"] },
        { id: "doc_no", label: "文書番号", kind: "text", allowedSources: ["recordField"] },
        { id: "logo", label: "ロゴ", kind: "image", allowedSources: ["imageUrl"] },
      ],
    },
    {
      kind: "cardList",
      id: "cardList",
      label: "カード枠",
      sourceRequired: true,
      fields: [
        { id: "fieldA", label: "Field A", kind: "text", required: true },
        { id: "fieldB", label: "Field B", kind: "text" },
        { id: "fieldC", label: "Field C", kind: "text" },
        { id: "fieldD", label: "Field D", kind: "text" },
        { id: "fieldE", label: "Field E", kind: "text" },
        { id: "fieldF", label: "Field F", kind: "text" },
      ],
    },
    {
      kind: "slots",
      id: "footer",
      label: "Footer",
      slots: [
        { id: "remarks", label: "備考", kind: "multiline", allowedSources: ["recordField", "staticText"] },
        { id: "total_label", label: "合計ラベル", kind: "text", allowedSources: ["recordField", "staticText"] },
        { id: "total", label: "合計", kind: "currency", allowedSources: ["recordField"] },
      ],
    },
  ],

  createDefaultMapping(): CardsV1Mapping {
    return {
      header: {
        doc_title: { kind: "staticText", text: "Card" },
        date_label: { kind: "staticText", text: "日付" },
      },
      cardList: {
        fields: {},
      },
      footer: {},
    };
  },

  validate(mapping: unknown): ValidationResult {
    const m = mapping as Partial<CardsV1Mapping> | undefined;
    if (!m) return ng([{ path: "mapping", message: "mapping がありません" }]);

    const errors: ValidationResult["errors"] = [];

    const toName = m.header?.["to_name"];
    const issueDate = m.header?.["issue_date"];

    if (!toName || toName.kind !== "recordField") {
      errors.push({ path: "header.to_name", message: "宛先名（レコードフィールド）が必須です" });
    }
    if (!issueDate || issueDate.kind !== "recordField") {
      errors.push({ path: "header.issue_date", message: "発行日（レコードフィールド）が必須です" });
    }

    const source = m.cardList?.source;
    if (!source || source.kind !== "subtable" || !source.fieldCode) {
      errors.push({ path: "cardList.source", message: "カード用サブテーブルの指定が必須です" });
    }

    const fieldA = m.cardList?.fields?.fieldA;
    if (!fieldA || fieldA.kind !== "subtableField") {
      errors.push({ path: "cardList.fields.fieldA", message: "Field A の設定が必須です" });
    }

    return errors.length > 0 ? ng(errors) : ok();
  },

  applyMappingToTemplate(template: TemplateDefinition, mapping: unknown): TemplateDefinition {
    const m = mapping as Partial<CardsV1Mapping> | undefined;
    const next: TemplateDefinition = structuredClone(template);

    next.structureType = "cards_v1";
    next.mapping = mapping;

    const applyFieldRefToElement = (
      element: TemplateElement,
      ref: FieldRef | undefined,
    ): TemplateElement => {
      if (!ref) {
        if (element.type === "label") {
          return element.text === "" ? element : { ...element, text: "" };
        }
        if (element.type === "text") {
          const nextSource = { type: "static", value: "" } as const;
          if (element.dataSource?.type === "static" && element.dataSource.value === "") {
            return element;
          }
          return { ...element, dataSource: nextSource };
        }
        if (element.type === "image") {
          const nextSource = { type: "static", value: "" } as const;
          if (element.dataSource?.type === "static" && element.dataSource.value === "") {
            return element;
          }
          return { ...element, dataSource: nextSource };
        }
        return element;
      }

      if (ref.kind === "recordField") {
        if (element.type !== "text") return element;
        if (element.dataSource?.type === "kintone" && element.dataSource.fieldCode === ref.fieldCode) {
          return element;
        }
        return { ...element, dataSource: { type: "kintone", fieldCode: ref.fieldCode } };
      }

      if (ref.kind === "staticText") {
        if (element.type === "label") {
          return element.text === ref.text ? element : { ...element, text: ref.text ?? "" };
        }
        if (element.type === "text") {
          const nextSource = { type: "static", value: ref.text ?? "" } as const;
          if (element.dataSource?.type === "static" && element.dataSource.value === nextSource.value) {
            return element;
          }
          return { ...element, dataSource: nextSource };
        }
        return element;
      }

      if (ref.kind === "imageUrl") {
        if (element.type !== "image") return element;
        const nextSource = { type: "static", value: ref.url ?? "" } as const;
        if (element.dataSource?.type === "static" && element.dataSource.value === nextSource.value) {
          return element;
        }
        return { ...element, dataSource: nextSource };
      }

      return element;
    };

    const elements = next.elements ?? [];
    const headerSlots = m?.header ?? {};
    const footerSlots = m?.footer ?? {};

    const slotSyncedElements = elements.map((element) => {
      if (!element.slotId) return element;
      if (element.region === "header") {
        return applyFieldRefToElement(element, headerSlots[element.slotId]);
      }
      if (element.region === "footer") {
        return applyFieldRefToElement(element, footerSlots[element.slotId]);
      }
      return element;
    });

    const cardIndex = slotSyncedElements.findIndex((el) => el.type === "cardList");
    if (cardIndex >= 0) {
      const cardList = slotSyncedElements[cardIndex] as CardListElement;
      const source = m?.cardList?.source;
      const fields = m?.cardList?.fields ?? {};

      const nextFields = cardList.fields.map((field) => {
        const ref = fields[field.id];
        if (ref?.kind === "subtableField") {
          if (field.fieldCode === ref.fieldCode) return field;
          return { ...field, fieldCode: ref.fieldCode };
        }
        return field;
      });

      slotSyncedElements[cardIndex] = {
        ...cardList,
        dataSource:
          source?.kind === "subtable" && source.fieldCode
            ? { type: "kintoneSubtable", fieldCode: source.fieldCode }
            : cardList.dataSource,
        fields: nextFields,
      } as CardListElement;
    }

    return { ...next, elements: slotSyncedElements };
  },
};
