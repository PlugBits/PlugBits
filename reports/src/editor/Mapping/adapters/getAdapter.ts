// src/editor/Mapping/adapters/getAdapter.ts
import type { StructureAdapter } from "./StructureAdapter";
import { listV1Adapter } from "./list_v1";
import { estimateV1Adapter } from "./estimate_v1";
import { cardsV1Adapter } from "./cards_v1";
import { labelV1Adapter } from "./label_v1";

const ADAPTERS: Record<string, StructureAdapter> = {
  [listV1Adapter.structureType]: listV1Adapter,
  [estimateV1Adapter.structureType]: estimateV1Adapter,
  [cardsV1Adapter.structureType]: cardsV1Adapter,
  [labelV1Adapter.structureType]: labelV1Adapter,
  line_items_v1: listV1Adapter,
};

export function getAdapterOrNull(structureType: string): StructureAdapter | null {
  return ADAPTERS[structureType] ?? null;
}

export function getAdapter(structureType: string): StructureAdapter {
  const adapter = getAdapterOrNull(structureType);
  if (!adapter) {
    // 将来 structureType が増えるので、ここで落として気づけるようにする
    throw new Error(`No StructureAdapter for structureType: ${structureType}`);
  }
  return adapter;
}
