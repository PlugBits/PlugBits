// src/editor/Mapping/adapters/getAdapter.ts
import type { StructureAdapter } from "./StructureAdapter";
import { listV1Adapter } from "./list_v1";
import { cardsV1Adapter } from "./cards_v1";

const ADAPTERS: Record<string, StructureAdapter> = {
  [listV1Adapter.structureType]: listV1Adapter,
  [cardsV1Adapter.structureType]: cardsV1Adapter,
  line_items_v1: listV1Adapter,
};

export function getAdapter(structureType: string): StructureAdapter {
  const adapter = ADAPTERS[structureType];
  if (!adapter) {
    // 将来 structureType が増えるので、ここで落として気づけるようにする
    throw new Error(`No StructureAdapter for structureType: ${structureType}`);
  }
  return adapter;
}
