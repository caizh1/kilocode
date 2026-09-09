CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS corpus_import_batches (
  id text PRIMARY KEY,
  source text NOT NULL,
  jurisdiction text NOT NULL,
  data_type text NOT NULL,
  coverage_scope text NOT NULL DEFAULT 'supplemental',
  sequence_number bigint,
  period_start date,
  period_end date,
  source_filename text NOT NULL,
  source_sha256 text NOT NULL UNIQUE,
  source_size bigint NOT NULL,
  parser_version text NOT NULL,
  state text NOT NULL,
  declared_records bigint,
  discovered_records bigint NOT NULL DEFAULT 0,
  accepted_records bigint NOT NULL DEFAULT 0,
  rejected_records bigint NOT NULL DEFAULT 0,
  duplicate_records bigint NOT NULL DEFAULT 0,
  explicit_deletions bigint NOT NULL DEFAULT 0,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (source, jurisdiction, id)
);

ALTER TABLE corpus_import_batches
  ADD COLUMN IF NOT EXISTS coverage_scope text NOT NULL DEFAULT 'supplemental';

CREATE TABLE IF NOT EXISTS patent_documents (
  publication_number text PRIMARY KEY,
  jurisdiction text NOT NULL,
  active_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS patent_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_number text NOT NULL REFERENCES patent_documents(publication_number),
  application_number text,
  jurisdiction text NOT NULL,
  kind_code text,
  language text,
  title text,
  abstract_text text,
  description_text text,
  filing_date date,
  priority_date date,
  publication_date date NOT NULL,
  family_id text,
  family_source text,
  legal_status text,
  legal_status_date date,
  applicants jsonb NOT NULL DEFAULT '[]'::jsonb,
  inventors jsonb NOT NULL DEFAULT '[]'::jsonb,
  classifications jsonb NOT NULL DEFAULT '[]'::jsonb,
  priorities jsonb NOT NULL DEFAULT '[]'::jsonb,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  claims jsonb NOT NULL DEFAULT '[]'::jsonb,
  deleted boolean NOT NULL DEFAULT false,
  source_batch text NOT NULL REFERENCES corpus_import_batches(id),
  source_record_id text NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (publication_number, content_hash)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'patent_documents_active_version_id_fkey'
      AND conrelid = 'patent_documents'::regclass
  ) THEN
    ALTER TABLE patent_documents
      ADD CONSTRAINT patent_documents_active_version_id_fkey
      FOREIGN KEY (active_version_id) REFERENCES patent_document_versions(id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS patent_versions_batch_idx ON patent_document_versions(source_batch);
CREATE INDEX IF NOT EXISTS patent_versions_family_idx ON patent_document_versions(family_id);
CREATE INDEX IF NOT EXISTS patent_versions_publication_date_idx ON patent_document_versions(publication_date);

CREATE TABLE IF NOT EXISTS corpus_generations (
  id text PRIMARY KEY,
  index_name text NOT NULL UNIQUE,
  state text NOT NULL,
  document_count bigint NOT NULL,
  vector_count bigint NOT NULL DEFAULT 0,
  source_batch text REFERENCES corpus_import_batches(id),
  coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS corpus_single_active_generation_idx
  ON corpus_generations ((state)) WHERE state = 'ACTIVE';

CREATE TABLE IF NOT EXISTS corpus_integrity_events (
  id bigserial PRIMARY KEY,
  batch_id text REFERENCES corpus_import_batches(id),
  generation_id text REFERENCES corpus_generations(id),
  severity text NOT NULL,
  code text NOT NULL,
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS corpus_integrity_batch_idx ON corpus_integrity_events(batch_id, created_at);
