-- DR-161: advisor fixes for multi-target static import tables.

create index if not exists import_candidate_targets_import_target_idx
  on public.import_candidate_targets (import_target_id);

create index if not exists import_targets_matched_academic_unit_idx
  on public.import_targets (matched_academic_unit_id)
  where matched_academic_unit_id is not null;

create index if not exists import_targets_matched_programme_idx
  on public.import_targets (matched_programme_id)
  where matched_programme_id is not null;

create index if not exists import_targets_matched_cohort_idx
  on public.import_targets (matched_cohort_id)
  where matched_cohort_id is not null;

create index if not exists import_targets_matched_academic_period_idx
  on public.import_targets (matched_academic_period_id)
  where matched_academic_period_id is not null;

drop policy if exists "import admins manage import targets" on public.import_targets;
create policy "import admins manage import targets"
  on public.import_targets for all
  to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'))
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'));

drop policy if exists "import admins manage import candidate targets" on public.import_candidate_targets;
create policy "import admins manage import candidate targets"
  on public.import_candidate_targets for all
  to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'))
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'));
