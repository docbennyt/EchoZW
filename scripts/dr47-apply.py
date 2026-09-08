from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text()
    if old not in source:
        raise SystemExit(f"anchor not found in {path}: {old[:120]!r}")
    if source.count(old) != 1:
        raise SystemExit(f"anchor not unique in {path}: {old[:120]!r}")
    file.write_text(source.replace(old, new, 1))


Path("src/domain/shareAttribution.ts").write_text(r'''export const CLASS_SHARE_SOURCES = [
  "class_share",
  "class_rep",
  "onboarding_success",
] as const;

export type ClassShareSource = (typeof CLASS_SHARE_SOURCES)[number];

const sourceSet = new Set<string>(CLASS_SHARE_SOURCES);

export function sanitizeClassShareSource(
  value: unknown,
): ClassShareSource | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return sourceSet.has(normalized) ? (normalized as ClassShareSource) : null;
}

export function readClassShareSource(url: string): ClassShareSource | null {
  try {
    return sanitizeClassShareSource(new URL(url).searchParams.get("src"));
  } catch {
    return null;
  }
}

export function buildAttributedClassUrl(
  publicUrl: string,
  source: ClassShareSource,
) {
  const url = new URL(publicUrl);
  if (!/^\/t\/[^/]+$/.test(url.pathname)) {
    throw new Error("Class sharing requires a public timetable URL.");
  }
  url.search = "";
  url.hash = "";
  url.searchParams.set("src", source);
  return url.toString();
}

export function buildClassShareMessage(classLabel: string, url: string) {
  const cleanLabel = classLabel.trim() || "Class";
  return `${cleanLabel} timetable is live on CalenderZW — see tomorrow's classes and add it to your calendar: ${url}`;
}

export function buildClassSharePayload(input: {
  classLabel: string;
  publicUrl: string;
  source: ClassShareSource;
}) {
  const url = buildAttributedClassUrl(input.publicUrl, input.source);
  const text = `${input.classLabel.trim() || "Class"} timetable is live on CalenderZW — see tomorrow's classes and add it to your calendar:`;
  return {
    title: `${input.classLabel.trim() || "Class"} timetable`,
    text,
    url,
    message: `${text} ${url}`,
  };
}
''')

replace_once(
    "src/domain/analytics.ts",
    '''  "share_prompt_viewed",\n  "calendar_drawer_opened",''',
    '''  "share_prompt_viewed",\n  "shared_link_opened",\n  "shared_link_onboarding_started",\n  "shared_link_onboarding_completed",\n  "calendar_drawer_opened",''',
)
replace_once(
    "src/domain/analytics.ts",
    '''  "share_prompt_viewed",\n  "timetable_shared",\n  "share_link_opened",\n]);''',
    '''  "share_prompt_viewed",\n  "timetable_shared",\n  "share_link_opened",\n  "shared_link_opened",\n]);''',
)

replace_once(
    "src/PublicTimetableReliability.tsx",
    '''import { getTomorrowSchedule } from "./domain/tomorrowSchedule";''',
    '''import { getTomorrowSchedule } from "./domain/tomorrowSchedule";\nimport {\n  buildClassSharePayload,\n  readClassShareSource,\n  type ClassShareSource,\n} from "./domain/shareAttribution";''',
)
replace_once(
    "src/PublicTimetableReliability.tsx",
    '''function sharePayload(timetable: PublicTimetable, publicUrl: string) {\n  return {\n    title: `${formatClassGroupLabel(timetable.classGroup)} timetable`,\n    text: `${formatClassGroupLabel(timetable.classGroup)} timetable is published on CalenderZW. View the current timetable and subscribe to your calendar.`,\n    url: publicUrl,\n  };\n}\n\n''',
    "",
)
replace_once(
    "src/PublicTimetableReliability.tsx",
    '''  const previousFocusRef = useRef<HTMLElement | null>(null);''',
    '''  const previousFocusRef = useRef<HTMLElement | null>(null);\n  const onboardingCompletionTrackedRef = useRef(false);''',
)
replace_once(
    "src/PublicTimetableReliability.tsx",
    '''  const publicUrl = timetable\n    ? `${window.location.origin}/t/${encodeURIComponent(timetable.publicSlug)}`\n    : "";\n  const browserTimeZone =''',
    '''  const publicUrl = timetable\n    ? `${window.location.origin}/t/${encodeURIComponent(timetable.publicSlug)}`\n    : "";\n  const shareSource = useMemo(\n    () => readClassShareSource(window.location.href),\n    [],\n  );\n  const browserTimeZone =''',
)
replace_once(
    "src/PublicTimetableReliability.tsx",
    '''  useEffect(() => {\n    if (!dialogOpen || !timetable) return;\n    track("onboarding_step_viewed", {\n      step: onboardingStep,\n      publicSlug: timetable.publicSlug,\n    });\n  }, [dialogOpen, onboardingStep, timetable]);\n\n  const closeDialog = useCallback(() => {''',
    '''  useEffect(() => {\n    if (!dialogOpen || !timetable) return;\n    track("onboarding_step_viewed", {\n      step: onboardingStep,\n      publicSlug: timetable.publicSlug,\n    });\n  }, [dialogOpen, onboardingStep, timetable]);\n\n  useEffect(() => {\n    if (!timetable || !shareSource) return;\n    track("shared_link_opened", {\n      publicSlug: timetable.publicSlug,\n      source: shareSource,\n    });\n  }, [shareSource, timetable]);\n\n  useEffect(() => {\n    if (\n      !dialogOpen ||\n      !timetable ||\n      !calendarDelivery ||\n      onboardingStep !== "success" ||\n      onboardingCompletionTrackedRef.current\n    ) {\n      return;\n    }\n    onboardingCompletionTrackedRef.current = true;\n    track("onboarding_completed", {\n      publicSlug: timetable.publicSlug,\n      provider: calendarDelivery.provider,\n      reminderPreset,\n    });\n    track("share_prompt_viewed", {\n      publicSlug: timetable.publicSlug,\n      source: "onboarding_success",\n    });\n    if (shareSource) {\n      track("shared_link_onboarding_completed", {\n        publicSlug: timetable.publicSlug,\n        source: shareSource,\n      });\n    }\n  }, [\n    calendarDelivery,\n    dialogOpen,\n    onboardingStep,\n    reminderPreset,\n    shareSource,\n    timetable,\n  ]);\n\n  const closeDialog = useCallback(() => {''',
)
replace_once(
    "src/PublicTimetableReliability.tsx",
    '''  const openDialog = useCallback(() => {\n    setCalendarError("");\n    setCopyStatus("");\n    setCalendarDelivery(null);\n    setSelectedProvider(null);\n    setContactSkipped(false);\n    setContactPhone("");\n    setContactCountry("ZW");\n    setOnboardingStep("reminders");\n    setDialogOpen(true);\n    track("calendar_cta_clicked", { publicSlug: timetable?.publicSlug });\n    track("onboarding_opened", { publicSlug: timetable?.publicSlug });\n  }, [timetable?.publicSlug]);''',
    '''  const openDialog = useCallback(() => {\n    onboardingCompletionTrackedRef.current = false;\n    setCalendarError("");\n    setCopyStatus("");\n    setShareStatus("");\n    setCalendarDelivery(null);\n    setSelectedProvider(null);\n    setContactSkipped(false);\n    setContactPhone("");\n    setContactCountry("ZW");\n    setOnboardingStep("reminders");\n    setDialogOpen(true);\n    track("calendar_cta_clicked", { publicSlug: timetable?.publicSlug });\n    track("onboarding_opened", { publicSlug: timetable?.publicSlug });\n    if (shareSource) {\n      track("shared_link_onboarding_started", {\n        publicSlug: timetable?.publicSlug,\n        source: shareSource,\n      });\n    }\n  }, [shareSource, timetable?.publicSlug]);''',
)
replace_once(
    "src/PublicTimetableReliability.tsx",
    '''  async function shareTimetable() {\n    if (!timetable) return;\n    const payload = sharePayload(timetable, publicUrl);\n    setShareStatus("");\n    try {\n      if (navigator.share) {\n        await navigator.share(payload);\n        track("timetable_shared", {\n          method: "web-share",\n          publicSlug: timetable.publicSlug,\n        });\n        return;\n      }\n      await copyText(publicUrl);\n      setShareStatus("Public timetable link copied.");\n      track("timetable_shared", {\n        method: "copy-link",\n        publicSlug: timetable.publicSlug,\n      });\n    } catch (error) {\n      if (error instanceof DOMException && error.name === "AbortError") return;\n      try {\n        await copyText(publicUrl);\n        setShareStatus("Public timetable link copied.");\n      } catch {\n        setShareStatus(publicUrl);\n      }\n    }\n  }''',
    '''  function classSharePayload(source: ClassShareSource) {\n    if (!timetable) return null;\n    return buildClassSharePayload({\n      classLabel: formatClassGroupLabel(timetable.classGroup),\n      publicUrl,\n      source,\n    });\n  }\n\n  async function shareTimetable(source: ClassShareSource = "class_share") {\n    if (!timetable) return;\n    const payload = classSharePayload(source);\n    if (!payload) return;\n    setShareStatus("");\n    try {\n      if (navigator.share) {\n        await navigator.share({\n          title: payload.title,\n          text: payload.text,\n          url: payload.url,\n        });\n        track("timetable_shared", {\n          method: "web-share",\n          source,\n          publicSlug: timetable.publicSlug,\n        });\n        return;\n      }\n      await copyText(payload.message);\n      setShareStatus("Class message copied — ready to paste into your group.");\n      track("timetable_shared", {\n        method: "copy-message",\n        source,\n        publicSlug: timetable.publicSlug,\n      });\n    } catch (error) {\n      if (error instanceof DOMException && error.name === "AbortError") return;\n      setShareStatus("Sharing was cancelled. Your calendar setup is unchanged.");\n    }\n  }\n\n  async function copyClassLink(source: ClassShareSource) {\n    if (!timetable) return;\n    const payload = classSharePayload(source);\n    if (!payload) return;\n    try {\n      await copyText(payload.url);\n      setShareStatus("Public class link copied.");\n      track("timetable_shared", {\n        method: "copy-link",\n        source,\n        publicSlug: timetable.publicSlug,\n      });\n    } catch {\n      setShareStatus(payload.url);\n    }\n  }\n\n  async function copyClassMessage(source: ClassShareSource) {\n    if (!timetable) return;\n    const payload = classSharePayload(source);\n    if (!payload) return;\n    try {\n      await copyText(payload.message);\n      setShareStatus("Class message copied — ready to paste into your group.");\n      track("timetable_shared", {\n        method: "copy-message",\n        source,\n        publicSlug: timetable.publicSlug,\n      });\n    } catch {\n      setShareStatus(payload.url);\n    }\n  }''',
)
replace_once(
    "src/PublicTimetableReliability.tsx",
    '''              onClick={() => {\n                track("share_prompt_viewed", {\n                  publicSlug: currentTimetable.publicSlug,\n                });\n                setOnboardingStep("success");\n              }}''',
    '''              onClick={() => setOnboardingStep("success")}''',
)
replace_once(
    "src/PublicTimetableReliability.tsx",
    '''          <div className="pt-dialog-actions split">\n            <button\n              type="button"\n              className="pt-button pt-button-primary"\n              onClick={() => {\n                track("onboarding_completed", {\n                  publicSlug: currentTimetable.publicSlug,\n                  provider: calendarDelivery.provider,\n                  reminderPreset,\n                });\n                setDialogOpen(false);\n                setCalendarDelivery(null);\n              }}\n            >\n              Done\n            </button>\n            <button\n              type="button"\n              className="pt-button pt-button-secondary"\n              onClick={() => void shareTimetable()}\n            >\n              <Share2 size={18} aria-hidden="true" />\n              Share with classmates\n            </button>\n          </div>''',
    '''          <div className="pt-share-panel">\n            <div>\n              <strong>Help your classmates stay on track too.</strong>\n              <p>\n                Share the public class page. It never includes your private\n                subscription URL, and opening the link does not subscribe\n                someone automatically.\n              </p>\n            </div>\n            <button\n              type="button"\n              className="pt-button pt-button-primary"\n              onClick={() => void shareTimetable("onboarding_success")}\n            >\n              <Share2 size={18} aria-hidden="true" />\n              Share to class group\n            </button>\n            <div className="pt-share-fallbacks">\n              <button\n                type="button"\n                className="pt-button pt-button-secondary"\n                onClick={() => void copyClassMessage("onboarding_success")}\n              >\n                <Copy size={17} aria-hidden="true" />\n                Copy class message\n              </button>\n              <button\n                type="button"\n                className="pt-button pt-button-secondary"\n                onClick={() => void copyClassLink("onboarding_success")}\n              >\n                <Link2 size={17} aria-hidden="true" />\n                Copy class link\n              </button>\n            </div>\n            <small>Optional — your calendar setup is already complete.</small>\n          </div>\n          {shareStatus ? (\n            <p className="pt-status-message" role="status">\n              {shareStatus}\n            </p>\n          ) : null}\n          <div className="pt-dialog-actions">\n            <button\n              type="button"\n              className="pt-button pt-button-secondary"\n              onClick={() => {\n                setDialogOpen(false);\n                setCalendarDelivery(null);\n              }}\n            >\n              Done\n            </button>\n          </div>''',
)
replace_once(
    "src/PublicTimetableReliability.tsx",
    '''                onClick={() => void shareTimetable()}''',
    '''                onClick={() => void shareTimetable("class_share")}''',
)

replace_once(
    "src/publicTimetableReliability.css",
    '''.pt-sticky-cta {''',
    '''.pt-share-panel {\n  display: grid;\n  gap: 10px;\n  padding: 14px;\n  border: 1px solid rgba(21, 61, 50, 0.16);\n  border-radius: 14px;\n  background: var(--pt-sage-soft);\n}\n\n.pt-share-panel > div:first-child {\n  display: grid;\n  gap: 5px;\n}\n\n.pt-share-panel strong {\n  color: var(--pt-forest);\n  font-size: 15px;\n}\n\n.pt-share-panel p,\n.pt-share-panel small {\n  margin: 0;\n  color: var(--pt-muted);\n  font-size: 11px;\n  line-height: 1.55;\n}\n\n.pt-share-fallbacks {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 8px;\n}\n\n.pt-sticky-cta {''',
)
replace_once(
    "src/publicTimetableReliability.css",
    '''  .pt-primary-actions .pt-button {\n    width: 100%;\n    min-height: 50px;\n  }''',
    '''  .pt-primary-actions .pt-button {\n    width: 100%;\n    min-height: 50px;\n  }\n\n  .pt-share-fallbacks {\n    grid-template-columns: minmax(0, 1fr);\n  }''',
)

replace_once(
    "src/ClassRepCorrectionSafetyEnhancement.tsx",
    '''  CheckCircle2,\n  ChevronDown,''',
    '''  CheckCircle2,\n  ChevronDown,\n  Copy,''',
)
replace_once(
    "src/ClassRepCorrectionSafetyEnhancement.tsx",
    '''  RotateCcw,\n  ShieldCheck,''',
    '''  RotateCcw,\n  Share2,\n  ShieldCheck,''',
)
replace_once(
    "src/ClassRepCorrectionSafetyEnhancement.tsx",
    '''import { createPortal } from "react-dom";''',
    '''import { createPortal } from "react-dom";\nimport { track } from "./analytics";''',
)
replace_once(
    "src/ClassRepCorrectionSafetyEnhancement.tsx",
    '''import { getTomorrowSchedule } from "./domain/tomorrowSchedule";''',
    '''import { getTomorrowSchedule } from "./domain/tomorrowSchedule";\nimport { buildClassSharePayload } from "./domain/shareAttribution";''',
)
replace_once(
    "src/ClassRepCorrectionSafetyEnhancement.tsx",
    '''function correctionFormFromItem(''',
    '''async function copyClassShareText(value: string) {\n  if (!navigator.clipboard?.writeText) {\n    throw new Error("Clipboard copy is unavailable.");\n  }\n  await navigator.clipboard.writeText(value);\n}\n\nfunction correctionFormFromItem(''',
)
replace_once(
    "src/ClassRepCorrectionSafetyEnhancement.tsx",
    '''  const visibleEntries = showAllUpdates\n    ? orderedEntries\n    : orderedEntries.slice(0, 5);\n\n  return (''',
    '''  const visibleEntries = showAllUpdates\n    ? orderedEntries\n    : orderedEntries.slice(0, 5);\n  const classDistributionBlocked =\n    !assignment.publicSlug || !timetable || duplicateGroups.length > 0;\n\n  function classDistributionPayload() {\n    if (!assignment.publicSlug) return null;\n    return buildClassSharePayload({\n      classLabel: assignment.classGroupLabel,\n      publicUrl: `${window.location.origin}/t/${encodeURIComponent(assignment.publicSlug)}`,\n      source: "class_rep",\n    });\n  }\n\n  async function distributeClass(\n    action: "share" | "copy-message" | "copy-link",\n  ) {\n    if (classDistributionBlocked) {\n      setMessage(\n        duplicateGroups.length > 0\n          ? "Resolve the duplicate class-truth warning before broad sharing."\n          : "Publish and load the class timetable before sharing it.",\n      );\n      return;\n    }\n    const payload = classDistributionPayload();\n    if (!payload) return;\n    setMessage("");\n    try {\n      if (action === "share" && navigator.share) {\n        await navigator.share({\n          title: payload.title,\n          text: payload.text,\n          url: payload.url,\n        });\n        track("timetable_shared", {\n          method: "web-share",\n          source: "class_rep",\n          publicSlug: assignment.publicSlug,\n        });\n        setMessage("Class share sheet opened with the public timetable link.");\n        return;\n      }\n      const value = action === "copy-link" ? payload.url : payload.message;\n      await copyClassShareText(value);\n      track("timetable_shared", {\n        method: action === "copy-link" ? "copy-link" : "copy-message",\n        source: "class_rep",\n        publicSlug: assignment.publicSlug,\n      });\n      setMessage(\n        action === "copy-link"\n          ? "Public class link copied."\n          : "Class-ready message copied — paste it into the class group.",\n      );\n    } catch (error) {\n      if (error instanceof DOMException && error.name === "AbortError") return;\n      setMessage("Could not share just now. The public timetable is unchanged.");\n    }\n  }\n\n  return (''',
)
replace_once(
    "src/ClassRepCorrectionSafetyEnhancement.tsx",
    '''        {assignment.publicSlug ? (\n          <a\n            className="dr57-action ghost"\n            href={`/t/${assignment.publicSlug}`}\n            target="_blank"\n            rel="noreferrer"\n          >\n            <ExternalLink size={17} /> View public\n          </a>\n        ) : null}\n      </div>\n\n      <div className="dr57-main-grid">''',
    '''        {assignment.publicSlug ? (\n          <>\n            <button\n              className="dr57-action secondary dr47-share-action"\n              type="button"\n              disabled={classDistributionBlocked}\n              onClick={() => void distributeClass("share")}\n            >\n              <Share2 size={17} /> Share with class\n            </button>\n            <a\n              className="dr57-action ghost"\n              href={`/t/${assignment.publicSlug}`}\n              target="_blank"\n              rel="noreferrer"\n            >\n              <ExternalLink size={17} /> View public\n            </a>\n          </>\n        ) : null}\n      </div>\n\n      {assignment.publicSlug ? (\n        <div\n          className="dr47-distribution-kit"\n          data-blocked={classDistributionBlocked ? "true" : "false"}\n        >\n          <div>\n            <strong>Class distribution</strong>\n            <span>\n              {classDistributionBlocked\n                ? "Resolve class-truth warnings before broad sharing."\n                : "Public link only — never a student's private calendar feed."}\n            </span>\n          </div>\n          <div className="dr47-distribution-actions">\n            <button\n              type="button"\n              disabled={classDistributionBlocked}\n              onClick={() => void distributeClass("copy-message")}\n            >\n              <Copy size={15} /> Copy class message\n            </button>\n            <button\n              type="button"\n              disabled={classDistributionBlocked}\n              onClick={() => void distributeClass("copy-link")}\n            >\n              <ExternalLink size={15} /> Copy public link\n            </button>\n          </div>\n        </div>\n      ) : null}\n\n      <div className="dr57-main-grid">''',
)
replace_once(
    "src/classRepCorrectionSafetyEnhancement.css",
    '''  grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr) auto;''',
    '''  grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr) minmax(0, 0.8fr) auto;''',
)
replace_once(
    "src/classRepCorrectionSafetyEnhancement.css",
    '''.dr57-message {''',
    '''.dr47-distribution-kit {\n  align-items: center;\n  background: rgba(98, 215, 170, 0.055);\n  border: 1px solid rgba(98, 215, 170, 0.18);\n  border-radius: 14px;\n  display: flex;\n  gap: 1rem;\n  justify-content: space-between;\n  padding: 0.85rem 1rem;\n}\n\n.dr47-distribution-kit > div:first-child {\n  display: grid;\n  gap: 0.2rem;\n}\n\n.dr47-distribution-kit strong {\n  color: var(--dr57-brand-strong);\n  font-size: 0.84rem;\n}\n\n.dr47-distribution-kit span {\n  color: var(--dr57-text-3);\n  font-size: 0.76rem;\n}\n\n.dr47-distribution-kit[data-blocked="true"] {\n  background: rgba(247, 199, 98, 0.07);\n  border-color: rgba(247, 199, 98, 0.2);\n}\n\n.dr47-distribution-actions {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 0.5rem;\n}\n\n.dr47-distribution-actions button {\n  align-items: center;\n  background: transparent;\n  border: 1px solid var(--dr57-line-strong);\n  border-radius: 10px;\n  color: var(--dr57-text-2);\n  cursor: pointer;\n  display: inline-flex;\n  font: inherit;\n  font-size: 0.76rem;\n  font-weight: 750;\n  gap: 0.4rem;\n  min-height: 2.6rem;\n  padding: 0.55rem 0.7rem;\n}\n\n.dr47-distribution-actions button:disabled {\n  cursor: not-allowed;\n  opacity: 0.5;\n}\n\n.dr57-message {''',
)
replace_once(
    "src/classRepCorrectionSafetyEnhancement.css",
    '''  .dr57-action.ghost {\n    display: none;\n  }''',
    '''  .dr57-action.ghost {\n    display: none;\n  }\n\n  .dr47-distribution-kit {\n    align-items: stretch;\n    flex-direction: column;\n  }\n\n  .dr47-distribution-actions {\n    display: grid;\n    grid-template-columns: 1fr 1fr;\n  }''',
)
replace_once(
    "src/classRepCorrectionSafetyEnhancement.css",
    '''  .dr57-action {\n    font-size: 0.8rem;\n    gap: 0.45rem;\n    min-height: 3.1rem;\n    padding: 0.65rem 0.55rem;\n  }''',
    '''  .dr57-action {\n    font-size: 0.8rem;\n    gap: 0.45rem;\n    min-height: 3.1rem;\n    padding: 0.65rem 0.55rem;\n  }\n\n  .dr47-distribution-actions {\n    grid-template-columns: 1fr;\n  }''',
)

Path("tests/shareAttribution.test.ts").write_text(r'''import { describe, expect, it } from "vitest";
import {
  buildAttributedClassUrl,
  buildClassSharePayload,
  readClassShareSource,
  sanitizeClassShareSource,
} from "../src/domain/shareAttribution";

describe("DR-47 class share attribution", () => {
  it("accepts only the coarse non-sensitive source allowlist", () => {
    expect(sanitizeClassShareSource("class_share")).toBe("class_share");
    expect(sanitizeClassShareSource("CLASS_REP")).toBe("class_rep");
    expect(sanitizeClassShareSource("onboarding_success")).toBe(
      "onboarding_success",
    );
    expect(sanitizeClassShareSource("subscriber-123")).toBeNull();
    expect(sanitizeClassShareSource("private-token")).toBeNull();
  });

  it("rebuilds attribution from the canonical public timetable URL only", () => {
    expect(
      buildAttributedClassUrl(
        "https://calender.aido.co.zw/t/hit-cs-1?utm_source=old#private",
        "class_rep",
      ),
    ).toBe("https://calender.aido.co.zw/t/hit-cs-1?src=class_rep");
    expect(() =>
      buildAttributedClassUrl(
        "https://calender.aido.co.zw/calendar/feed/private-token.ics",
        "class_share",
      ),
    ).toThrow(/public timetable URL/i);
  });

  it("builds WhatsApp-friendly copy without implying that opening the link subscribes", () => {
    const payload = buildClassSharePayload({
      classLabel: "Class 1.1",
      publicUrl: "https://calender.aido.co.zw/t/hit-cs-1",
      source: "onboarding_success",
    });
    expect(payload.url).toBe(
      "https://calender.aido.co.zw/t/hit-cs-1?src=onboarding_success",
    );
    expect(payload.message).toContain("see tomorrow's classes");
    expect(payload.message).toContain("add it to your calendar");
    expect(payload.message).not.toMatch(/automatically subscribed|private-token/i);
  });

  it("reads shared-link attribution only when it is allowlisted", () => {
    expect(
      readClassShareSource(
        "https://calender.aido.co.zw/t/hit-cs-1?src=class_share",
      ),
    ).toBe("class_share");
    expect(
      readClassShareSource(
        "https://calender.aido.co.zw/t/hit-cs-1?src=user-identity",
      ),
    ).toBeNull();
  });
});
''')

Path("tests/dr47ClassShare.test.tsx").write_text(r'''import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicTimetable } from "../src/api/pilotTypes";

const mocks = vi.hoisted(() => ({
  fetchPublicTimetable: vi.fn(),
  createCalendarSubscription: vi.fn(),
  track: vi.fn(),
}));

vi.mock("../src/api/publicTimetable", () => ({
  fetchPublicTimetable: mocks.fetchPublicTimetable,
}));
vi.mock("../src/api/calendarSubscriptions", () => ({
  createCalendarSubscription: mocks.createCalendarSubscription,
}));
vi.mock("../src/analytics", () => ({ track: mocks.track }));

import { PublicTimetableReliability } from "../src/PublicTimetableReliability";

const timetable: PublicTimetable = {
  timetableId: "tt-hit-cs1",
  publicSlug: "hit-cs-1-1-august-2026",
  institution: "Harare Institute of Technology",
  institutionShortName: "HIT",
  institutionTimezone: "Africa/Harare",
  programme: "BTech Computer Science",
  classGroup: "1.1",
  academicPeriod: "August Semester 2026",
  startsOn: "2026-08-10",
  endsOn: "2026-12-10",
  publishedAt: "2026-08-29T08:00:00.000Z",
  versionNumber: 4,
  sessions: [
    {
      stableSessionKey: "ics1102-tue-1400",
      courseCode: "ICS1102",
      courseName: "Operating Systems",
      weekday: 2,
      startTime: "14:00:00",
      endTime: "16:00:00",
      venue: "N205",
      lecturer: "Ms Dube",
      sessionType: "Lecture",
      notes: null,
    },
  ],
};

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly scrollMargin = "0px";
  readonly thresholds = [0.15];
  constructor(_callback: IntersectionObserverCallback) {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
}

function setIphone() {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1",
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    configurable: true,
    value: 5,
  });
}

async function reachSuccess() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Subscribe to calendar" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: /Apple Calendar/i }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Skip for now" }),
  );
  const ready = await screen.findByRole("dialog", { name: "Calendar ready" });
  fireEvent.click(within(ready).getByRole("button", { name: "Continue" }));
  return screen.findByRole("dialog", { name: "You're on track" });
}

beforeEach(() => {
  mocks.fetchPublicTimetable.mockReset().mockResolvedValue(timetable);
  mocks.createCalendarSubscription.mockReset().mockResolvedValue({
    subscriptionId: "sub-private",
    provider: "apple_subscription",
    calendarName: "Class 1.1 · CalenderZW",
    feedUrl: "https://calender.aido.co.zw/calendar/feed/private-token.ics",
    appleDeepLinkUrl:
      "webcal://calender.aido.co.zw/calendar/feed/private-token.ics",
    appleSubscribeUrl:
      "webcal://calender.aido.co.zw/calendar/feed/private-token.ics",
    downloadUrl: "https://calender.aido.co.zw/calendar/download/sub-private.ics",
    expiresAt: null,
    contact: { saved: false },
    warnings: [],
  });
  mocks.track.mockReset();
  setIphone();
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
  Object.defineProperty(window.navigator, "share", {
    configurable: true,
    value: vi.fn(async () => undefined),
  });
  window.history.replaceState({}, "", `/t/${timetable.publicSlug}`);
});

describe("DR-47 class viral loop", () => {
  it("attributes shared-link acquisition through onboarding and shares only a new public class URL", async () => {
    window.history.replaceState(
      {},
      "",
      `/t/${timetable.publicSlug}?src=class_share`,
    );
    const nativeShare = window.navigator.share as ReturnType<typeof vi.fn>;
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);

    await screen.findByRole("heading", { name: "BTech Computer Science" });
    expect(mocks.track).toHaveBeenCalledWith("shared_link_opened", {
      publicSlug: timetable.publicSlug,
      source: "class_share",
    });

    const success = await reachSuccess();
    expect(
      within(success).getByText("Help your classmates stay on track too."),
    ).toBeInTheDocument();
    expect(
      within(success).getByText(/calendar setup is already complete/i),
    ).toBeInTheDocument();
    expect(mocks.track).toHaveBeenCalledWith(
      "shared_link_onboarding_started",
      expect.objectContaining({ source: "class_share" }),
    );
    expect(mocks.track).toHaveBeenCalledWith(
      "shared_link_onboarding_completed",
      expect.objectContaining({ source: "class_share" }),
    );
    expect(mocks.track).toHaveBeenCalledWith(
      "onboarding_completed",
      expect.objectContaining({ publicSlug: timetable.publicSlug }),
    );

    fireEvent.click(
      within(success).getByRole("button", { name: "Share to class group" }),
    );
    await waitFor(() => expect(nativeShare).toHaveBeenCalledTimes(1));
    const payload = nativeShare.mock.calls[0][0] as {
      text: string;
      url: string;
    };
    expect(payload.url).toBe(
      `http://localhost:3000/t/${timetable.publicSlug}?src=onboarding_success`,
    );
    expect(payload.text).toContain("see tomorrow's classes");
    expect(JSON.stringify(payload)).not.toContain("private-token");
    expect(mocks.track).toHaveBeenCalledWith(
      "timetable_shared",
      expect.objectContaining({
        method: "web-share",
        source: "onboarding_success",
      }),
    );
  });

  it("falls back to a WhatsApp-ready class message rather than copying a private feed", async () => {
    Object.defineProperty(window.navigator, "share", {
      configurable: true,
      value: undefined,
    });
    const clipboard = window.navigator.clipboard.writeText as ReturnType<
      typeof vi.fn
    >;
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Share with classmates" }),
    );
    await waitFor(() => expect(clipboard).toHaveBeenCalledTimes(1));
    const copied = String(clipboard.mock.calls[0][0]);
    expect(copied).toContain("Class 1.1 timetable is live on CalenderZW");
    expect(copied).toContain(`?src=class_share`);
    expect(copied).not.toContain("private-token");
    expect(mocks.track).toHaveBeenCalledWith(
      "timetable_shared",
      expect.objectContaining({ method: "copy-message", source: "class_share" }),
    );
  });

  it("ignores untrusted attribution values", async () => {
    window.history.replaceState(
      {},
      "",
      `/t/${timetable.publicSlug}?src=subscriber-private-identity`,
    );
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);
    await screen.findByRole("heading", { name: "BTech Computer Science" });
    expect(mocks.track).not.toHaveBeenCalledWith(
      "shared_link_opened",
      expect.anything(),
    );
  });
});
''')

Path("tests/dr47ClassRepDistribution.test.ts").write_text(r'''import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DR-47 Class Rep distribution kit", () => {
  const source = readFileSync(
    "src/ClassRepCorrectionSafetyEnhancement.tsx",
    "utf8",
  );

  it("exposes one-tap class sharing plus explicit message/link fallbacks", () => {
    expect(source).toContain("Share with class");
    expect(source).toContain("Copy class message");
    expect(source).toContain("Copy public link");
    expect(source).toContain('source: "class_rep"');
  });

  it("blocks broad distribution while class-truth duplicate warnings remain", () => {
    expect(source).toContain("classDistributionBlocked");
    expect(source).toContain("duplicateGroups.length > 0");
    expect(source).toContain("Resolve the duplicate class-truth warning");
  });

  it("never builds distribution from a private feed URL", () => {
    expect(source).toContain("/t/${encodeURIComponent(assignment.publicSlug)}");
    expect(source).not.toContain("/calendar/feed/");
  });
});
''')
