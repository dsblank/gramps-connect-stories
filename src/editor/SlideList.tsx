// A list of slides to pick from and reorder by dragging each one's grip
// (SortableList.tsx) -- generic over what a slide is, so any story editor
// can use it with its own rows.
import type { ReactNode } from "react";
import { UnstyledButton } from "@mantine/core";
import { SortableList, type SortableStrings } from "./SortableList.js";

export interface SlideListProps<T> {
  items: T[];
  selected: number;
  onSelect: (index: number) => void;
  /** Called when a row is dropped somewhere else. */
  onMove: (from: number, to: number) => void;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  label?: string;
  /** The grip's label and the keyboard/screen-reader words (English when
   * left out). */
  strings?: SortableStrings;
}

export function SlideList<T>({ items, selected, onSelect, onMove, getKey, renderItem, label, strings }: SlideListProps<T>) {
  return (
    <div role="listbox" aria-label={label}>
      <SortableList
        keys={items.map(getKey)}
        onMove={onMove}
        strings={strings}
        renderItem={(i, grip) => {
          const isSelected = i === selected;
          return (
            <div
              style={{
                display: "flex", alignItems: "center", gap: 2, paddingLeft: grip ? 2 : 0, borderRadius: 6,
                background: isSelected ? "var(--mantine-primary-color-light)" : undefined,
              }}
            >
              {grip}
              <UnstyledButton
                role="option"
                aria-selected={isSelected}
                onClick={() => onSelect(i)}
                style={{ display: "block", flex: 1, minWidth: 0, padding: "6px 8px", borderRadius: 6 }}
              >
                {renderItem(items[i], i)}
              </UnstyledButton>
            </div>
          );
        }}
      />
    </div>
  );
}
