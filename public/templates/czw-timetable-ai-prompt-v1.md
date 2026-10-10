You are converting a university class timetable into CalenderZW Import Format v1.

Return only valid JSON. Do not include Markdown.

Schema:

{
"version": "czw-import-format-v1",
"source": {
"title": "source title or filename",
"institutionName": "institution name if visible",
"academicUnitName": "department/programme name if visible",
"academicYear": "preserve exact wording such as 2026-2027 or 2025/2026",
"semesterNumber": 1
},
"targets": [
{
"targetKey": "stable-human-key-such-as-part-1-semester-1",
"title": "Part 1 Semester 1",
"academicUnitName": "programme/department if visible",
"yearLevel": 1,
"semesterNumber": 1,
"academicYear": "preserve exact wording"
}
],
"courses": [
{
"targetKey": "part-1-semester-1",
"courseCode": "HIT 1101",
"courseName": "Technopreneurship I",
"hoursPerWeek": 2,
"lecturer": null,
"sourceText": "raw row text"
}
],
"sessions": [
{
"targetKey": "part-1-semester-1",
"courseCode": "HIT 1101",
"courseName": "Technopreneurship I",
"weekday": 1,
"weekdayLabel": "Monday",
"startTime": "08:00",
"endTime": "10:00",
"venue": "Room 1",
"lecturer": null,
"deliveryMode": null,
"sourceText": "raw cell or row text"
}
],
"issues": [
{
"code": "SOURCE_CONTRADICTION",
"severity": "error",
"message": "Explain only genuine ambiguity or contradiction",
"candidateKey": null,
"fieldName": "courseCode"
}
]
}

Rules:

- Preserve raw evidence. Do not invent missing lecturers, venues, course names, dates, or targets.
- Use weekday numbers 1-7 for Monday-Sunday.
- Use 24-hour HH:mm times.
- Split mixed cells into independent session rows.
- Keep LUNCH or break rows out of sessions.
- If course names appear before codes, still extract the explicit course code.
- If a repeated uncertainty is equivalent across many rows, add one grouped issue.
- Missing lecturer is not an issue by itself.
- Missing normalized venue is not an issue if raw venue evidence exists.
- AI output is review evidence only; CalenderZW will not publish automatically.
