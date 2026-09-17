"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, type ReactNode, type Ref } from "react";

type Props<T> = {
  items: T[];
  estimateSize: number;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
  empty?: ReactNode;
  /** Below this count, render a plain list (cheaper + friendlier for DnD). */
  threshold?: number;
  gapPx?: number;
  scrollRef?: Ref<HTMLDivElement>;
};

/**
 * Vertical windowing for dense board columns. Short lists skip virtualization
 * so drag-and-drop hit targets stay simple.
 */
export function VirtualColumnList<T>({
  items,
  estimateSize,
  getKey,
  renderItem,
  className,
  empty = null,
  threshold = 12,
  gapPx = 8,
  scrollRef,
}: Props<T>) {
  const localRef = useRef<HTMLDivElement | null>(null);

  function setParentRef(node: HTMLDivElement | null) {
    localRef.current = node;
    if (typeof scrollRef === "function") {
      scrollRef(node);
    } else if (scrollRef) {
      (scrollRef as { current: HTMLDivElement | null }).current = node;
    }
  }

  const shouldVirtualize = items.length >= threshold;
  // TanStack Virtual returns unstable function identities; React Compiler skips this component.
  // eslint-disable-next-line react-hooks/incompatible-library -- intentional board windowing
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => localRef.current,
    estimateSize: () => estimateSize + gapPx,
    overscan: 4,
    enabled: shouldVirtualize,
  });

  if (items.length === 0) {
    return (
      <div ref={setParentRef} className={className}>
        {empty}
      </div>
    );
  }

  if (!shouldVirtualize) {
    return (
      <div ref={setParentRef} className={className}>
        {items.map((item, index) => (
          <div key={getKey(item, index)}>{renderItem(item, index)}</div>
        ))}
      </div>
    );
  }

  return (
    <div ref={setParentRef} className={className}>
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          return (
            <div
              key={getKey(item, virtualRow.index)}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
                paddingBottom: gapPx,
              }}
            >
              {renderItem(item, virtualRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
