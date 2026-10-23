// A list of slides to pick from and reorder by dragging -- generic over
// what a slide is, so any story editor can use it with its own rows.
import { useState, type ReactNode } from "react";
import { Stack, UnstyledButton } from "@mantine/core";

export interface SlideListProps<T> {
  items: T[];
  selected: number;
  onSelect: (index: number) => void;
  /** Called when a row is dropped somewhere else. */
  onMove: (from: number, to: number) => void;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  label?: string;
}

export function SlideList<T>({ items, selected, onSelect, onMove, getKey, renderItem, label }: SlideListProps<T>) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const end = () => { setDragging(null); setOver(null); };

  return (
    <Stack gap={4} role="listbox" aria-label={label}>
      {items.map((item, i) => {
        const isSelected = i === selected;
        // A line on the side the row will land: below when moving down.
        const dropLine = over === i && dragging !== null && dragging !== i
          ? (dragging < i ? { borderBottom: "2px solid var(--mantine-primary-color-filled)" } : { borderTop: "2px solid var(--mantine-primary-color-filled)" })
          : {};
        return (
          <UnstyledButton
            key={getKey(item, i)}
            role="option"
            aria-selected={isSelected}
            draggable
            onClick={() => onSelect(i)}
            onDragStart={(e) => { setDragging(i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); }}
            onDragOver={(e) => { if (dragging === null) return; e.preventDefault(); setOver(i); }}
            onDrop={(e) => { e.preventDefault(); if (dragging !== null && dragging !== i) onMove(dragging, i); end(); }}
            onDragEnd={end}
            style={{
              display: "block", width: "100%", padding: "6px 8px", borderRadius: 6,
              background: isSelected ? "var(--mantine-primary-color-light)" : undefined,
              opacity: dragging === i ? 0.5 : 1,
              ...dropLine,
            }}
          >
            {renderItem(item, i)}
          </UnstyledButton>
        );
      })}
    </Stack>
  );
}
