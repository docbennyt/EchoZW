# CZW Import Format v1

`czw-import-format-v1` is the frozen CalenderZW ingestion MVP contract. Native adapters and AI-normalized sources must produce this evidence shape before the existing review and guarded draft workflow runs.

Supported source paths:

- CZW XLSX template, preferred for human or AI normalization.
- CZW JSON with the same schema.
- CSV flat session rows with documented aliases.
- Deterministic generic XLSX with the same flat aliases.
- Existing structured DOCX best effort.
- Searchable/text-layer PDF only when the text already contains deterministic tabular rows.

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
