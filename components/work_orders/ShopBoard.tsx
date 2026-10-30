"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useBoardDragSensors } from "@/lib/client/useBoardDragSensors";
import { useDebouncedRouterRefresh } from "@/lib/client/useDebouncedRouterRefresh";
import type { UserRole, WorkOrderStatus } from "@/lib/database/types";
import { SHOP_BOARD_COLUMNS, GALLERY_BOARD_COLUMNS } from "@/lib/status/pipeline";
import {
  allowsShopBoardDrop,
  boardColumnIdForStatus,
  buildShopBoardRowsKey,
  canDragShopBoardCard,
  getTargetStatusForColumn,
  overlayShopBoardPendingMoves,
  resolveShopBoardDropColumnId,
} from "@/lib/status/transitions";
import { moveWorkOrderOnBoardAction } from "@/app/(app)/work_orders/board-actions";
import { DraggableWorkOrderCard } from "@/components/work_orders/DraggableWorkOrderCard";
import {
  WorkOrderCard,
  type WorkOrderCardData,
} from "@/components/work_orders/WorkOrderCard";
import { VirtualColumnList } from "@/components/ui/VirtualColumnList";

const shopBoardCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length > 0) return hits;
  return closestCenter(args);
};

function BoardColumn({
  columnId,
  label,
  cards,
  compact,
  role,
  isForeignLocation,
  dropDisabled,
  emptyMessage = "No orders",
}: {
  columnId: string;
  label: string;
  cards: WorkOrderCardData[];
  compact: boolean;
  role: UserRole;
  isForeignLocation: boolean;
  dropDisabled: boolean;
  emptyMessage?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: columnId,
    disabled: dropDisabled,
  });

  return (
    <section
      ref={setNodeRef}
      className={`shop-board-column${isOver && !dropDisabled ? " shop-board-column--drop-target" : ""}`}
      aria-label={label}
    >
      <header className="shop-board-column-header">
        <h2 className="shop-board-column-title">{label}</h2>
        <span className="shop-board-column-count">{cards.length}</span>
      </header>
      <VirtualColumnList
        className="shop-board-column-body"
        items={cards}
        estimateSize={compact ? 88 : 140}
        threshold={12}
        getKey={(wo) => wo.work_order_id}
        empty={<p className="shop-board-empty">{emptyMessage}</p>}
        renderItem={(wo) => (
          <DraggableWorkOrderCard
            workOrder={wo}
            compact={compact}
            disabled={!canDragShopBoardCard(role, wo.status, isForeignLocation)}
          />
        )}
      />
    </section>
  );
}

export function ShopBoard({
  rows,
  hideEmpty = false,
  compact = true,
  hiddenColumnIds = [],
  role,
  isForeignLocation = false,
  variant = "gallery",
}: {
  rows: WorkOrderCardData[];
  hideEmpty?: boolean;
  compact?: boolean;
  hiddenColumnIds?: string[];
  role: UserRole;
  isForeignLocation?: boolean;
  /** gallery = Track Day 4-wide stages; detailed = classic many columns */
  variant?: "gallery" | "detailed";
}) {
  const columns = variant === "gallery" ? GALLERY_BOARD_COLUMNS : SHOP_BOARD_COLUMNS;
  const hiddenSet = useMemo(() => new Set(hiddenColumnIds), [hiddenColumnIds]);
  const [boardRows, setBoardRows] = useState(rows);
  const [pendingMoves, setPendingMoves] = useState<Record<string, WorkOrderStatus>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const suppressClickRef = useRef(false);
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const {
    schedule: scheduleRefresh,
    flush: flushRefresh,
    cancel: cancelRefresh,
  } = useDebouncedRouterRefresh({
    delayMs: 800,
    isPaused: () => activeIdRef.current !== null,
  });

  // Sync when server revalidates with new props (status, flags, photo, tech, customer)
  const rowsKey = useMemo(() => buildShopBoardRowsKey(rows), [rows]);
  const [prevRowsKey, setPrevRowsKey] = useState(rowsKey);
  if (rowsKey !== prevRowsKey && activeId === null) {
    setPrevRowsKey(rowsKey);
    const reconciled = overlayShopBoardPendingMoves(rows, pendingMoves);
    setPendingMoves(reconciled.remainingPending);
    setBoardRows(reconciled.rows);
  }

  const sensors = useBoardDragSensors(8);

  const byStatus = useMemo(() => {
    const map = new Map<WorkOrderStatus, WorkOrderCardData[]>();
    for (const row of boardRows) {
      const list = map.get(row.status) ?? [];
      list.push(row);
      map.set(row.status, list);
    }
    return map;
  }, [boardRows]);

  const visibleColumns = columns.filter((column) => !hiddenSet.has(column.id));
  const columnCounts = visibleColumns.map((column) => ({
    id: column.id,
    count: column.statuses.reduce(
      (total, status) => total + (byStatus.get(status)?.length ?? 0),
      0
    ),
  }));
  const activeColumns = columnCounts.filter((column) => column.count > 0).length;
  const activeWorkOrderCount = useMemo(
    () =>
      boardRows.filter((row) => row.status !== "completed" && row.status !== "cancelled")
        .length,
    [boardRows]
  );

  const activeCard = activeId
    ? (boardRows.find((row) => row.work_order_id === activeId) ?? null)
    : null;

  function handleDragStart(event: DragStartEvent) {
    suppressClickRef.current = true;
    setErrorMessage(null);
    const nextId = String(event.active.id);
    activeIdRef.current = nextId;
    setActiveId(nextId);
  }

  function handleDragEnd(event: DragEndEvent) {
    activeIdRef.current = null;
    setActiveId(null);
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 50);
    const { active, over } = event;
    if (!over) {
      flushRefresh();
      return;
    }

    const workOrderId = String(active.id);
    const columnIds = new Set(visibleColumns.map((column) => column.id));
    const targetColumnId = resolveShopBoardDropColumnId({
      overId: String(over.id),
      columnIds,
      columnIdForWorkOrder: (id) => {
        const row = boardRows.find((item) => item.work_order_id === id);
        return row ? boardColumnIdForStatus(row.status, columns) : null;
      },
    });
    if (!targetColumnId) {
      flushRefresh();
      return;
    }

    const card = boardRows.find((row) => row.work_order_id === workOrderId);
    if (!card) {
      flushRefresh();
      return;
    }

    const sourceColumnId = boardColumnIdForStatus(card.status, columns);
    if (sourceColumnId === targetColumnId) {
      flushRefresh();
      return;
    }

    const targetStatus = getTargetStatusForColumn(targetColumnId);
    if (targetStatus === null) {
      setErrorMessage("Use the work order detail page to place on hold or cancel.");
      flushRefresh();
      return;
    }

    if (!allowsShopBoardDrop(role, targetColumnId, card.status)) {
      setErrorMessage("You do not have permission to move this work order there.");
      flushRefresh();
      return;
    }

    if (targetStatus === card.status) {
      flushRefresh();
      return;
    }

    cancelRefresh();
    const previousStatus = card.status;
    setPendingMoves((current) => ({ ...current, [workOrderId]: targetStatus }));
    setBoardRows((current) =>
      current.map((row) =>
        row.work_order_id === workOrderId ? { ...row, status: targetStatus } : row
      )
    );
    setErrorMessage(null);

    startTransition(async () => {
      const result = await moveWorkOrderOnBoardAction(workOrderId, targetColumnId);
      if (result.error) {
        setPendingMoves((current) => {
          const next = { ...current };
          delete next[workOrderId];
          return next;
        });
        setBoardRows((current) =>
          current.map((row) =>
            row.work_order_id === workOrderId ? { ...row, status: previousStatus } : row
          )
        );
        setErrorMessage(result.error);
      }
      scheduleRefresh();
    });
  }

  function handleDragCancel() {
    activeIdRef.current = null;
    setActiveId(null);
    flushRefresh();
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 50);
  }

  return (
    <div
      className="shop-board-wrap"
      onClickCapture={(event) => {
        if (!suppressClickRef.current) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <p className="shop-board-summary" aria-live="polite">
        {boardRows.length === 0
          ? "No work orders on the board"
          : `${activeWorkOrderCount} active work order${activeWorkOrderCount === 1 ? "" : "s"} across ${activeColumns} column${activeColumns === 1 ? "" : "s"}`}
        {isPending ? " · Saving…" : ""}
      </p>
      {errorMessage ? (
        <p className="shop-board-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={shopBoardCollision}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div
          className={
            variant === "gallery" ? "shop-board shop-board--gallery" : "shop-board"
          }
        >
          {visibleColumns.map((column) => {
            const cards = column.statuses.flatMap((status) => byStatus.get(status) ?? []);

            if (hideEmpty && cards.length === 0 && column.id !== "complete") return null;

            const dropDisabled =
              getTargetStatusForColumn(column.id) === null || isForeignLocation;

            return (
              <BoardColumn
                key={column.id}
                columnId={column.id}
                label={column.label}
                cards={cards}
                compact={compact}
                role={role}
                isForeignLocation={isForeignLocation}
                dropDisabled={dropDisabled}
                emptyMessage={
                  column.id === "complete" ? "Drop a bike that already left" : "No orders"
                }
              />
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeCard ? (
            <div className="wo-card-drag-overlay">
              <WorkOrderCard workOrder={activeCard} compact={compact} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
