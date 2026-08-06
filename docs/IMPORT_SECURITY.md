# Import Security

The migration enables RLS on all new import tables and restricts source/import mutation to authenticated users whose JWT `app_metadata.role` is `admin` or `import_admin`.

The `timetable-sources` storage bucket is private, limited to PDF, DOCX, and CSV files, and capped at 50 MB. Source objects use the same import-admin policy.

The implementation avoids `user_metadata` for authorization because users can often influence those claims. Import review should continue to validate MIME type, file size, checksum, source status, and parser output before publication.
