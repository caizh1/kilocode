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
  {
    version: 6,
    name: "extension-market",
    sql: `
      CREATE TABLE extensions (
        id TEXT PRIMARY KEY,
        publisher TEXT NOT NULL,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL,
        categories_json TEXT NOT NULL DEFAULT '[]',
        keywords_json TEXT NOT NULL DEFAULT '[]',
        engine_vscode TEXT NOT NULL DEFAULT '*',
        latest_version TEXT NOT NULL,
        latest_artifact_id TEXT,
        icon_data TEXT,
        readme TEXT NOT NULL DEFAULT '',
        system_plugin INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'published',
        download_count INTEGER NOT NULL DEFAULT 0,
        favorite_count INTEGER NOT NULL DEFAULT 0,
        rating_total INTEGER NOT NULL DEFAULT 0,
        rating_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE extension_artifacts (
        id TEXT PRIMARY KEY,
        extension_id TEXT NOT NULL REFERENCES extensions(id),
        version TEXT NOT NULL,
        target TEXT NOT NULL,
        sha256 TEXT NOT NULL UNIQUE,
        size_bytes INTEGER NOT NULL,
        path TEXT NOT NULL,
        filename TEXT NOT NULL,
        uploader_id TEXT REFERENCES users(id),
        uploader_name TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        prerelease INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'published',
        download_count INTEGER NOT NULL DEFAULT 0,
        published_at TEXT NOT NULL,
        removed_at TEXT,
        removed_by TEXT,
        removal_reason TEXT,
        UNIQUE(extension_id, version, target, sha256)
      );
      CREATE TABLE extension_sources (
        source_key TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES extension_artifacts(id),
        kind TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE extension_publication_runs (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id),
        artifact_id TEXT REFERENCES extension_artifacts(id),
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        filename TEXT NOT NULL,
        total_bytes INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT,
        error TEXT,
        idempotency_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(owner_id, idempotency_key)
      );
      CREATE TABLE extension_favorites (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        extension_id TEXT NOT NULL REFERENCES extensions(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY(user_id, extension_id)
      );
      CREATE TABLE extension_reviews (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        extension_id TEXT NOT NULL REFERENCES extensions(id) ON DELETE CASCADE,
        artifact_id TEXT REFERENCES extension_artifacts(id),
        rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
        comment TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(user_id, extension_id)
      );
      CREATE TABLE extension_download_events (
        id TEXT PRIMARY KEY,
        extension_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        source TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );
      CREATE TABLE extension_daily_metrics (
        date TEXT NOT NULL,
        metric TEXT NOT NULL,
        extension_id TEXT NOT NULL DEFAULT '',
        artifact_id TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        count INTEGER NOT NULL,
        PRIMARY KEY(date, metric, extension_id, artifact_id, source)
      );
      CREATE TABLE extension_audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        action TEXT NOT NULL,
        extension_id TEXT,
        artifact_id TEXT,
        details_json TEXT NOT NULL DEFAULT '{}',
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX idx_extensions_rank ON extensions(status, download_count DESC, updated_at DESC);
      CREATE INDEX idx_extension_artifacts_lookup ON extension_artifacts(extension_id, version, target, status);
      CREATE INDEX idx_extension_artifacts_uploader ON extension_artifacts(uploader_id, published_at DESC);
      CREATE INDEX idx_extension_sources_artifact ON extension_sources(artifact_id, active);
      CREATE INDEX idx_extension_publications_owner ON extension_publication_runs(owner_id, created_at DESC);
      CREATE INDEX idx_extension_downloads_time ON extension_download_events(occurred_at);
      CREATE TRIGGER extension_favorite_insert AFTER INSERT ON extension_favorites BEGIN
        UPDATE extensions SET favorite_count = favorite_count + 1 WHERE id = new.extension_id;
      END;
      CREATE TRIGGER extension_favorite_delete AFTER DELETE ON extension_favorites BEGIN
        UPDATE extensions SET favorite_count = MAX(0, favorite_count - 1) WHERE id = old.extension_id;
      END;
      CREATE TRIGGER extension_review_insert AFTER INSERT ON extension_reviews BEGIN
        UPDATE extensions
        SET rating_total = rating_total + new.rating, rating_count = rating_count + 1
        WHERE id = new.extension_id;
      END;
      CREATE TRIGGER extension_review_update AFTER UPDATE OF rating ON extension_reviews BEGIN
        UPDATE extensions SET rating_total = rating_total - old.rating + new.rating WHERE id = new.extension_id;
      END;
      CREATE TRIGGER extension_review_delete AFTER DELETE ON extension_reviews BEGIN
        UPDATE extensions
        SET rating_total = MAX(0, rating_total - old.rating), rating_count = MAX(0, rating_count - 1)
        WHERE id = old.extension_id;
      END;
    `,
  },
  {
    version: 7,
    name: "publication-precise-undo",
    sql: `
      ALTER TABLE publication_runs ADD COLUMN previous_status TEXT;
      ALTER TABLE publication_runs ADD COLUMN previous_revision INTEGER;
      ALTER TABLE publication_runs ADD COLUMN undone_at TEXT;
      CREATE TABLE publication_undos (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id),
        run_id TEXT NOT NULL REFERENCES publication_runs(id),
        idempotency_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(owner_id, idempotency_key)
      );
      CREATE INDEX idx_publication_undos_run ON publication_undos(run_id);
    `,
  },
  {
    version: 8,
    name: "publication-request-aliases",
    sql: `
      CREATE TABLE publication_request_keys (
        owner_id TEXT NOT NULL REFERENCES users(id),
        idempotency_key TEXT NOT NULL,
        source_sha256 TEXT NOT NULL,
        run_id TEXT NOT NULL REFERENCES publication_runs(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY(owner_id, idempotency_key)
      );
      INSERT INTO publication_request_keys(owner_id,idempotency_key,source_sha256,run_id,created_at)
      SELECT owner_id,idempotency_key,source_sha256,id,created_at
      FROM publication_runs
      WHERE idempotency_key IS NOT NULL;
      CREATE INDEX idx_publication_request_run ON publication_request_keys(run_id);
    `,
  },
  {
    version: 9,
    name: "extension-publisher-ownership",
    sql: `
      ALTER TABLE extensions ADD COLUMN owner_id TEXT REFERENCES users(id);
      UPDATE extensions
      SET owner_id=(
        SELECT uploader_id FROM extension_artifacts
        WHERE extension_artifacts.extension_id=extensions.id
          AND uploader_id IS NOT NULL
        ORDER BY published_at ASC,id ASC LIMIT 1
      )
      WHERE EXISTS(
        SELECT 1 FROM extension_artifacts
        WHERE extension_artifacts.extension_id=extensions.id
          AND uploader_id IS NOT NULL
      );
      UPDATE extension_artifacts
      SET status='removed',removal_reason='owner-migration',removed_at=datetime('now'),removed_by='migration'
      WHERE uploader_id IS NOT NULL
        AND uploader_id<>(SELECT owner_id FROM extensions WHERE extensions.id=extension_artifacts.extension_id);
      CREATE INDEX idx_extensions_owner ON extensions(owner_id,updated_at DESC);
    `,
  },
]
