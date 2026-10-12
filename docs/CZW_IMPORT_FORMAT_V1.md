# CZW Import Format v1

`czw-import-format-v1` is the frozen CalenderZW ingestion MVP contract. Native adapters and AI-normalized sources must produce this evidence shape before the existing review and guarded draft workflow runs.

Supported source paths:

- CZW XLSX template, preferred for human or AI normalization.
- CZW JSON with the same schema.
- CSV flat session rows with documented aliases.
- Deterministic generic XLSX with the same flat aliases.
- Existing structured DOCX best effort.
- Searchable/text-layer PDF only when the text already contains deterministic tabular rows.


Recommended AI normalization prompt:

- `/templates/czw-timetable-ai-prompt-v1.1.md` — classification-first prompt revision. It keeps the frozen `czw-import-format-v1` output contract unchanged while forcing the model to identify timetable scope/layout before extraction.
- `/templates/czw-timetable-ai-prompt-v1.md` — original prompt revision retained for reproducibility.

Unsupported:

- OCR.
- Image-only PDF or screenshots.
- Hosted CalenderZW LLM extraction.
- Neural or filename-specific parser behavior.

Required JSON shape:

```json
{
  "version": "czw-import-format-v1",
  "source": {
    "title": "Example timetable",
    "institutionName": "Harare Institute of Technology",
    "academicUnitName": "Biomedical Engineering",
    "academicYear": "2026-2027",
    "semesterNumber": 1
  },
  "targets": [
    {
      "targetKey": "part-1-semester-1",
      "title": "Part 1 Semester 1",
      "academicUnitName": "Biomedical Engineering",
      "yearLevel": 1,
      "semesterNumber": 1,
      "academicYear": "2026-2027"
    }
  ],
  "courses": [
    {
      "targetKey": "part-1-semester-1",
      "courseCode": "EBE 1103",
      "courseName": "Engineering Chemistry",
      "hoursPerWeek": 4,
      "lecturer": null,
      "sourceText": "Engineering Chemistry / EBE1103 (W/S)"
    }
  ],
  "sessions": [
    {
      "targetKey": "part-1-semester-1",
      "courseCode": "EBE 1103",
      "courseName": "Engineering Chemistry",
      "weekday": 1,
      "weekdayLabel": "Monday",
      "startTime": "08:00",
      "endTime": "10:00",
      "venue": "W/S",
      "lecturer": null,
      "deliveryMode": null,
      "sourceText": "Engineering Chemistry / EBE1103 (W/S)"
    }
  ],
  "issues": []
}
```

Flat CSV/generic-XLSX aliases:

- `target_key`, `target`, `class`, `scope`
- `part`, `year_level`, `level`
- `semester`, `semester_number`, `period`
- `academic_year`, `year`
- `programme`, `department`, `academic_unit`
- `course_code`, `code`, `module_code`
- `course_name`, `name`, `title`, `module_name`
- `weekday`, `day`
- `start_time`, `start`, `from`
- `end_time`, `end`, `to`
- `venue`, `room`, `location`
- `lecturer`, `instructor`
- `delivery_mode`, `mode`

Rules:

- No CZW database IDs appear in user-facing templates.
- Institution remains the required Admin namespace.
- Optional operator context is stored as provenance. If it conflicts with source evidence, the import produces a blocker.
- AI output is input evidence only and never publication authority.
- Equivalent repeated uncertainties are grouped before review persistence.
- Missing lecturers are not blockers by themselves.
- Missing normalized venues are not blockers while `venueRaw` evidence exists.
- All imports remain draft-only until the existing guarded publication path is used.

## AI-to-XLSX workflow (recommended; prompt v2)

The importer remains `czw-import-format-v1`, but the button **Copy AI conversion prompt** now copies
`/templates/czw-timetable-ai-workbook-prompt-v2.md`. This version asks an external AI
to **return a real filled Excel workbook, not raw JSON**, because CZW already accepts
the XLSX template. Prompt revision v1 and classification-first v1.1 remain archived.

Operator flow:

1. Download the blank **CZW Timetable Import v1.xlsx** from the Admin page.
2. In a capable AI chat, attach **both** that actual workbook and the original
   timetable source (all relevant pages) and paste the copied prompt exactly once.
3. Check the resulting workbook's `Targets`, `Courses` and `Sessions` tabs.
   `Source` intentionally has only one metadata row; it is not the schedule.
4. Upload the returned XLSX to CZW, confirm canonical mappings and review
   exceptions; create drafts through the existing guarded flow. No auto-publish.

Workbook-required sheets (headers unchanged):

- `Source`: `version,title,institution,academic_unit,academic_year,semester_number`
- `Targets`: `target_key,title,academic_unit,year_level,semester_number,academic_year`
- `Courses`: `target_key,course_code,course_name,hours_per_week,lecturer`
- `Sessions`: `target_key,course_code,course_name,weekday,start_time,end_time,venue,lecturer,delivery_mode`

A fifth `Review Notes` sheet may contain human audit/uncertainty notes. **The existing
XLSX adapter does not ingest this notes sheet as a blocker**; operators must review
it before upload. The full AI-generated workbook is review evidence, not
publication authority.

The downloadable workbook now starts with empty Targets/Courses/Sessions rows
and a version-only Source row to prevent example data accidentally being imported.

**Limits:** no model can guarantee one-shot success when the source is unreadable,
the file-editing tool cannot export XLSX, or the timetable is fundamentally
ambiguous. This workflow reduces routine manual work while requiring explicit
failure/notes instead of hallucinated data. An exam timetable is not a recurring
class timetable and must not be converted into a weekly class schedule.
