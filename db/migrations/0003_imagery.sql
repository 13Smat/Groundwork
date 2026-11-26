-- Imagery registry. Global public-program rows have workspace_id null and are
-- readable by every workspace. Tenant rows (drone uploads, later) stay private.
--
-- Read policy, on imagery_source and imagery_capture:
--   workspace_id is null
--   or workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
--
-- Write policies require a non-null workspace_id equal to the setting, so
-- groundwork_app cannot insert or change a global row. The migration role
-- (database owner, a superuser) writes the seeded global rows. ADR 0006.
--
-- There is no foreign key to workspace. That table is not in this slice.
-- created_at, updated_at, and created_by follow the spec 01 header. The SQL
-- sketch omits them. cog_key is an object key, never a URL.

create table imagery_source (
  id uuid primary key,
  workspace_id uuid,
  provider text not null check (provider in (
    'nc_ortho', 'nc_helene_2025', 'naip', 'county', 'nearmap', 'vexcel', 'drone_upload', 'other'
  )),
  name text not null,
  coverage geometry(MultiPolygon, 4326),
  capture_date date,
  gsd_cm numeric(6, 2),
  bands text not null,
  license_text text,
  license_url text,
  allows_tracing boolean not null default false,
  allows_ml_training boolean not null default false,
  attribution text,
  verified_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create index imagery_source_coverage_gix on imagery_source using gist (coverage);
create index imagery_source_workspace_id_idx on imagery_source (workspace_id);
create unique index imagery_source_global_name_key
  on imagery_source (name)
  where workspace_id is null;

create table imagery_capture (
  id uuid primary key,
  workspace_id uuid,
  source_id uuid not null references imagery_source (id),
  coverage geometry(MultiPolygon, 4326) not null,
  capture_date date not null,
  gsd_cm numeric(6, 2) not null,
  bands text not null,
  leaf text check (leaf in ('on', 'off', 'mixed', 'unknown')),
  cog_key text,
  status text not null check (status in ('ingesting', 'ready', 'failed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  constraint imagery_capture_cog_key_is_object_key check (
    cog_key is null
    or (
      cog_key ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*\.(tif|tiff)$'
      and cog_key !~ '\.\.'
    )
  )
);

create index imagery_capture_coverage_gix on imagery_capture using gist (coverage);
create index imagery_capture_workspace_id_idx on imagery_capture (workspace_id);
create index imagery_capture_source_id_idx on imagery_capture (source_id);

alter table imagery_source enable row level security;
alter table imagery_source force row level security;
alter table imagery_capture enable row level security;
alter table imagery_capture force row level security;

create policy imagery_source_read on imagery_source
  for select
  using (
    workspace_id is null
    or workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy imagery_source_insert on imagery_source
  for insert
  with check (
    workspace_id is not null
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy imagery_source_update on imagery_source
  for update
  using (
    workspace_id is not null
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  with check (
    workspace_id is not null
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy imagery_source_delete on imagery_source
  for delete
  using (
    workspace_id is not null
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy imagery_capture_read on imagery_capture
  for select
  using (
    workspace_id is null
    or workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy imagery_capture_insert on imagery_capture
  for insert
  with check (
    workspace_id is not null
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy imagery_capture_update on imagery_capture
  for update
  using (
    workspace_id is not null
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  with check (
    workspace_id is not null
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy imagery_capture_delete on imagery_capture
  for delete
  using (
    workspace_id is not null
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

grant select, insert, update, delete on imagery_source, imagery_capture to groundwork_app;

-- Seeded global rows. verified_at records the spec 04 license check on
-- 2026-11-25 for the three programs the spec allows. The blocked rows stay
-- unverified with allows_tracing false. Coverage rectangles are fixtures for
-- tests, not surveyed county boundaries. The fixture COG is synthetic.

insert into imagery_source (
  id, workspace_id, provider, name, coverage, capture_date, gsd_cm, bands,
  license_text, license_url, allows_tracing, allows_ml_training, attribution, verified_at, notes
) values
(
  '018f5a00-0000-7000-8000-000000000001',
  null,
  'nc_helene_2025',
  'nc_helene_2025',
  st_multi(st_makeenvelope(-84.4, 35.0, -80.8, 36.6, 4326)),
  date '2025-04-15',
  15.24,
  'RGBIR',
  'Helene 2025 item page licenseInfo "None" (attribution appreciated). NC Collaboratory at UNC Chapel Hill copyright. Checked 2026-11-25.',
  'https://services.nconemap.gov/secure/rest/services/Imagery/Orthoimagery_Helene_2025/ImageServer/info/iteminfo',
  true,
  true,
  'NC Collaboratory at UNC Chapel Hill',
  timestamptz '2026-11-25 00:00:00+00',
  'Spring 2025 leaf-off, 6-inch, 4-band. Seamline smears possible off major roads. Seed coverage is a western NC rectangle, not the official 13-county boundary.'
),
(
  '018f5a00-0000-7000-8000-000000000002',
  null,
  'nc_ortho',
  'nc_ortho',
  st_multi(st_makeenvelope(-84.32, 33.84, -75.46, 36.59, 4326)),
  date '2024-03-15',
  15.24,
  'RGBIR',
  'NC Orthoimagery Program, freely available per the program page. 6-inch 4-band tiles. Checked 2026-11-25. Do not stream the state services.',
  'https://www.nconemap.gov/pages/imagery',
  true,
  true,
  'NC Orthoimagery Program',
  timestamptz '2026-11-25 00:00:00+00',
  'Seed coverage is a North Carolina rectangle for tests.'
),
(
  '018f5a00-0000-7000-8000-000000000003',
  null,
  'naip',
  'naip',
  st_multi(st_makeenvelope(-125, 24, -66, 50, 4326)),
  date '2023-07-01',
  60.00,
  'RGBIR',
  'Public domain. Tracing and ML training allowed. Checked 2026-11-25.',
  'https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip',
  true,
  true,
  'USDA NAIP',
  timestamptz '2026-11-25 00:00:00+00',
  'Coarser leaf-on fallback. Seed coverage is a CONUS rectangle.'
),
(
  '018f5a00-0000-7000-8000-000000000004',
  null,
  'other',
  'nc_ortho_latest_viewing',
  st_multi(st_makeenvelope(-84.4, 35.0, -80.8, 36.6, 4326)),
  null,
  null,
  'RGB',
  'Orthoimagery_Latest is 3-band JPEG, marked for viewing, not raster analysis. Do not measure or train on it.',
  'https://services.nconemap.gov/secure/rest/services/Imagery/Orthoimagery_Latest/ImageServer',
  false,
  false,
  null,
  null,
  'Blocked. provider is other because the spec 01 check list has no value for this viewing service. The name is the registry key.'
),
(
  '018f5a00-0000-7000-8000-000000000005',
  null,
  'other',
  'google_satellite',
  st_multi(st_makeenvelope(-84.4, 35.0, -80.8, 36.6, 4326)),
  null,
  null,
  'RGB',
  'Google Maps Platform Terms 3.2.3(c): no tracing or digitizing from the satellite base map, and no using the content to train models.',
  'https://cloud.google.com/maps-platform/terms',
  false,
  false,
  null,
  null,
  'Blocked. Never stream Google Maps Platform satellite.'
),
(
  '018f5a00-0000-7000-8000-000000000006',
  null,
  'other',
  'mapbox_satellite',
  st_multi(st_makeenvelope(-84.4, 35.0, -80.8, 36.6, 4326)),
  null,
  null,
  'RGB',
  'Mapbox Satellite is not usable for measurement without a Commercial Satellite license.',
  'https://docs.mapbox.com/data/tilesets/guides/imagery/',
  false,
  false,
  null,
  null,
  'Blocked. Never stream Mapbox Satellite.'
),
(
  '018f5a00-0000-7000-8000-000000000007',
  null,
  'other',
  'fixture_rgbir',
  st_multi(st_makeenvelope(-81.705322265625, 35.746512259919, -81.699829101563, 35.750970439450, 4326)),
  date '2026-01-15',
  193.86,
  'RGBIR',
  'Synthetic 4-band RGBIR chip for local and CI. Not a public imagery program and not downloaded from a state service.',
  null,
  true,
  false,
  'Synthetic fixture',
  timestamptz '2026-11-25 00:00:00+00',
  'WebMercatorQuad z=16 x=17894 y=25791 over Burke County. NIR is band 4. Map tiles use RGB.'
);

insert into imagery_capture (
  id, workspace_id, source_id, coverage, capture_date, gsd_cm, bands, leaf, cog_key, status, notes
) values
(
  '018f5a00-0000-7000-8000-000000000101',
  null,
  '018f5a00-0000-7000-8000-000000000001',
  st_multi(st_makeenvelope(-84.4, 35.0, -80.8, 36.6, 4326)),
  date '2025-04-15',
  15.24,
  'RGBIR',
  'off',
  null,
  'ready',
  'Seamline smears possible off major roads. No statewide COG in this slice.'
),
(
  '018f5a00-0000-7000-8000-000000000102',
  null,
  '018f5a00-0000-7000-8000-000000000002',
  st_multi(st_makeenvelope(-84.32, 33.84, -75.46, 36.59, 4326)),
  date '2024-03-15',
  15.24,
  'RGBIR',
  'mixed',
  null,
  'ready',
  'Newer NC ortho cycle in the seed. No COG until ingest.'
),
(
  '018f5a00-0000-7000-8000-000000000103',
  null,
  '018f5a00-0000-7000-8000-000000000002',
  st_multi(st_makeenvelope(-84.32, 33.84, -75.46, 36.59, 4326)),
  date '2022-03-15',
  15.24,
  'RGBIR',
  'off',
  null,
  'ready',
  'Older NC ortho cycle. Listed after the newer cycle.'
),
(
  '018f5a00-0000-7000-8000-000000000104',
  null,
  '018f5a00-0000-7000-8000-000000000003',
  st_multi(st_makeenvelope(-125, 24, -66, 50, 4326)),
  date '2023-07-01',
  60.00,
  'RGBIR',
  'on',
  null,
  'ready',
  'NAIP fallback. Lower resolution, leaf-on.'
),
(
  '018f5a00-0000-7000-8000-000000000105',
  null,
  '018f5a00-0000-7000-8000-000000000004',
  st_multi(st_makeenvelope(-84.4, 35.0, -80.8, 36.6, 4326)),
  date '2024-01-01',
  15.24,
  'RGB',
  'unknown',
  'imagery/fixtures/rgbir-cog.tif',
  'ready',
  'Blocked viewing service. The object key points at the fixture so a skipped guard would still render pixels.'
),
(
  '018f5a00-0000-7000-8000-000000000106',
  null,
  '018f5a00-0000-7000-8000-000000000005',
  st_multi(st_makeenvelope(-84.4, 35.0, -80.8, 36.6, 4326)),
  date '2024-01-01',
  15.24,
  'RGB',
  'unknown',
  'imagery/fixtures/rgbir-cog.tif',
  'ready',
  'Blocked Google satellite row. The tile route must return 403 and must not call Google.'
),
(
  '018f5a00-0000-7000-8000-000000000107',
  null,
  '018f5a00-0000-7000-8000-000000000006',
  st_multi(st_makeenvelope(-84.4, 35.0, -80.8, 36.6, 4326)),
  date '2024-01-01',
  15.24,
  'RGB',
  'unknown',
  'imagery/fixtures/rgbir-cog.tif',
  'ready',
  'Blocked Mapbox satellite row.'
),
(
  '018f5a00-0000-7000-8000-000000000108',
  null,
  '018f5a00-0000-7000-8000-000000000007',
  st_multi(st_makeenvelope(-81.705322265625, 35.746512259919, -81.699829101563, 35.750970439450, 4326)),
  date '2026-01-15',
  193.86,
  'RGBIR',
  'unknown',
  'imagery/fixtures/rgbir-cog.tif',
  'ready',
  'Synthetic fixture chip. Loaded into object storage by the test helper. Not a live NC OneMap pull.'
);
