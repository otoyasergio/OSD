"use client";

import type { ReactNode } from "react";
import { ArrowLeftRight, PauseCircle, X } from "lucide-react";
import {
  waitOwnerDisplayLabel,
  type FloorActionControl,
  type FloorActionModel,
} from "@/lib/technician/floorActionModel";

export function FloorDock({
  model,
  parkControl,
  swapControl,
  failQcControl,
  onPark,
  onSwap,
  onFailQc,
  onGo,
  message,
}: {
  model: FloorActionModel | null;
  parkControl?: FloorActionControl;
  swapControl?: FloorActionControl;
  failQcControl?: FloorActionControl;
  onPark: () => void;
  onSwap: () => void;
  onFailQc: () => void;
  onGo: () => void;
  message?: ReactNode;
}) {
  if (!model) return null;
  const showGo =
    model.primary.action !== "none" && model.primary.action !== "pass_safety";

  return (
    <div className="pit-dock">
      <div className="pit-command">
        {parkControl ? (
          <button
            type="button"
            className="pit-cmd pit-cmd--icon"
            disabled={!parkControl.enabled}
            title={parkControl.disabledReason ?? "Park"}
            aria-label={parkControl.label}
            onClick={onPark}
          >
            <PauseCircle size={22} aria-hidden />
            <span className="sr-only">{parkControl.label}</span>
          </button>
        ) : null}
        {swapControl ? (
          <button
            type="button"
            className="pit-cmd pit-cmd--icon"
            disabled={!swapControl.enabled}
            title={swapControl.disabledReason ?? "Swap"}
            aria-label={swapControl.label}
            onClick={onSwap}
          >
            <ArrowLeftRight size={22} aria-hidden />
            <span className="sr-only">{swapControl.label}</span>
          </button>
        ) : null}
        {failQcControl ? (
          <button
            type="button"
            className="pit-cmd pit-cmd--fail pit-cmd--icon"
            disabled={!failQcControl.enabled}
            title={failQcControl.disabledReason}
            aria-label={failQcControl.label}
            onClick={onFailQc}
          >
            <X size={22} aria-hidden />
            <span className="sr-only">{failQcControl.label}</span>
          </button>
        ) : null}
        {showGo ? (
          <button
            type="button"
            className="pit-go"
            disabled={!model.primary.enabled}
            title={model.primary.disabledReason}
            onClick={onGo}
          >
            {model.primary.label}
          </button>
        ) : null}
      </div>
      {!model.primary.enabled && model.waitOwner ? (
        <p className="pit-dock-sub pit-dock-sub--reason" role="status">
          Waiting — {waitOwnerDisplayLabel(model.waitOwner)}
          {model.waitReason ? ` · ${model.waitReason}` : ""}
        </p>
      ) : model.primary.disabledReason ? (
        <p className="pit-dock-sub pit-dock-sub--reason" role="status">
          {model.primary.disabledReason}
        </p>
      ) : model.primary.hint ? (
        <p className="pit-dock-sub">{model.primary.hint}</p>
      ) : null}
      {message}
    </div>
  );
}
