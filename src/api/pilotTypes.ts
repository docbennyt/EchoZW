export type AdminInstitution = {
  id: string;
  name: string;
  shortName: string | null;
  slug: string;
  timezone: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminProgramme = {
  id: string;
  institutionId: string;
  institutionName: string;
  name: string;
  code: string | null;
  slug: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminClassGroup = {
  id: string;
  programmeId: string;
  programmeName: string;
  label: string;
  code: string;
  slug: string;
  yearLevel: number | null;
  semesterNumber: number | null;
  groupName: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminAcademicPeriod = {
  id: string;
  institutionId: string;
  institutionName: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TimetableStatus = "draft" | "published" | "superseded";

export type AdminTimetableSummary = {
  id: string;
  publicSlug: string;
  institutionName: string;
  programmeName: string;
  classGroupLabel: string;
  academicPeriodName: string;
  status: "Draft" | "Published";
  lastUpdated: string;
  currentDraftVersionId: string | null;
  currentPublishedVersionId: string | null;
};

export type AdminTimetableSession = {
  id: string;
  timetableVersionId: string;
  stableSessionKey: string;
  courseCode: string;
  courseName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  venue: string | null;
  lecturer: string | null;
  sessionType: string | null;
  notes: string | null;
};

export type AdminTimetableVersion = {
  id: string;
  versionNumber: number;
  status: TimetableStatus;
  publishedAt: string | null;
  changeSummary: string | null;
  createdAt: string;
  sessionCount: number;
};

export type AdminCourseMemoryEntry = {
  courseCode: string;
  courseName: string;
  lecturerSuggestions: string[];
  venueSuggestions: string[];
  sessionTypeSuggestions: string[];
};

export type StaffAssignmentSummary = {
  id: string;
  timetableId: string;
  active: boolean;
  revokedAt: string | null;
  publicSlug: string;
  institutionName: string;
  programmeName: string;
  classGroupLabel: string;
  academicPeriodName: string;
};

export type StaffMember = {
  id: string;
  userId: string;
  email: string | null;
  displayName: string | null;
  role: "superadmin" | "class_rep";
  active: boolean;
  invitedAt: string | null;
  lastInvitedAt: string | null;
  acceptedAt: string | null;
  disabledAt: string | null;
  assignments: StaffAssignmentSummary[];
};

export type AdminTimetableEditor = {
  timetable: {
    id: string;
    publicSlug: string;
    institutionId: string;
    institutionName: string;
    programmeId: string;
    programmeName: string;
    classGroupId: string;
    classGroupLabel: string;
    academicPeriodId: string;
    academicPeriodName: string;
    academicPeriodStartsOn: string | null;
    academicPeriodEndsOn: string | null;
    currentPublishedVersionId: string | null;
  };
  activeVersion: AdminTimetableVersion;
  versions: AdminTimetableVersion[];
  sessions: AdminTimetableSession[];
  courseMemory: AdminCourseMemoryEntry[];
};

export type PublicTimetableSession = {
  stableSessionKey: string;
  courseCode: string;
  courseName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  venue: string | null;
  lecturer: string | null;
  sessionType: string | null;
  notes: string | null;
};

export type TimetableCorrectionDirective = {
  id: string;
  stableSessionKey: string | null;
  action: "add" | "modify" | "remove";
  sourceMayReplace: boolean;
  pinned: boolean;
  courseCode: string | null;
  courseName: string | null;
  weekday: number | null;
  startTime: string | null;
  endTime: string | null;
  venue: string | null;
  lecturer: string | null;
  sessionType: string | null;
  notes: string | null;
  reason: string;
  provenance: string | null;
  creatorRole: "superadmin" | "class_rep";
  active: boolean;
  createdAt: string;
};

export type TimetableSessionException = {
  id: string;
  stableSessionKey: string | null;
  exceptionDate: string;
  exceptionType: "cancelled" | "moved" | "extra";
  replacementStartsAt: string | null;
  replacementEndsAt: string | null;
  courseCode: string | null;
  courseName: string | null;
  startTime: string | null;
  endTime: string | null;
  venue: string | null;
  lecturer: string | null;
  sessionType: string | null;
  notes: string | null;
  reason: string | null;
  provenance: string | null;
  active: boolean;
  createdAt: string;
};

export type PublicTimetable = {
  timetableId: string;
  publicSlug: string;
  institution: string;
  institutionShortName: string | null;
  institutionTimezone: string;
  programme: string;
  classGroup: string;
  academicPeriod: string;
  startsOn: string | null;
  endsOn: string | null;
  publishedAt: string | null;
  versionNumber: number;
  sessions: PublicTimetableSession[];
  corrections?: TimetableCorrectionDirective[];
  exceptions?: TimetableSessionException[];
};

export type PublishTimetableResponse = {
  publicUrl: string;
  publicSlug: string;
  versionNumber: number;
  sessionCount: number;
  publishedAt: string;
};

export type DeleteTimetableSessionResponse = {
  ok: true;
  deletedSessionId: string;
};
