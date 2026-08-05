import { z } from "zod";

export const correctionReportSchema = z.object({
  timetableId: z.string().min(4),
  issueType: z.enum([
    "wrong_venue",
    "wrong_time",
    "missing_lecture",
    "duplicate",
    "outdated",
    "other",
  ]),
  details: z
    .string()
    .min(12, "Please include enough detail for a verifier.")
    .max(1200),
  contact: z.string().max(120).optional(),
});

export const csvRowSchema = z.object({
  courseCode: z.string().min(2),
  title: z.string().min(2),
  weekday: z.enum(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  venue: z.string().min(2),
  lecturer: z.string().optional(),
  groupName: z.string().optional(),
});

export type CsvRow = z.infer<typeof csvRowSchema>;
