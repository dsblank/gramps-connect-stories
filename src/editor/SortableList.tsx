// A vertical list whose rows are reordered by dragging a grip (⋮⋮) at
// their left: the slide list and a slide's photos. Built on @dnd-kit so a
// drag works with a mouse, a finger, and the keyboard (focus the grip,
// Space, ↑/↓, Space), with screen-reader announcements. Only the grip
// starts a drag, so the rest of a row keeps its clicks and text fields.
import { useMemo, type CSSProperties, type ReactNode } from "react";
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors,
  type Announcements, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { EDITOR_ENGLISH, type EditorStrings } from "./strings.js";

export type SortableStrings = Pick<
  EditorStrings,
  "dragToReorder" | "reorderHelp" | "reorderPickedUp" | "reorderMovedTo" | "reorderDropped" | "reorderCancelled"
>;

/** Stable per-row ids for `keys`, unique even when a key repeats (the
 * same photo twice on a slide): the nth occurrence of a key gets "#n". */
export function sortableIds(keys: string[]): string[] {
  const seen = new Map<string, number>();
  return keys.map((k) => {
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return `${k}#${n}`;
  });
}

export interface SortableListProps {
  /** One key per row, in order. */
  keys: string[];
  /** Called once per drop; never with from === to. */
  onMove: (from: number, to: number) => void;
  /** Renders row `index`; `grip` goes first in the row (null with a
   * single row, which has nothing to reorder). */
  renderItem: (index: number, grip: ReactNode) => ReactNode;
  /** Gap between rows: px, or a CSS length. */
  gap?: number | string;
  strings?: SortableStrings;
}

export function SortableList({ keys, onMove, renderItem, gap = 4, strings = EDITOR_ENGLISH }: SortableListProps) {
  const ids = useMemo(() => sortableIds(keys), [keys]);
  const sensors = useSensors(
    // A few px before a drag starts, so a click on the grip isn't a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const position = (id: string | number) => ids.indexOf(String(id)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => strings.reorderPickedUp(position(active.id)),
    onDragOver: ({ over }) => (over ? strings.reorderMovedTo(position(over.id)) : undefined),
    onDragEnd: ({ over }) => (over ? strings.reorderDropped(position(over.id)) : undefined),
    onDragCancel: () => strings.reorderCancelled,
  };

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from >= 0 && to >= 0 && from !== to) onMove(from, to);
  }

  if (keys.length < 2) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap }}>
        {keys.map((_, i) => <div key={ids[i]}>{renderItem(i, null)}</div>)}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={handleDragEnd}
      accessibility={{ announcements, screenReaderInstructions: { draggable: strings.reorderHelp } }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div style={{ display: "flex", flexDirection: "column", gap }}>
          {ids.map((id, i) => (
            <SortableRow key={id} id={id} label={strings.dragToReorder}>
              {(grip) => renderItem(i, grip)}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ id, label, children }: { id: string; label: string; children: (grip: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    position: "relative",
    zIndex: isDragging ? 1 : undefined,
    opacity: isDragging ? 0.85 : undefined,
    background: isDragging ? "var(--mantine-color-body)" : undefined,
    boxShadow: isDragging ? "var(--mantine-shadow-sm)" : undefined,
    borderRadius: 6,
  };
  const grip = (
    <span
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={label}
      title={label}
      style={{
        cursor: isDragging ? "grabbing" : "grab",
        // Without this a touch drag scrolls the page instead.
        touchAction: "none",
        userSelect: "none",
        color: "var(--mantine-color-dimmed)",
        fontSize: 14,
        lineHeight: 1,
        padding: "2px 1px",
        flexShrink: 0,
        borderRadius: 3,
      }}
    >
      ⋮⋮
    </span>
  );
  return <div ref={setNodeRef} style={style}>{children(grip)}</div>;
}
