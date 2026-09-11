import { Download, Eye, FileImage, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { track } from "./analytics";
import type { PublicTimetable } from "./api/pilotTypes";
import {
  buildPersonalTimetableModel,
  buildPersonalTimetablePdf,
  buildPersonalTimetableSvg,
  type PersonalTimetableModel,
} from "./domain/personalTimetableExport";
import { projectPublishedTimetable } from "./domain/publishedCalendarProjection";

function safeFilename(value: string) {
  const result = value
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return result || "timetable";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function svgToPng(svg: string) {
  const source = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error("Timetable image could not be rendered."));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 1130;
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Image export is unavailable in this browser.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("PNG export failed.")),
        "image/png",
        1,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function PreviewSheet({ model }: { model: PersonalTimetableModel }) {
  const activeDays = model.days.filter((day) => day.sessions.length > 0);
  const visibleDays =
    activeDays.length > 0 ? activeDays : model.days.slice(0, 5);

  return (
    <div className="pt-preview-sheet" data-version={model.versionNumber}>
      <header>
        <div>
          <span>CalenderZW personal timetable</span>
          <h3>
            {model.programme} · {model.classGroup}
          </h3>
          <p>
            {model.institution} · {model.academicPeriod} · v
            {model.versionNumber}
          </p>
        </div>
        <strong>{model.sourceSessionCount} weekly sessions</strong>
      </header>
      <div
        className="pt-preview-week"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, visibleDays.length)}, minmax(150px, 1fr))`,
        }}
      >
        {visibleDays.map((day) => (
          <section key={day.weekday} className="pt-preview-day">
            <h4>{day.label}</h4>
            <div>
              {day.sessions.length === 0 ? (
                <p className="pt-preview-empty">No published sessions.</p>
              ) : (
                day.sessions.map((session) => (
                  <article
                    key={session.stableSessionKey}
                    className={`pt-preview-session tone-${session.toneIndex} kind-${session.kind}`}
                  >
                    <time>
                      {session.startTime.slice(0, 5)}–
                      {session.endTime.slice(0, 5)}
                    </time>
                    <strong>{session.courseName}</strong>
                    <span>
                      {session.courseCode}
                      {session.venue
                        ? ` · ${session.venue}`
                        : " · Venue not set"}
                    </span>
                    {session.sessionType ? (
                      <em>{session.sessionType}</em>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </section>
        ))}
      </div>
      <footer>
        Generated from the current published CalenderZW schedule. Nothing is
        added to fill timetable gaps.
      </footer>
    </div>
  );
}

export function PersonalTimetablePreview({
  slug,
  timetable,
}: {
  slug: string;
  timetable: PublicTimetable;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"pdf" | "png" | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const model = useMemo(() => {
    try {
      const projection = projectPublishedTimetable({
        timetable,
        reminderOffsetsMinutes: [],
        publicOrigin: window.location.origin,
      });
      return buildPersonalTimetableModel({
        institution: timetable.institution,
        programme: timetable.programme,
        classGroup: timetable.classGroup,
        academicPeriod: timetable.academicPeriod,
        versionNumber: timetable.versionNumber,
        publishedAt: timetable.publishedAt ?? projection.publishedAt,
        events: projection.events,
      });
    } catch {
      return null;
    }
  }, [timetable]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() =>
      dialogRef.current?.focus(),
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function openPreview() {
    if (!model) {
      setError("The current published timetable cannot be previewed yet.");
      return;
    }
    setError("");
    setOpen(true);
    track("personal_timetable_preview_opened", {
      publicSlug: slug,
      versionNumber: model.versionNumber,
    });
  }

  async function exportPdf() {
    if (!model || busy) return;
    setBusy("pdf");
    setError("");
    try {
      const bytes = buildPersonalTimetablePdf(model);
      downloadBlob(
        new Blob([bytes], { type: "application/pdf" }),
        `${safeFilename(`${model.programme}-${model.classGroup}`)}-timetable.pdf`,
      );
      track("personal_timetable_pdf_downloaded", {
        publicSlug: slug,
        versionNumber: model.versionNumber,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "PDF export could not be created.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function exportPng() {
    if (!model || busy) return;
    setBusy("png");
    setError("");
    try {
      const blob = await svgToPng(buildPersonalTimetableSvg(model));
      downloadBlob(
        blob,
        `${safeFilename(`${model.programme}-${model.classGroup}`)}-timetable.png`,
      );
      track("personal_timetable_png_downloaded", {
        publicSlug: slug,
        versionNumber: model.versionNumber,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "PNG export could not be created.",
      );
    } finally {
      setBusy(null);
    }
  }

  const dialog =
    open && model
      ? createPortal(
          <div
            className="pt-preview-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <div
              ref={dialogRef}
              className="pt-preview-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pt-preview-title"
              tabIndex={-1}
            >
              <div className="pt-preview-dialog-head">
                <div>
                  <span className="pt-kicker">Class-specific view</span>
                  <h2 id="pt-preview-title">Preview your timetable</h2>
                  <p>
                    Preview and exports use the same published schedule version.
                  </p>
                </div>
                <button
                  type="button"
                  className="pt-icon-button"
                  aria-label="Close timetable preview"
                  onClick={() => setOpen(false)}
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>
              <div className="pt-preview-scroll">
                <PreviewSheet model={model} />
              </div>
              <div className="pt-preview-actions">
                <button
                  type="button"
                  className="pt-button pt-button-primary"
                  onClick={() => void exportPdf()}
                  disabled={busy !== null}
                >
                  <Download size={18} aria-hidden="true" />
                  {busy === "pdf" ? "Creating PDF…" : "Download PDF"}
                </button>
                <button
                  type="button"
                  className="pt-button pt-button-secondary"
                  onClick={() => void exportPng()}
                  disabled={busy !== null}
                >
                  <FileImage size={18} aria-hidden="true" />
                  {busy === "png" ? "Creating PNG…" : "Download PNG"}
                </button>
              </div>
              {error ? (
                <p className="pt-preview-error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        className="pt-button pt-button-secondary pt-preview-open"
        onClick={openPreview}
        disabled={!model}
      >
        <Eye size={18} aria-hidden="true" />
        Preview timetable
      </button>
      {!open && error ? (
        <p className="pt-preview-inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {dialog}
    </>
  );
}
