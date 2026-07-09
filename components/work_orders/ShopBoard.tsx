"use client";

import { useMemo, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { UserRole, WorkOrderStatus } from "@/lib/database/types";
import { SHOP_BOARD_COLUMNS } from "@/lib/status/pipeline";
import {
  canDragWorkOrderOnBoard,
  canDropInColumn,
  getTargetStatusForColumn,
} from "@/lib/status/transitions";
import { moveWorkOrderOnBoardAction } from "@/app/(app)/work_orders/board-actions";
import { DraggableWorkOrderCard } from "@/components/work_orders/DraggableWorkOrderCard";
import {
  WorkOrderCard,
  type WorkOrderCardData,
} from "@/components/work_orders/WorkOrderCard";

function BoardColumn({
  columnId,
  label,
  cards,
  compact,
  role,
  isForeignLocation,
  dropDisabled,
}: {
  columnId: string;
  label: string;
  cards: WorkOrderCardData[];
  compact: boolean;
  role: UserRole;
  isForeignLocation: boolean;
  dropDisabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: columnId,
    disabled: dropDisabled,
  });

  return (
    <section
      className={`shop-board-column${isOver && !dropDisabled ? " shop-board-column--drop-target" : ""}`}
      aria-label={label}
    >
      <header className="shop-board-column-header">
        <h2 className="shop-board-column-title">{label}</h2>
        <span className="shop-board-column-count">{cards.length}</span>
      </header>
      <div ref={setNodeRef} className="shop-board-column-body">
        {cards.length === 0 ? (
          <p className="shop-board-empty">No orders</p>
        ) : (
          cards.map((wo) => (
            <DraggableWorkOrderCard
              key={wo.work_order_id}
              workOrder={wo}
              compact={compact}
              disabled={
                !canDragWorkOrderOnBoard(role, wo.status, isForeignLocation)
              }
            />
          ))
        )}
      </div>
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
}: {
  rows: WorkOrderCardData[];
  hideEmpty?: boolean;
  compact?: boolean;
  hiddenColumnIds?: string[];
  role: UserRole;
  isForeignLocation?: boolean;
}) {
  const hiddenSet = useMemo(
    () => new Set(hiddenColumnIds),
    [hiddenColumnIds]
  );
  const [boardRows, setBoardRows] = useState(rows);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Sync when server revalidates with new props
  const rowsKey = rows
    .map((r) => `${r.work_order_id}:${r.status}`)
    .join("|");
  const [prevRowsKey, setPrevRowsKey] = useState(rowsKey);
  if (rowsKey !== prevRowsKey) {
    setPrevRowsKey(rowsKey);
    setBoardRows(rows);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const byStatus = useMemo(() => {
    const map = new Map<WorkOrderStatus, WorkOrderCardData[]>();
    for (const row of boardRows) {
      const list = map.get(row.status) ?? [];
      list.push(row);
      map.set(row.status, list);
    }
    return map;
  }, [boardRows]);

  const visibleColumns = SHOP_BOARD_COLUMNS.filter(
    (column) => !hiddenSet.has(column.id)
  );
  const columnCounts = visibleColumns.map((column) => ({
    id: column.id,
    count: column.statuses.reduce(
      (total, status) => total + (byStatus.get(status)?.length ?? 0),
      0
    ),
  }));
  const activeColumns = columnCounts.filter((column) => column.count > 0).length;

  const activeCard = activeId
    ? boardRows.find((row) => row.work_order_id === activeId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    setErrorMessage(null);
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const workOrderId = String(active.id);
    const targetColumnId = String(over.id);
    const card = boardRows.find((row) => row.work_order_id === workOrderId);
    if (!card) return;

    const targetStatus = getTargetStatusForColumn(targetColumnId);
    if (targetStatus === null) {
      setErrorMessage(
        "Use the work order detail page to place on hold or cancel."
      );
      return;
    }

    if (!canDropInColumn(role, targetColumnId, card.status)) {
      setErrorMessage("You do not have permission to move this work order there.");
      return;
    }

    if (targetStatus === card.status) return;

    const previousRows = boardRows;
    setBoardRows((current) =>
      current.map((row) =>
        row.work_order_id === workOrderId
          ? { ...row, status: targetStatus }
          : row
      )
    );
    setErrorMessage(null);

    startTransition(async () => {
      const result = await moveWorkOrderOnBoardAction(
        workOrderId,
        targetColumnId
      );
      if (result.error) {
        setBoardRows(previousRows);
        setErrorMessage(result.error);
      }
    });
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  return (
    <div className="shop-board-wrap">
      <p className="shop-board-summary" aria-live="polite">
        {boardRows.length === 0
          ? "No work orders on the board"
          : `${boardRows.length} work order${boardRows.length === 1 ? "" : "s"} across ${activeColumns} column${activeColumns === 1 ? "" : "s"}`}
        {isPending ? " · Saving…" : ""}
      </p>
      {errorMessage ? (
        <p className="shop-board-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="shop-board">
          {visibleColumns.map((column) => {
            const cards = column.statuses.flatMap(
              (status) => byStatus.get(status) ?? []
            );

            if (hideEmpty && cards.length === 0) return null;

            const dropDisabled =
              getTargetStatusForColumn(column.id) === null ||
              isForeignLocation;

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
