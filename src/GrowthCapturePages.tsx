import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { useState } from "react";
import { PublicShell } from "./components/site/SiteChrome";

type SubmitState = "idle" | "submitting" | "success" | "error";

async function postJson(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;
  if (!response.ok)
    throw new Error(payload?.error?.message ?? "Submission failed.");
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="czw-growth-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function TimetableRequestPage() {
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const consentContact = form.get("consentContact") === "on";
    setState("submitting");
    setMessage("");
    try {
      await postJson("/api/public/timetable-requests", {
        institutionName: form.get("institutionName"),
        programmeName: form.get("programmeName"),
        classGroup: form.get("classGroup"),
        academicPeriod: form.get("academicPeriod"),
        requesterRole: form.get("requesterRole"),
        sourceAccess: form.get("sourceAccess"),
        sourceNote: form.get("sourceNote"),
        contactName: form.get("contactName"),
        phoneE164: form.get("phoneE164"),
        email: form.get("email"),
        consentContact,
      });
      event.currentTarget.reset();
      setState("success");
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error ? error.message : "Could not send request.",
      );
    }
  }

  return (
    <PublicShell>
      <main className="czw-growth-page">
        <section className="czw-growth-hero">
          <span>Missing timetable?</span>
          <h1>Get your class onto CalenderZW.</h1>
          <p>
            Tell us which class is missing. If you are a Class Rep or have an
            official source document/link, say so — that can speed up
            publication.
          </p>
        </section>
        <section className="czw-growth-card" aria-labelledby="request-heading">
          <div>
            <h2 id="request-heading">Request a timetable</h2>
            <p>
              We use this to prioritise real student demand, not to build a
              marketing list.
            </p>
          </div>
          <form onSubmit={submit}>
            <div className="czw-growth-grid">
              <Field label="University / institution *">
                <Input name="institutionName" required maxLength={160} />
              </Field>
              <Field label="Programme *">
                <Input name="programmeName" required maxLength={160} />
              </Field>
              <Field label="Class / part / group *">
                <Input
                  name="classGroup"
                  required
                  maxLength={120}
                  placeholder="e.g. CS 1.1"
                />
              </Field>
              <Field label="Academic period">
                <Input
                  name="academicPeriod"
                  maxLength={120}
                  placeholder="e.g. Aug Semester 2026"
                />
              </Field>
              <Field label="You are">
                <select name="requesterRole" defaultValue="student">
                  <option value="student">Student</option>
                  <option value="class_rep">Class Rep</option>
                  <option value="staff">University staff</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Source access">
                <select name="sourceAccess" defaultValue="none">
                  <option value="none">I do not have the source</option>
                  <option value="class_rep">
                    I am / can reach the Class Rep
                  </option>
                  <option value="official_link">
                    I have an official timetable link
                  </option>
                  <option value="document">
                    I have the timetable document
                  </option>
                  <option value="other">Other source access</option>
                </select>
              </Field>
            </div>
            <Field label="Source note or link">
              <textarea
                name="sourceNote"
                maxLength={1000}
                rows={4}
                placeholder="Optional — describe where the official timetable comes from."
              />
            </Field>
            <div className="czw-growth-contact">
              <h3>Optional contact</h3>
              <p>
                Only provide this if you want us to contact you about this
                request.
              </p>
              <div className="czw-growth-grid">
                <Field label="Name">
                  <Input name="contactName" maxLength={120} />
                </Field>
                <Field label="WhatsApp / phone">
                  <Input
                    name="phoneE164"
                    inputMode="tel"
                    placeholder="+263…"
                  />
                </Field>
                <Field label="Email">
                  <Input name="email" inputMode="email" />
                </Field>
              </div>
              <label className="czw-growth-check">
                <input type="checkbox" name="consentContact" />
                <span>I agree CalenderZW may contact me about this request.</span>
              </label>
            </div>
            {state === "success" ? (
              <div className="czw-growth-success" role="status">
                Request received. We will use it to prioritise onboarding.
              </div>
            ) : null}
            {state === "error" ? (
              <div className="czw-growth-error" role="alert">
                {message}
              </div>
            ) : null}
            <Button
              className="czw-button czw-button-primary"
              type="submit"
              disabled={state === "submitting"}
            >
              {state === "submitting" ? "Sending…" : "Request this timetable"}
            </Button>
          </form>
        </section>
      </main>
    </PublicShell>
  );
}

export function FeedbackPage() {
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState("submitting");
    setMessage("");
    try {
      await postJson("/api/public/feedback", {
        category: form.get("category"),
        rating: form.get("rating") || null,
        message: form.get("message"),
        publicSlug: form.get("publicSlug"),
        contactName: form.get("contactName"),
        email: form.get("email"),
        phoneE164: form.get("phoneE164"),
        consentContact: form.get("consentContact") === "on",
        testimonialPermission: form.get("testimonialPermission") === "on",
      });
      event.currentTarget.reset();
      setState("success");
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error ? error.message : "Could not send feedback.",
      );
    }
  }

  return (
    <PublicShell>
      <main className="czw-growth-page">
        <section className="czw-growth-hero">
          <span>Help us improve</span>
          <h1>Tell us what worked — or what did not.</h1>
          <p>
            Your feedback goes to the CalenderZW team. Praise is never published
            as a testimonial without your explicit permission and founder
            approval.
          </p>
        </section>
        <section className="czw-growth-card">
          <form onSubmit={submit}>
            <div className="czw-growth-grid">
              <Field label="Feedback type *">
                <select
                  name="category"
                  defaultValue="product_feedback"
                  required
                >
                  <option value="timetable_problem">Timetable problem</option>
                  <option value="calendar_problem">
                    Calendar connection problem
                  </option>
                  <option value="product_feedback">Product feedback</option>
                  <option value="suggestion">Suggestion</option>
                  <option value="praise">Something worked well</option>
                </select>
              </Field>
              <Field label="Rating (optional)">
                <select name="rating" defaultValue="">
                  <option value="">No rating</option>
                  {[5, 4, 3, 2, 1].map((value) => (
                    <option key={value} value={value}>
                      {value}/5
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Message *">
              <textarea
                name="message"
                required
                minLength={3}
                maxLength={4000}
                rows={7}
              />
            </Field>
            <Field label="Timetable slug (optional)">
              <Input name="publicSlug" maxLength={180} />
            </Field>
            <div className="czw-growth-grid">
              <Field label="Name">
                <Input name="contactName" maxLength={120} />
              </Field>
              <Field label="Email">
                <Input name="email" inputMode="email" />
              </Field>
              <Field label="WhatsApp / phone">
                <Input name="phoneE164" inputMode="tel" />
              </Field>
            </div>
            <label className="czw-growth-check">
              <input type="checkbox" name="consentContact" />
              <span>
                I agree CalenderZW may contact me about this feedback.
              </span>
            </label>
            <label className="czw-growth-check">
              <input type="checkbox" name="testimonialPermission" />
              <span>
                If this is positive feedback, CalenderZW may ask to use it
                publicly as a testimonial.
              </span>
            </label>
            {state === "success" ? (
              <div className="czw-growth-success" role="status">
                Thanks — your feedback was received.
              </div>
            ) : null}
            {state === "error" ? (
              <div className="czw-growth-error" role="alert">
                {message}
              </div>
            ) : null}
            <Button
              className="czw-button czw-button-primary"
              type="submit"
              disabled={state === "submitting"}
            >
              {state === "submitting" ? "Sending…" : "Send feedback"}
            </Button>
          </form>
        </section>
      </main>
    </PublicShell>
  );
}
