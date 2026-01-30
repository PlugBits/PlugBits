import type {
  TemplateDefinition,
  TemplateElement,
  CardListElement,
} from "../../../shared/template.js";

type FieldRef =
  | { kind: "recordField"; fieldCode: string }
  | { kind: "staticText"; text: string }
  | { kind: "imageUrl"; url: string }
  | { kind: "subtable"; fieldCode: string }
  | { kind: "subtableField"; subtableCode: string; fieldCode: string };

type CardListMapping = {
  source?: { kind: "subtable"; fieldCode: string };
  fields?: Record<string, FieldRef | null | undefined>;
};

export type CardsV2Mapping = {
  header: Record<string, FieldRef | undefined>;
  cardList: CardListMapping;
  footer: Record<string, FieldRef | undefined>;
};

export const applyCardsV2MappingToTemplate = (
  template: TemplateDefinition,
  mapping: unknown,
): TemplateDefinition => {
  const m = mapping as Partial<CardsV2Mapping> | undefined;
  const next: TemplateDefinition = structuredClone(template);

  next.structureType = "cards_v2";
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
      const ref = fields[field.id] as FieldRef | null | undefined;
      if (ref === null) {
        return field.fieldCode ? { ...field, fieldCode: undefined } : field;
      }
      if (ref?.kind === "subtableField") {
        if (!ref.fieldCode) {
          return field.fieldCode ? { ...field, fieldCode: undefined } : field;
        }
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
    };
  }

  return {
    ...next,
    elements: slotSyncedElements,
  };
};
