import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { Check, MessageSquareText, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  createGrowthRequest,
  type GrowthFeedbackType,
  type GrowthRequestType,
} from "./api/growthRequests";

export type GrowthRequestSeed = {
  timetableId?: string;
  publicSlug?: string;
  institutionName?: string;
  programmeName?: string;
  classGroupLabel?: string;
  academicPeriodName?: string;
};

type GrowthRequestDialogProps = {
  mode: GrowthRequestType;
  triggerLabel?: string;
  seed?: GrowthRequestSeed;
  triggerClassName?: string;
};

type FormState = {
  institutionName: string;
  programmeName: string;
  classGroupLabel: string;
  academicPeriodName: string;
  feedbackType: GrowthFeedbackType;
  rating: string;
  message: string;
  contactName: string;
  contactEmail: string;
  contactPhoneE164: string;
  contactConsent: boolean;
  isClassRep: boolean;
  canProvideSource: boolean;
  testimonialConsent: boolean;
  website: string;
};

function initialState(seed?: GrowthRequestSeed): FormState {
  return {
    institutionName: seed?.institutionName ?? "",
    programmeName: seed?.programmeName ?? "",
    classGroupLabel: seed?.classGroupLabel ?? "",
    academicPeriodName: seed?.academicPeriodName ?? "",
    feedbackType: "suggestion",
    rating: "",
    message: "",
    contactName: "",
    contactEmail: "",
    contactPhoneE164: "",
    contactConsent: false,
    isClassRep: false,
    canProvideSource: false,
    testimonialConsent: false,
    website: "",
  };
}

function Label({
  text,
  optional = false,
  children,
}: {
  text: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="czw-growth-field">
      <span>
        {text} {optional ? <small>Optional</small> : null}
      </span>
      {children}
    </label>
  );
}

export function GrowthRequestDialog({
  mode,
  triggerLabel,
  seed,
  triggerClassName,
}: GrowthRequestDialogProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => initialState(seed));
  const [status, setStatus] = useState<"idle" | "submitting" | "success">(
    "idle",
  );
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm((current) => ({
      ...current,
      institutionName: seed?.institutionName ?? current.institutionName,
      programmeName: seed?.programmeName ?? current.programmeName,
      classGroupLabel: seed?.classGroupLabel ?? current.classGroupLabel,
      academicPeriodName:
        seed?.academicPeriodName ?? current.academicPeriodName,
    }));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, seed]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openDialog() {
    setStatus("idle");
    setError("");
    setOpen(true);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setError("");
    try {
      await createGrowthRequest({
        requestType: mode,
        timetableId: seed?.timetableId,
        publicSlug: seed?.publicSlug,
        institutionName:
          mode === "missing_timetable" ? form.institutionName : undefined,
        programmeName:
          mode === "missing_timetable" ? form.programmeName : undefined,
        classGroupLabel:
          mode === "missing_timetable" ? form.classGroupLabel : undefined,
        academicPeriodName:
          mode === "missing_timetable" ? form.academicPeriodName : undefined,
        feedbackType: mode === "feedback" ? form.feedbackType : undefined,
        rating:
          mode === "feedback" && form.rating ? Number(form.rating) : undefined,
        message: form.message,
        contactName: form.contactName,
        contactEmail: form.contactEmail,
        contactPhoneE164: form.contactPhoneE164,
        contactConsent: form.contactConsent,
        isClassRep: mode === "missing_timetable" ? form.isClassRep : undefined,
        canProvideSource:
          mode === "missing_timetable" ? form.canProvideSource : undefined,
        testimonialConsent:
          mode === "feedback" ? form.testimonialConsent : undefined,
        sourcePage: window.location.pathname,
        website: form.website,
      });
      setStatus("success");
    } catch (caught) {
      setStatus("idle");
      setError(
        caught instanceof Error
          ? caught.message
          : "We could not save that request. Please try again.",
      );
    }
  }

  const title =
    mode === "missing_timetable"
      ? "Get my timetable on CalenderZW"
      : "Give CalenderZW feedback";
  const defaultTrigger =
    mode === "missing_timetable" ? "Request my timetable" : "Give feedback";

  return (
    <>
      <Button
        type="button"
        className={triggerClassName ?? "czw-growth-trigger"}
        onClick={openDialog}
      >
        {mode === "feedback" ? (
          <MessageSquareText size={16} aria-hidden="true" />
        ) : (
          <Send size={16} aria-hidden="true" />
        )}
        {triggerLabel ?? defaultTrigger}
      </Button>

      {open ? (
        <div
          className="czw-growth-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            className="czw-growth-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="czw-growth-dialog-title"
          >
            <div className="czw-growth-dialog-header">
              <div>
                <span className="czw-eyebrow">
                  {mode === "missing_timetable"
                    ? "Help us prioritise your class"
                    : "Private feedback inbox"}
                </span>
                <h2 id="czw-growth-dialog-title">{title}</h2>
              </div>
              <Button
                ref={closeRef}
                type="button"
                className="czw-growth-close"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                <X size={19} aria-hidden="true" />
              </Button>
            </div>

            {status === "success" ? (
              <div className="czw-growth-success" role="status">
                <span>
                  <Check size={20} aria-hidden="true" />
                </span>
                <h3>Received.</h3>
                <p>
                  {mode === "missing_timetable"
                    ? "Your class is now in the demand inbox. Class Rep and source-access signals help us prioritise onboarding."
                    : "Your feedback is private. Testimonial permission never publishes anything automatically; founder approval is still required."}
                </p>
                <Button
                  type="button"
                  className="czw-button czw-button-primary"
                  onClick={() => setOpen(false)}
                >
                  Done
                </Button>
              </div>
            ) : (
              <form className="czw-growth-form" onSubmit={submit}>
                {mode === "missing_timetable" ? (
                  <>
                    <div className="czw-growth-two-col">
                      <Label text="Institution">
                        <Input
                          required
                          value={form.institutionName}
                          onChange={(event) =>
                            update("institutionName", event.target.value)
                          }
                          placeholder="e.g. Harare Institute of Technology"
                        />
                      </Label>
                      <Label text="Programme">
                        <Input
                          required
                          value={form.programmeName}
                          onChange={(event) =>
                            update("programmeName", event.target.value)
                          }
                          placeholder="e.g. Computer Science"
                        />
                      </Label>
                    </div>
                    <div className="czw-growth-two-col">
                      <Label text="Class / group">
                        <Input
                          required
                          value={form.classGroupLabel}
                          onChange={(event) =>
                            update("classGroupLabel", event.target.value)
                          }
                          placeholder="e.g. Part 2.1"
                        />
                      </Label>
                      <Label text="Academic period" optional>
                        <Input
                          value={form.academicPeriodName}
                          onChange={(event) =>
                            update("academicPeriodName", event.target.value)
                          }
                          placeholder="e.g. August Semester 2026"
                        />
                      </Label>
                    </div>
                    <div className="czw-growth-choice-grid">
                      <label>
                        <input
                          type="checkbox"
                          checked={form.isClassRep}
                          onChange={(event) =>
                            update("isClassRep", event.target.checked)
                          }
                        />
                        <span>
                          <strong>I’m a Class Rep</strong>
                          <small>I can help verify the class timetable.</small>
                        </span>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={form.canProvideSource}
                          onChange={(event) =>
                            update("canProvideSource", event.target.checked)
                          }
                        />
                        <span>
                          <strong>I can provide the official source</strong>
                          <small>Useful for Source Gateway onboarding.</small>
                        </span>
                      </label>
                    </div>
                    <Label text="Anything we should know?" optional>
                      <textarea
                        rows={3}
                        value={form.message}
                        onChange={(event) => update("message", event.target.value)}
                        placeholder="Where the timetable comes from, who manages it, or what your class needs."
                      />
                    </Label>
                  </>
                ) : (
                  <>
                    <div className="czw-growth-two-col">
                      <Label text="Feedback type">
                        <select
                          value={form.feedbackType}
                          onChange={(event) =>
                            update(
                              "feedbackType",
                              event.target.value as GrowthFeedbackType,
                            )
                          }
                        >
                          <option value="timetable_problem">
                            Timetable problem
                          </option>
                          <option value="product_problem">Product problem</option>
                          <option value="suggestion">Suggestion</option>
                          <option value="rating">Rating / review</option>
                          <option value="other">Other</option>
                        </select>
                      </Label>
                      <Label text="Rating" optional>
                        <select
                          value={form.rating}
                          onChange={(event) =>
                            update("rating", event.target.value)
                          }
                        >
                          <option value="">No rating</option>
                          <option value="5">5 — Excellent</option>
                          <option value="4">4 — Good</option>
                          <option value="3">3 — Okay</option>
                          <option value="2">2 — Poor</option>
                          <option value="1">1 — Very poor</option>
                        </select>
                      </Label>
                    </div>
                    <Label text="Feedback">
                      <textarea
                        required
                        rows={5}
                        value={form.message}
                        onChange={(event) => update("message", event.target.value)}
                        placeholder="Tell us what happened, what helped, or what should change."
                      />
                    </Label>
                  </>
                )}

                <div className="czw-growth-contact-block">
                  <div>
                    <strong>Contact details</strong>
                    <span>Optional. Stored only when you consent below.</span>
                  </div>
                  <div className="czw-growth-two-col">
                    <Label text="Name" optional>
                      <Input
                        value={form.contactName}
                        onChange={(event) =>
                          update("contactName", event.target.value)
                        }
                      />
                    </Label>
                    <Label text="Email" optional>
                      <Input
                        type="email"
                        inputMode="email"
                        value={form.contactEmail}
                        onChange={(event) =>
                          update("contactEmail", event.target.value)
                        }
                      />
                    </Label>
                  </div>
                  <Label text="Phone / WhatsApp" optional>
                    <Input
                      type="tel"
                      inputMode="tel"
                      value={form.contactPhoneE164}
                      onChange={(event) =>
                        update("contactPhoneE164", event.target.value)
                      }
                      placeholder="+263…"
                    />
                  </Label>
                  <label className="czw-growth-consent">
                    <input
                      type="checkbox"
                      checked={form.contactConsent}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        update("contactConsent", checked);
                        if (!checked) update("testimonialConsent", false);
                      }}
                    />
                    <span>
                      I agree that CalenderZW may store these contact details and
                      contact me about this request.
                    </span>
                  </label>
                  {mode === "feedback" ? (
                    <label className="czw-growth-consent">
                      <input
                        type="checkbox"
                        disabled={!form.contactConsent}
                        checked={form.testimonialConsent}
                        onChange={(event) =>
                          update("testimonialConsent", event.target.checked)
                        }
                      />
                      <span>
                        CalenderZW may consider this feedback for a public
                        testimonial. This is permission to review it, not
                        automatic publication.
                      </span>
                    </label>
                  ) : null}
                </div>

                <label className="czw-growth-honeypot" aria-hidden="true">
                  Website
                  <input
                    tabIndex={-1}
                    autoComplete="off"
                    value={form.website}
                    onChange={(event) => update("website", event.target.value)}
                  />
                </label>

                {error ? (
                  <p className="czw-growth-error" role="alert">
                    {error}
                  </p>
                ) : null}
                <div className="czw-growth-actions">
                  <Button
                    type="button"
                    className="czw-button czw-button-secondary"
                    disabled={status === "submitting"}
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="czw-button czw-button-primary"
                    disabled={status === "submitting"}
                  >
                    <Send size={16} aria-hidden="true" />
                    {status === "submitting"
                      ? "Sending…"
                      : mode === "missing_timetable"
                        ? "Request timetable"
                        : "Send feedback"}
                  </Button>
                </div>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
