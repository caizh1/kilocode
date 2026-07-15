export interface Migration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "market-core",
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        idle_expires_at TEXT NOT NULL,
        absolute_expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        author_id TEXT NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'published',
        latest_revision INTEGER NOT NULL DEFAULT 0,
        download_count INTEGER NOT NULL DEFAULT 0,
        favorite_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE releases (
        skill_id TEXT NOT NULL REFERENCES skills(id),
        revision INTEGER NOT NULL,
        semver TEXT,
        sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        notes TEXT,
        validation_report_json TEXT NOT NULL,
        archive_path TEXT NOT NULL,
        published_at TEXT NOT NULL,
        PRIMARY KEY(skill_id, revision),
        UNIQUE(skill_id, sha256)
      );
      CREATE TABLE assets (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        type TEXT NOT NULL,
        mime TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        path TEXT NOT NULL,
        FOREIGN KEY(skill_id, revision) REFERENCES releases(skill_id, revision)
      );
      CREATE TABLE favorites (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY(user_id, skill_id)
      );
      CREATE TABLE installations (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL,
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        scope TEXT NOT NULL,
        workspace_id TEXT NOT NULL DEFAULT '',
        revision INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        status TEXT NOT NULL,
        changed_at TEXT NOT NULL,
        PRIMARY KEY(user_id, client_id, skill_id, scope, workspace_id)
      );
      CREATE TABLE publication_runs (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id),
        skill_id TEXT REFERENCES skills(id),
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        snapshot_path TEXT NOT NULL,
        snapshot_sha256 TEXT NOT NULL,
        report_json TEXT,
        result_revision INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE validation_issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES publication_runs(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        severity TEXT NOT NULL,
        file TEXT,
        line INTEGER,
        field TEXT,
        message TEXT NOT NULL,
        expected TEXT,
        actual TEXT,
        fixable INTEGER NOT NULL,
        repair_kind TEXT NOT NULL
      );
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        surface TEXT NOT NULL,
        user_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        skill_id TEXT,
        revision INTEGER,
        occurred_at TEXT NOT NULL,
        context_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE daily_metrics (
        date TEXT NOT NULL,
        event_name TEXT NOT NULL,
        skill_id TEXT NOT NULL DEFAULT '',
        count INTEGER NOT NULL,
        PRIMARY KEY(date, event_name, skill_id)
      );
      CREATE TABLE audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        action TEXT NOT NULL,
        skill_id TEXT,
        revision INTEGER,
        details_json TEXT NOT NULL DEFAULT '{}',
        occurred_at TEXT NOT NULL
      );
      CREATE TABLE imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_root TEXT NOT NULL,
        source_sha256 TEXT NOT NULL,
        item_count INTEGER NOT NULL,
        imported_at TEXT NOT NULL,
        UNIQUE(source_root, source_sha256)
      );
      CREATE INDEX idx_skills_category_updated ON skills(category, updated_at DESC);
      CREATE INDEX idx_skills_author_updated ON skills(author_id, updated_at DESC);
      CREATE INDEX idx_releases_sha ON releases(sha256);
      CREATE INDEX idx_installations_user ON installations(user_id, changed_at DESC);
      CREATE INDEX idx_events_time ON events(occurred_at);
      CREATE INDEX idx_events_skill_time ON events(skill_id, occurred_at);
    `,
  },
  {
    version: 2,
    name: "market-search-and-invariants",
    sql: `
      CREATE VIRTUAL TABLE skill_search USING fts5(
        id UNINDEXED,
        name,
        description,
        category,
        tags,
        author,
        tokenize = 'unicode61'
      );
      CREATE TRIGGER skills_search_insert AFTER INSERT ON skills BEGIN
        INSERT INTO skill_search(id, name, description, category, tags, author)
        SELECT new.id, new.name, new.description, new.category, new.tags_json, users.display_name
        FROM users WHERE users.id = new.author_id;
      END;
      CREATE TRIGGER skills_search_update AFTER UPDATE OF name, description, category, tags_json, author_id ON skills BEGIN
        DELETE FROM skill_search WHERE id = old.id;
        INSERT INTO skill_search(id, name, description, category, tags, author)
        SELECT new.id, new.name, new.description, new.category, new.tags_json, users.display_name
        FROM users WHERE users.id = new.author_id;
      END;
      CREATE TRIGGER skills_search_delete AFTER DELETE ON skills BEGIN
        DELETE FROM skill_search WHERE id = old.id;
      END;
      CREATE TRIGGER favorites_count_insert AFTER INSERT ON favorites BEGIN
        UPDATE skills SET favorite_count = favorite_count + 1 WHERE id = new.skill_id;
      END;
      CREATE TRIGGER favorites_count_delete AFTER DELETE ON favorites BEGIN
        UPDATE skills SET favorite_count = MAX(0, favorite_count - 1) WHERE id = old.skill_id;
      END;
      CREATE TRIGGER releases_immutable_update BEFORE UPDATE ON releases BEGIN
        SELECT RAISE(ABORT, 'releases are immutable');
      END;
      CREATE TRIGGER releases_immutable_delete BEFORE DELETE ON releases BEGIN
        SELECT RAISE(ABORT, 'releases are immutable');
      END;
    `,
  },
  {
    version: 3,
    name: "legacy-lossless-metadata",
    sql: `
      ALTER TABLE skills ADD COLUMN legacy_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE releases ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
    `,
  },
  {
    version: 4,
    name: "identity-and-install-intents",
    sql: `
      ALTER TABLE sessions ADD COLUMN csrf_hash TEXT NOT NULL DEFAULT '';
      CREATE TABLE install_intents (
        hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(skill_id, revision) REFERENCES releases(skill_id, revision)
      );
      CREATE INDEX idx_install_intents_expiry ON install_intents(expires_at);
    `,
  },
  {
    version: 5,
    name: "publication-idempotency-and-patches",
    sql: `
      ALTER TABLE publication_runs ADD COLUMN idempotency_key TEXT;
      ALTER TABLE publication_runs ADD COLUMN source_sha256 TEXT NOT NULL DEFAULT '';
      ALTER TABLE publication_runs ADD COLUMN patches_json TEXT NOT NULL DEFAULT '[]';
      CREATE UNIQUE INDEX idx_publication_owner_idempotency ON publication_runs(owner_id, idempotency_key);
    `,
  },
]
