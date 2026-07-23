"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { TechnicianNotes } from "@/components/work_orders/TechnicianNotes";
import { addTechnicianNoteAction } from "@/app/(app)/work_orders/note-actions";
import type { JobPacket } from "@/lib/services/jobPacket";
import { technicianPacketHref, type JobPacketSection } from "@/lib/technician/routeState";
import type { FloorStage } from "@/lib/technician/floorStage";
import type { IntakePhoto } from "@/lib/services/photos";
import type { WorkOrderJob } from "@/lib/services/workOrders";
import { PhotoLightbox } from "@/components/photos/PhotoLightbox";
import { toLightboxPhotos } from "@/lib/photos/lightbox";
import { PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";
import { formatDateTime } from "@/lib/datetime/format";

function toNoteJobs(packet: JobPacket): WorkOrderJob[] {
  return packet.jobs.map(
    (job) =>
      ({
        job_id: job.job_id,
        service_name_snapshot: job.service_name,
      }) as WorkOrderJob
  );
}

/** `null` = the top summary (Overview). */
type PacketTabId = JobPacketSection | null;

const TABS: Array<{ id: PacketTabId; label: string }> = [
  { id: null, label: "Overview" },
  { id: "notes", label: "Notes" },
  { id: "photos", label: "Photos" },
  { id: "jobs", label: "Jobs" },
];

function tabKey(id: PacketTabId): string {
  return id ?? "overview";
}

export function JobPacketPanel({
  packet,
  section,
  closeHref,
  photos = [],
  selectedJobId = null,
  stage,
}: {
  packet: JobPacket;
  /** Validated section; null shows the top summary. */
  section: JobPacketSection | null;
  closeHref: string;
  photos?: IntakePhoto[];
  selectedJobId?: string | null;
  stage: FloorStage | null;
}) {
  const tabRefs = useRef(new Map<string, HTMLAnchorElement>());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const activeTab: PacketTabId = section;
  const lightboxPhotos = toLightboxPhotos(photos);

  function hrefFor(tab: PacketTabId): string {
    return technicianPacketHref({
      workOrderId: packet.work_order_id,
      jobId: selectedJobId,
      section: tab,
      stage,
    });
  }

  function onTablistKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const currentIndex = TABS.findIndex((tab) => tab.id === activeTab);
    const focusedIndex = TABS.findIndex(
      (tab) => tabRefs.current.get(tabKey(tab.id)) === document.activeElement
    );
    const from = focusedIndex >= 0 ? focusedIndex : Math.max(currentIndex, 0);
    let next = from;
    if (event.key === "ArrowLeft") next = (from - 1 + TABS.length) % TABS.length;
    if (event.key === "ArrowRight") next = (from + 1) % TABS.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = TABS.length - 1;
    tabRefs.current.get(tabKey(TABS[next].id))?.focus();
  }

  const panelId = `floor-packet-panel-${tabKey(activeTab)}`;
  const activeTabId = `floor-packet-tab-${tabKey(activeTab)}`;

  return (
    <div className="floor-packet">
      <div className="floor-packet-scroll">
        <header className="floor-packet-header">
          <p className="floor-wo-meta">
            {packet.work_order_number} · {packet.wo_status_label}
          </p>
          <h2 className="floor-bike">{packet.motorcycle_label}</h2>
          <p className="floor-muted">
            Notes, photos and jobs — available whenever this bike is on your docket
          </p>
          <div
            role="tablist"
            aria-label="Job packet sections"
            className="floor-packet-tabs"
            onKeyDown={onTablistKeyDown}
          >
            {TABS.map((tab) => {
              const selected = tab.id === activeTab;
              return (
                <Link
                  key={tabKey(tab.id)}
                  ref={(node) => {
                    if (node) tabRefs.current.set(tabKey(tab.id), node);
                    else tabRefs.current.delete(tabKey(tab.id));
                  }}
                  id={`floor-packet-tab-${tabKey(tab.id)}`}
                  role="tab"
                  aria-selected={selected}
                  aria-controls={selected ? panelId : undefined}
                  tabIndex={selected ? 0 : -1}
                  href={tab.id === null ? hrefFor(null) : hrefFor(tab.id)}
                  className={[
                    "floor-packet-tab",
                    selected ? "floor-packet-tab--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </header>

        <section
          id={panelId}
          role="tabpanel"
          aria-labelledby={activeTabId}
          className="floor-packet-section"
        >
          {activeTab === null ? (
            <div className="floor-packet-summary">
              <h3 className="floor-section-title">This bike at a glance</h3>
              <ul className="floor-packet-summary-list">
                <li>
                  <span className="floor-packet-summary-label">Status</span>
                  {packet.wo_status_label}
                </li>
                <li>
                  <span className="floor-packet-summary-label">Jobs</span>
                  {packet.jobs.length === 0
                    ? "None active"
                    : packet.jobs
                        .map((job) => `${job.service_name} — ${job.status_label}`)
                        .join(" · ")}
                </li>
                <li>
                  <span className="floor-packet-summary-label">Notes</span>
                  {packet.notes.length === 0
                    ? "No notes yet"
                    : `${packet.notes.length} note${packet.notes.length === 1 ? "" : "s"} — newest ${formatDateTime(packet.notes[0].created_at)}`}
                </li>
                <li>
                  <span className="floor-packet-summary-label">Photos</span>
                  {photos.length === 0
                    ? "No photos on file"
                    : `${photos.length} intake & proof photo${photos.length === 1 ? "" : "s"}`}
                </li>
              </ul>
            </div>
          ) : null}

          {activeTab === "jobs" ? (
            <>
              <h3 className="floor-section-title">Jobs on this visit</h3>
              {packet.jobs.length === 0 ? (
                <p className="floor-muted">No active jobs on this work order.</p>
              ) : (
                <ul className="floor-service-list">
                  {packet.jobs.map((job) => {
                    const content = (
                      <>
                        <span className="floor-service-main">
                          <span className="floor-service-name">{job.service_name}</span>
                          <span className="floor-service-meta">{job.status_label}</span>
                        </span>
                        <span className="floor-service-owner">
                          {job.assigned_to_me ? "Open on floor" : "Other tech"}
                        </span>
                      </>
                    );

                    return (
                      <li key={job.job_id}>
                        {job.assigned_to_me ? (
                          <Link
                            href={job.floor_href}
                            className={`floor-service-item${
                              selectedJobId === job.job_id
                                ? " floor-service-item--selected"
                                : ""
                            }`}
                          >
                            {content}
                          </Link>
                        ) : (
                          <div className="floor-service-item floor-service-item--other">
                            {content}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : null}

          {activeTab === "notes" ? (
            <>
              <h3 className="floor-section-title">Technician notes</h3>
              <TechnicianNotes
                notes={packet.notes}
                jobs={toNoteJobs(packet)}
                readOnly={false}
                canAdd
                addAction={addTechnicianNoteAction.bind(null, packet.work_order_id)}
              />
            </>
          ) : null}

          {activeTab === "photos" ? (
            <>
              <h3 className="floor-section-title">Intake &amp; proof photos</h3>
              {photos.length === 0 ? (
                <p className="floor-muted">No intake or proof photos on file.</p>
              ) : (
                <ul className="floor-packet-photo-grid">
                  {photos.map((photo) => {
                    const lightboxAt = lightboxPhotos.findIndex(
                      (entry) => entry.id === photo.photo_id
                    );
                    return (
                      <li key={photo.photo_id} className="floor-packet-photo">
                        {photo.signed_url ? (
                          <button
                            type="button"
                            className="floor-packet-photo-open"
                            aria-label={`View ${PHOTO_CATEGORY_LABELS[photo.category]} photo full screen`}
                            onClick={() =>
                              setLightboxIndex(lightboxAt >= 0 ? lightboxAt : 0)
                            }
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs */}
                            <img
                              src={photo.signed_url}
                              alt={`${PHOTO_CATEGORY_LABELS[photo.category]} photo`}
                              className="floor-packet-photo-img"
                            />
                          </button>
                        ) : (
                          <div className="floor-packet-photo-missing">
                            Preview unavailable
                          </div>
                        )}
                        <div className="floor-packet-photo-meta">
                          <span className="floor-service-name">
                            {PHOTO_CATEGORY_LABELS[photo.category]}
                          </span>
                          <span className="floor-muted">
                            {formatDateTime(photo.created_at)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : null}
        </section>
      </div>

      {lightboxIndex !== null && lightboxPhotos.length > 0 ? (
        <PhotoLightbox
          photos={lightboxPhotos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}

      <footer className="floor-packet-footer">
        <Link href={closeHref} className="btn btn-primary floor-tap floor-tap--wide">
          Back to job
        </Link>
      </footer>
    </div>
  );
}
