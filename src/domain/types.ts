export type VerificationStatus = "draft" | "community_verified" | "official";
export type EventStatus = "confirmed" | "tentative" | "cancelled";
export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export type AcademicCalendarEvent = {
  id: string;
  timetableId: string;
  timetableVersionId: string;
  courseId?: string;
  courseCode: string;
  title: string;
  description?: string;
  location?: string;
  lecturer?: string;
  groupName?: string;
  timezone: string;
  startsAtLocal: string;
  endsAtLocal: string;
  recurrence?: {
    frequency: "weekly";
    interval: number;
    weekdays: Weekday[];
    until: string;
  };
  exclusions?: string[];
  reminders: number[];
  status: EventStatus;
  sourceUrl?: string;
  verificationStatus: VerificationStatus;
  sequence: number;
  lastModified: string;
};

export type Timetable = {
  id: string;
  slug: string;
  title: string;
  institution: string;
  campus: string;
  faculty: string;
  department: string;
  programme: string;
  part: string;
  groupName: string;
  semester: string;
  semesterStart: string;
  semesterEnd: string;
  timezone: string;
  version: string;
  source: string;
  verifiedBy: string;
  verificationStatus: VerificationStatus;
  lastUpdated: string;
  publicFeedToken: string;
  events: AcademicCalendarEvent[];
  history: TimetableVersion[];
};

export type TimetableVersion = {
  id: string;
  version: string;
  publishedAt: string;
  publishedBy: string;
  summary: string;
  severity: "minor" | "major";
};

export type ReminderPresetId = "on_time" | "prepared" | "commuter" | "custom";

export type ReminderPreset = {
  id: ReminderPresetId;
  label: string;
  description: string;
  minutes: number[];
};

export type CorrectionReport = {
  timetableId: string;
  issueType:
    | "wrong_venue"
    | "wrong_time"
    | "missing_lecture"
    | "duplicate"
    | "outdated"
    | "other";
  details: string;
  contact?: string;
};
