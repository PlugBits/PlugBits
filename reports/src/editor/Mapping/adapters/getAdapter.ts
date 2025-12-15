// src/editor/Mapping/adapters/getAdapter.ts
import type { StructureAdapter } from "./StructureAdapter";
import { lineItemsV1Adapter } from "./line_items_v1";

const ADAPTERS: Record<string, StructureAdapter> = {
  [lineItemsV1Adapter.structureType]: lineItemsV1Adapter,
};

export function getAdapter(structureType: string): StructureAdapter {
  const adapter = ADAPTERS[structureType];
  if (!adapter) {
    // 将来 structureType が増えるので、ここで落として気づけるようにする
    throw new Error(`No StructureAdapter for structureType: ${structureType}`);
  }
  return adapter;
}
