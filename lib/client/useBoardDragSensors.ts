"use client";

import { MouseSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";

/** Long-press before a touch turns into a drag. */
const TOUCH_DELAY_MS = 250;
/** Finger travel allowed during the delay before activation is cancelled. */
const TOUCH_TOLERANCE_PX = 8;

/**
 * Sensors for the drag-and-drop boards.
 *
 * A single PointerSensor cannot serve both inputs here. Pointer events cover
 * mouse and touch alike, so a distance-based constraint turns any finger swipe
 * that starts on a card into a drag — which is why the cards needed
 * `touch-action: none`, and why the boards could not be scrolled at all on
 * iPhone or iPad.
 *
 * Splitting into MouseSensor + TouchSensor lets each input keep the constraint
 * that suits it: the mouse drags immediately on movement, while touch requires
 * a stationary long-press. A swipe exceeds the tolerance before the delay
 * elapses, so activation is cancelled and the browser scrolls normally.
 */
export function useBoardDragSensors(mouseDistancePx: number) {
  return useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: mouseDistancePx },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: TOUCH_DELAY_MS, tolerance: TOUCH_TOLERANCE_PX },
    })
  );
}
