"""
init_pg.py — PostgreSQL schema initialisation + seed data
Replaces the SQLite db/init.py for the PostgreSQL migration.

Usage:
    Call init_db() once on application startup (idempotent — safe to re-run).
    Call _ensure_current_week_reports() on every dashboard request (same as before).
"""

from datetime import date, timedelta
from .session import get_db
from ..core.config import LLM_BASE_URL, LLM_MODEL, LLM_TIMEOUT_SECONDS, sunday_of_week

REPORT_BACKFILL_START = date(2025, 4, 1)


def _first_sunday_on_or_after(d: date) -> date:
    days_until_sunday = (6 - d.weekday()) % 7
    return d + timedelta(days=days_until_sunday)


def _ensure_current_week_reports():
    """Auto-create draft reports for every active user from April 2025 through the current week."""
    today = date.today()
    current_week_start = sunday_of_week(today)
    start_week = _first_sunday_on_or_after(REPORT_BACKFILL_START)

    with get_db() as conn:
        users = conn.execute("SELECT id FROM users WHERE is_deleted = FALSE").fetchall()
        week_start = start_week
        while week_start <= current_week_start:
            week_start_str = week_start.isoformat()
            iso = week_start.isocalendar()
            year, week_number = iso[0], iso[1]
            for u in users:
                uid = u["id"]
                exists = conn.execute(
                    "SELECT id FROM reports WHERE owner_id = %s AND week_start = %s",
                    (uid, week_start_str),
                ).fetchone()
                if not exists:
                    conn.execute(
                        """INSERT INTO reports
                               (owner_id, week_start, year, week_number,
                                status_id, visibility, created_by, updated_by)
                           VALUES (%s, %s, %s, %s, 1, 'team', %s, %s)
                           ON CONFLICT (owner_id, week_start) DO NOTHING""",
                        (uid, week_start_str, year, week_number, uid, uid),
                    )
            week_start += timedelta(days=7)


# ─────────────────────────────────────────────────────────────────────────────
#  Trigger function bodies (PL/pgSQL)
# ─────────────────────────────────────────────────────────────────────────────

_TRIGGER_FUNCTIONS = """

-- Generic updated_at setter — reused by all timestamp triggers
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- ── report_projects: recalculate report_summaries + log risk + update FTS ──

CREATE OR REPLACE FUNCTION fn_summary_on_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO report_summaries
           (report_id, total_projects, risk_count, blocker_count, avg_completion, generated_at)
    SELECT  NEW.report_id,
            COUNT(*),
            COALESCE(SUM(CASE WHEN risk_level = 'risk'    THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN risk_level = 'blocker' THEN 1 ELSE 0 END), 0),
            COALESCE(AVG(completion_pct)::INTEGER, 0),
            NOW()
    FROM report_projects
    WHERE report_id = NEW.report_id
    ON CONFLICT (report_id) DO UPDATE SET
        total_projects = EXCLUDED.total_projects,
        risk_count     = EXCLUDED.risk_count,
        blocker_count  = EXCLUDED.blocker_count,
        avg_completion = EXCLUDED.avg_completion,
        generated_at   = EXCLUDED.generated_at;

    INSERT INTO project_risk_log (project_id, report_id, week_start, risk_level)
    SELECT NEW.project_id, NEW.report_id, r.week_start, NEW.risk_level
    FROM reports r
    WHERE r.id = NEW.report_id;

    IF NEW.remarks IS NOT NULL AND TRIM(NEW.remarks) != '' THEN
        INSERT INTO report_search (report_id, source_type, source_id, content)
        VALUES (NEW.report_id, 'remarks', NEW.id, NEW.remarks);
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_summary_on_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.risk_level    != NEW.risk_level
    OR OLD.completion_pct != NEW.completion_pct
    OR OLD.remarks IS DISTINCT FROM NEW.remarks THEN

        INSERT INTO report_summaries
               (report_id, total_projects, risk_count, blocker_count, avg_completion, generated_at)
        SELECT  NEW.report_id,
                COUNT(*),
                COALESCE(SUM(CASE WHEN risk_level = 'risk'    THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN risk_level = 'blocker' THEN 1 ELSE 0 END), 0),
                COALESCE(AVG(completion_pct)::INTEGER, 0),
                NOW()
        FROM report_projects
        WHERE report_id = NEW.report_id
        ON CONFLICT (report_id) DO UPDATE SET
            total_projects = EXCLUDED.total_projects,
            risk_count     = EXCLUDED.risk_count,
            blocker_count  = EXCLUDED.blocker_count,
            avg_completion = EXCLUDED.avg_completion,
            generated_at   = EXCLUDED.generated_at;
    END IF;

    IF OLD.risk_level != NEW.risk_level THEN
        INSERT INTO project_risk_log (project_id, report_id, week_start, risk_level)
        SELECT NEW.project_id, NEW.report_id, r.week_start, NEW.risk_level
        FROM reports r
        WHERE r.id = NEW.report_id;
    END IF;

    IF OLD.remarks IS DISTINCT FROM NEW.remarks THEN
        DELETE FROM report_search WHERE source_type = 'remarks' AND source_id = OLD.id;
        IF NEW.remarks IS NOT NULL AND TRIM(NEW.remarks) != '' THEN
            INSERT INTO report_search (report_id, source_type, source_id, content)
            VALUES (NEW.report_id, 'remarks', NEW.id, NEW.remarks);
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_summary_on_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO report_summaries
           (report_id, total_projects, risk_count, blocker_count, avg_completion, generated_at)
    SELECT  OLD.report_id,
            COUNT(*),
            COALESCE(SUM(CASE WHEN risk_level = 'risk'    THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN risk_level = 'blocker' THEN 1 ELSE 0 END), 0),
            COALESCE(AVG(completion_pct)::INTEGER, 0),
            NOW()
    FROM report_projects
    WHERE report_id = OLD.report_id
    ON CONFLICT (report_id) DO UPDATE SET
        total_projects = EXCLUDED.total_projects,
        risk_count     = EXCLUDED.risk_count,
        blocker_count  = EXCLUDED.blocker_count,
        avg_completion = EXCLUDED.avg_completion,
        generated_at   = EXCLUDED.generated_at;

    DELETE FROM report_search WHERE source_type = 'remarks' AND source_id = OLD.id;

    RETURN OLD;
END;
$$;

-- ── issue_item FTS sync ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_issue_item_search_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_report_id INTEGER;
    v_content   TEXT;
BEGIN
    SELECT rp.report_id INTO v_report_id
    FROM report_projects rp WHERE rp.id = NEW.report_project_id;

    v_content := TRIM(NEW.title || ' ' || COALESCE(NEW.status, '') || ' ' || COALESCE(NEW.details, ''));
    IF v_content != '' THEN
        INSERT INTO report_search (report_id, source_type, source_id, content)
        VALUES (v_report_id, 'issue_item', NEW.id, v_content);
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_issue_item_search_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_report_id INTEGER;
    v_content   TEXT;
BEGIN
    DELETE FROM report_search WHERE source_type = 'issue_item' AND source_id = OLD.id;

    SELECT rp.report_id INTO v_report_id
    FROM report_projects rp WHERE rp.id = NEW.report_project_id;

    v_content := TRIM(NEW.title || ' ' || COALESCE(NEW.status, '') || ' ' || COALESCE(NEW.details, ''));
    IF v_content != '' THEN
        INSERT INTO report_search (report_id, source_type, source_id, content)
        VALUES (v_report_id, 'issue_item', NEW.id, v_content);
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_issue_item_search_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM report_search WHERE source_type = 'issue_item' AND source_id = OLD.id;
    RETURN OLD;
END;
$$;

-- ── report_comments FTS sync ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_fts_comment_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.is_deleted = FALSE AND NEW.comment != '' THEN
        INSERT INTO report_search (report_id, source_type, source_id, content)
        VALUES (NEW.report_id, 'comment', NEW.id, NEW.comment);
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_fts_comment_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.comment IS DISTINCT FROM NEW.comment OR OLD.is_deleted != NEW.is_deleted THEN
        DELETE FROM report_search WHERE source_type = 'comment' AND source_id = OLD.id;
        IF NEW.is_deleted = FALSE AND NEW.comment != '' THEN
            INSERT INTO report_search (report_id, source_type, source_id, content)
            VALUES (NEW.report_id, 'comment', NEW.id, NEW.comment);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_fts_comment_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM report_search WHERE source_type = 'comment' AND source_id = OLD.id;
    RETURN OLD;
END;
$$;

-- ── comment_mentions → notifications ──────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_mention_notification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id)
    SELECT NEW.mentioned_user_id,
           'mention',
           u.name || ' mentioned you in a comment',
           rc.comment,
           'report',
           rc.report_id
    FROM report_comments rc
    JOIN users u ON u.id = rc.user_id
    WHERE rc.id = NEW.comment_id;
    RETURN NEW;
END;
$$;

"""

# ─────────────────────────────────────────────────────────────────────────────
#  DDL — tables, indexes, triggers
#  Each statement is executed individually (psycopg2 has no executescript).
# ─────────────────────────────────────────────────────────────────────────────

_DDL_STATEMENTS = [

    # ── Lookup tables ─────────────────────────────────────────────────────

    """CREATE TABLE IF NOT EXISTS ranks (
        id         SERIAL PRIMARY KEY,
        name       TEXT    NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0
    )""",

    """CREATE TABLE IF NOT EXISTS report_status (
        id         SERIAL PRIMARY KEY,
        name       TEXT    NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0
    )""",

    """CREATE TABLE IF NOT EXISTS schedule_type (
        id         SERIAL PRIMARY KEY,
        name       TEXT    NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0
    )""",

    # ── Org structure ──────────────────────────────────────────────────────

    """CREATE TABLE IF NOT EXISTS departments (
        id         SERIAL PRIMARY KEY,
        name       TEXT    NOT NULL UNIQUE,
        code       TEXT    UNIQUE,
        parent_id  INTEGER REFERENCES departments(id),
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE
    )""",

    # users forward-declared before teams (teams.manager_id → users.id)
    """CREATE TABLE IF NOT EXISTS users (
        id             SERIAL PRIMARY KEY,
        name           TEXT        NOT NULL,
        email          TEXT        NOT NULL UNIQUE,
        employee_id    TEXT        NOT NULL UNIQUE,
        password_hash  TEXT        NOT NULL DEFAULT '',
        rank_id        INTEGER     NOT NULL REFERENCES ranks(id),
        manager_id     INTEGER     REFERENCES users(id),
        phone          TEXT,
        locale         TEXT        NOT NULL DEFAULT 'ko' CHECK (locale IN ('ko','en')),
        is_admin       BOOLEAN     NOT NULL DEFAULT FALSE,
        is_deleted     BOOLEAN     NOT NULL DEFAULT FALSE,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by     INTEGER     REFERENCES users(id),
        updated_by     INTEGER     REFERENCES users(id),
        last_login_at  TIMESTAMPTZ
    )""",

    """CREATE TABLE IF NOT EXISTS teams (
        id             SERIAL PRIMARY KEY,
        name           TEXT        NOT NULL,
        department_id  INTEGER     NOT NULL REFERENCES departments(id),
        parent_team_id INTEGER     REFERENCES teams(id),
        manager_id     INTEGER     REFERENCES users(id),
        is_deleted     BOOLEAN     NOT NULL DEFAULT FALSE,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""",

    """CREATE TABLE IF NOT EXISTS user_team_roles (
        id           SERIAL PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
        team_id      INTEGER NOT NULL REFERENCES teams(id)  ON DELETE CASCADE,
        role         TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('lead','member','observer')),
        primary_team BOOLEAN NOT NULL DEFAULT FALSE,
        assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, team_id)
    )""",

    # ── Projects ───────────────────────────────────────────────────────────

    """CREATE TABLE IF NOT EXISTS projects (
        id               SERIAL PRIMARY KEY,
        project_name     TEXT    NOT NULL,
        wbs_number       TEXT,
        solution_product TEXT,
        department_id    INTEGER REFERENCES departments(id),
        company          TEXT    NOT NULL,
        location         TEXT    NOT NULL,
        status           TEXT    NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active','on_hold','completed','cancelled')),
        start_date       DATE,
        end_date         DATE,
        is_deleted       BOOLEAN     NOT NULL DEFAULT FALSE,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by       INTEGER REFERENCES users(id),
        updated_by       INTEGER REFERENCES users(id),
        CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
    )""",

    """CREATE TABLE IF NOT EXISTS project_assignments (
        id          SERIAL PRIMARY KEY,
        project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
        role        TEXT,
        assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (project_id, user_id)
    )""",

    """CREATE TABLE IF NOT EXISTS project_milestones (
        id           SERIAL PRIMARY KEY,
        project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title        TEXT    NOT NULL,
        planned_date DATE    NOT NULL,
        actual_date  DATE,
        status       TEXT    NOT NULL DEFAULT 'planned'
                         CHECK (status IN ('planned','done','delayed','cancelled')),
        is_deleted   BOOLEAN     NOT NULL DEFAULT FALSE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by   INTEGER REFERENCES users(id),
        updated_by   INTEGER REFERENCES users(id)
    )""",

    """CREATE TABLE IF NOT EXISTS project_issues (
        id         SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title      TEXT    NOT NULL,
        status     TEXT    NOT NULL DEFAULT 'Open',
        priority   TEXT    NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','critical')),
        start_date DATE    NOT NULL,
        end_date   DATE,
        details    TEXT,
        is_deleted BOOLEAN     NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by INTEGER REFERENCES users(id),
        updated_by INTEGER REFERENCES users(id),
        CHECK (end_date IS NULL OR end_date >= start_date)
    )""",

    """CREATE TABLE IF NOT EXISTS project_issue_progress (
        id         SERIAL PRIMARY KEY,
        issue_id   INTEGER NOT NULL REFERENCES project_issues(id) ON DELETE CASCADE,
        title      TEXT    NOT NULL,
        start_date DATE    NOT NULL,
        end_date   DATE,
        details    TEXT,
        is_deleted BOOLEAN     NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by INTEGER REFERENCES users(id),
        updated_by INTEGER REFERENCES users(id),
        CHECK (end_date IS NULL OR end_date >= start_date)
    )""",

    """CREATE TABLE IF NOT EXISTS project_dependencies (
        id            SERIAL PRIMARY KEY,
        project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        depends_on_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE (project_id, depends_on_id),
        CHECK (project_id != depends_on_id)
    )""",

    # ── Reports ────────────────────────────────────────────────────────────

    """CREATE TABLE IF NOT EXISTS reports (
        id              SERIAL PRIMARY KEY,
        owner_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        week_start      DATE    NOT NULL,
        year            INTEGER NOT NULL,
        week_number     INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 53),
        status_id       INTEGER NOT NULL DEFAULT 1 REFERENCES report_status(id),
        visibility      TEXT    NOT NULL DEFAULT 'team'
                            CHECK (visibility IN ('private','team','department','company')),
        is_locked       BOOLEAN     NOT NULL DEFAULT FALSE,
        manager_comment TEXT,
        submitted_at    TIMESTAMPTZ,
        approved_at     TIMESTAMPTZ,
        approved_by     INTEGER     REFERENCES users(id),
        is_deleted      BOOLEAN     NOT NULL DEFAULT FALSE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by      INTEGER REFERENCES users(id),
        updated_by      INTEGER REFERENCES users(id),
        UNIQUE (owner_id, week_start)
    )""",

    """CREATE TABLE IF NOT EXISTS report_projects (
        id                SERIAL PRIMARY KEY,
        report_id         INTEGER NOT NULL REFERENCES reports(id)  ON DELETE CASCADE,
        project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        schedule          TEXT,
        progress          TEXT,
        remarks           TEXT,
        risk_level        TEXT    NOT NULL DEFAULT 'normal'
                              CHECK (risk_level IN ('normal','risk','blocker')),
        completion_pct    INTEGER NOT NULL DEFAULT 0 CHECK (completion_pct BETWEEN 0 AND 100),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by        INTEGER REFERENCES users(id),
        updated_by        INTEGER REFERENCES users(id),
        UNIQUE (report_id, project_id)
    )""",

    """CREATE TABLE IF NOT EXISTS project_schedule (
        id                SERIAL PRIMARY KEY,
        report_project_id INTEGER NOT NULL REFERENCES report_projects(id) ON DELETE CASCADE,
        title             TEXT    NOT NULL,
        start_date        DATE    NOT NULL,
        end_date          DATE,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by        INTEGER REFERENCES users(id),
        updated_by        INTEGER REFERENCES users(id),
        CHECK (end_date IS NULL OR end_date >= start_date)
    )""",

    """CREATE TABLE IF NOT EXISTS issue_item (
        id                SERIAL PRIMARY KEY,
        report_project_id INTEGER NOT NULL REFERENCES report_projects(id) ON DELETE CASCADE,
        title             TEXT    NOT NULL,
        status            TEXT    NOT NULL,
        start_date        DATE    NOT NULL,
        end_date          DATE,
        details           TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by        INTEGER REFERENCES users(id),
        updated_by        INTEGER REFERENCES users(id),
        CHECK (end_date IS NULL OR end_date >= start_date)
    )""",

    """CREATE TABLE IF NOT EXISTS issue_progress (
        id             SERIAL PRIMARY KEY,
        issue_item_id  INTEGER NOT NULL REFERENCES issue_item(id) ON DELETE CASCADE,
        title          TEXT    NOT NULL,
        start_date     DATE    NOT NULL,
        end_date       DATE,
        details        TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (end_date IS NULL OR end_date >= start_date)
    )""",

    """CREATE TABLE IF NOT EXISTS report_summaries (
        id             SERIAL PRIMARY KEY,
        report_id      INTEGER NOT NULL UNIQUE REFERENCES reports(id) ON DELETE CASCADE,
        total_projects INTEGER NOT NULL DEFAULT 0,
        risk_count     INTEGER NOT NULL DEFAULT 0,
        blocker_count  INTEGER NOT NULL DEFAULT 0,
        avg_completion INTEGER NOT NULL DEFAULT 0,
        generated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""",

    """CREATE TABLE IF NOT EXISTS report_versions (
        id             SERIAL PRIMARY KEY,
        report_id      INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        snapshot_json  TEXT    NOT NULL,
        created_by     INTEGER REFERENCES users(id),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (report_id, version_number)
    )""",

    """CREATE TABLE IF NOT EXISTS report_approvals (
        id          SERIAL PRIMARY KEY,
        report_id   INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        approver_id INTEGER NOT NULL REFERENCES users(id),
        level       INTEGER NOT NULL,
        status      TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected')),
        comments    TEXT,
        action_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""",

    """CREATE TABLE IF NOT EXISTS report_metrics (
        id           SERIAL PRIMARY KEY,
        report_id    INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        metric_name  TEXT    NOT NULL,
        metric_value REAL    NOT NULL,
        metric_unit  TEXT,
        UNIQUE (report_id, metric_name)
    )""",

    """CREATE TABLE IF NOT EXISTS project_risk_log (
        id         SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        report_id  INTEGER NOT NULL REFERENCES reports(id)  ON DELETE CASCADE,
        week_start DATE    NOT NULL,
        risk_level TEXT    NOT NULL CHECK (risk_level IN ('normal','risk','blocker')),
        description TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""",

    # ── Collaboration ──────────────────────────────────────────────────────

    """CREATE TABLE IF NOT EXISTS report_comments (
        id                SERIAL PRIMARY KEY,
        report_id         INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        user_id           INTEGER NOT NULL REFERENCES users(id),
        parent_comment_id INTEGER     REFERENCES report_comments(id),
        comment           TEXT    NOT NULL,
        is_deleted        BOOLEAN     NOT NULL DEFAULT FALSE,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by        INTEGER REFERENCES users(id),
        updated_by        INTEGER REFERENCES users(id)
    )""",

    """CREATE TABLE IF NOT EXISTS comment_mentions (
        id                 SERIAL PRIMARY KEY,
        comment_id         INTEGER NOT NULL REFERENCES report_comments(id) ON DELETE CASCADE,
        mentioned_user_id  INTEGER NOT NULL REFERENCES users(id)           ON DELETE CASCADE,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (comment_id, mentioned_user_id)
    )""",

    """CREATE TABLE IF NOT EXISTS notifications (
        id             SERIAL PRIMARY KEY,
        user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type           TEXT    NOT NULL,
        title          TEXT    NOT NULL,
        message        TEXT,
        reference_type TEXT,
        reference_id   INTEGER,
        is_read        BOOLEAN     NOT NULL DEFAULT FALSE,
        is_deleted     BOOLEAN     NOT NULL DEFAULT FALSE,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""",

    """CREATE TABLE IF NOT EXISTS attachments (
        id          SERIAL PRIMARY KEY,
        report_id   INTEGER REFERENCES reports(id)         ON DELETE CASCADE,
        project_id  INTEGER REFERENCES projects(id)        ON DELETE CASCADE,
        comment_id  INTEGER REFERENCES report_comments(id) ON DELETE CASCADE,
        file_name   TEXT    NOT NULL,
        file_path   TEXT    NOT NULL UNIQUE,
        mime_type   TEXT,
        file_size   INTEGER,
        is_deleted  BOOLEAN     NOT NULL DEFAULT FALSE,
        uploaded_by INTEGER     REFERENCES users(id),
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        -- exactly one of report_id / project_id / comment_id must be set
        CHECK (
            (report_id  IS NOT NULL)::INT +
            (project_id IS NOT NULL)::INT +
            (comment_id IS NOT NULL)::INT = 1
        )
    )""",

    """CREATE TABLE IF NOT EXISTS tags (
        id   SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE
    )""",

    """CREATE TABLE IF NOT EXISTS entity_tags (
        id          SERIAL PRIMARY KEY,
        tag_id      INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
        entity_type TEXT    NOT NULL CHECK (entity_type IN ('report','project','comment')),
        entity_id   INTEGER NOT NULL,
        tagged_by   INTEGER REFERENCES users(id),
        tagged_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (tag_id, entity_type, entity_id)
    )""",

    """CREATE TABLE IF NOT EXISTS report_templates (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT    NOT NULL,
        is_default BOOLEAN     NOT NULL DEFAULT FALSE,
        is_deleted BOOLEAN     NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""",

    """CREATE TABLE IF NOT EXISTS report_template_items (
        id          SERIAL PRIMARY KEY,
        template_id INTEGER NOT NULL REFERENCES report_templates(id) ON DELETE CASCADE,
        project_id  INTEGER NOT NULL REFERENCES projects(id)         ON DELETE CASCADE,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        UNIQUE (template_id, project_id)
    )""",

    # ── System ─────────────────────────────────────────────────────────────

    """CREATE TABLE IF NOT EXISTS report_ai_insights (
        id           SERIAL PRIMARY KEY,
        report_id    INTEGER NOT NULL UNIQUE REFERENCES reports(id) ON DELETE CASCADE,
        summary      TEXT,
        risk_summary TEXT,
        model_used   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""",

    """CREATE TABLE IF NOT EXISTS llm_settings (
        id              INTEGER PRIMARY KEY CHECK (id = 1),
        base_url        TEXT    NOT NULL,
        model           TEXT    NOT NULL,
        timeout_seconds REAL    NOT NULL DEFAULT 90,
        system_prompt   TEXT    NOT NULL DEFAULT '',
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by      INTEGER REFERENCES users(id)
    )""",

    """CREATE TABLE IF NOT EXISTS personal_schedule (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type_id    INTEGER NOT NULL REFERENCES schedule_type(id),
        start_date DATE    NOT NULL,
        end_date   DATE    NOT NULL,
        location   TEXT,
        details    TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (end_date >= start_date)
    )""",

    """CREATE TABLE IF NOT EXISTS holidays (
        id           SERIAL PRIMARY KEY,
        date         DATE NOT NULL,
        description  TEXT,
        country_code TEXT NOT NULL DEFAULT 'KR',
        UNIQUE (date, country_code)
    )""",

    """CREATE TABLE IF NOT EXISTS audit_log (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER REFERENCES users(id),
        table_name TEXT    NOT NULL,
        record_id  INTEGER NOT NULL,
        action     TEXT    NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
        old_values TEXT,
        new_values TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""",

    # ── FTS table (replaces SQLite fts5 virtual table) ─────────────────────
    # search_vector is a generated tsvector kept in sync by triggers below.

    """CREATE TABLE IF NOT EXISTS report_search (
        id             SERIAL PRIMARY KEY,
        report_id      INTEGER NOT NULL,
        source_type    TEXT    NOT NULL,
        source_id      INTEGER NOT NULL,
        content        TEXT    NOT NULL,
        search_vector  TSVECTOR
    )""",

    # GIN index for fast full-text lookups
    """CREATE INDEX IF NOT EXISTS idx_report_search_fts
       ON report_search USING GIN(search_vector)""",

    # Trigger to auto-populate search_vector on insert/update
    """CREATE OR REPLACE FUNCTION fn_report_search_vector()
       RETURNS TRIGGER LANGUAGE plpgsql AS $$
       BEGIN
           NEW.search_vector := to_tsvector('simple', COALESCE(NEW.content, ''));
           RETURN NEW;
       END;
       $$""",

    """DO $$ BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_trigger WHERE tgname = 'trg_report_search_vector'
        ) THEN
            CREATE TRIGGER trg_report_search_vector
            BEFORE INSERT OR UPDATE ON report_search
            FOR EACH ROW EXECUTE FUNCTION fn_report_search_vector();
        END IF;
    END $$""",

    # ── Indexes ────────────────────────────────────────────────────────────

    "CREATE INDEX IF NOT EXISTS idx_reports_owner_week    ON reports(owner_id, week_start)",
    "CREATE INDEX IF NOT EXISTS idx_reports_week          ON reports(week_start)",
    "CREATE INDEX IF NOT EXISTS idx_reports_status        ON reports(status_id)",
    "CREATE INDEX IF NOT EXISTS idx_reports_year_week     ON reports(year, week_number)",
    "CREATE INDEX IF NOT EXISTS idx_rp_report             ON report_projects(report_id)",
    "CREATE INDEX IF NOT EXISTS idx_rp_project            ON report_projects(project_id)",
    "CREATE INDEX IF NOT EXISTS idx_project_schedule_rp   ON project_schedule(report_project_id, start_date)",
    "CREATE INDEX IF NOT EXISTS idx_issue_item_rp         ON issue_item(report_project_id, start_date)",
    "CREATE INDEX IF NOT EXISTS idx_issue_progress_issue  ON issue_progress(issue_item_id, start_date)",
    "CREATE INDEX IF NOT EXISTS idx_rc_report             ON report_comments(report_id)",
    "CREATE INDEX IF NOT EXISTS idx_notif_user_read       ON notifications(user_id, is_read)",
    "CREATE INDEX IF NOT EXISTS idx_notif_user_time       ON notifications(user_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_projects_status       ON projects(status)",
    "CREATE INDEX IF NOT EXISTS idx_utr_user              ON user_team_roles(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_proj_milestones       ON project_milestones(project_id, planned_date)",
    "CREATE INDEX IF NOT EXISTS idx_proj_issues           ON project_issues(project_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_proj_issue_progress   ON project_issue_progress(issue_id, start_date)",

    # ── Triggers — updated_at (one shared function, attached to each table) ─

    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_updated') THEN
            CREATE TRIGGER trg_users_updated
            BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
        END IF;
    END $$""",

    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_projects_updated') THEN
            CREATE TRIGGER trg_projects_updated
            BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
        END IF;
    END $$""",

    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_reports_updated') THEN
            CREATE TRIGGER trg_reports_updated
            BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
        END IF;
    END $$""",

    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_report_projects_updated') THEN
            CREATE TRIGGER trg_report_projects_updated
            BEFORE UPDATE ON report_projects FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
        END IF;
    END $$""",

    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_project_schedule_updated') THEN
            CREATE TRIGGER trg_project_schedule_updated
            BEFORE UPDATE ON project_schedule FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
        END IF;
    END $$""",

    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_issue_item_updated') THEN
            CREATE TRIGGER trg_issue_item_updated
            BEFORE UPDATE ON issue_item FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
        END IF;
    END $$""",

    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_issue_progress_updated') THEN
            CREATE TRIGGER trg_issue_progress_updated
            BEFORE UPDATE ON issue_progress FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
        END IF;
    END $$""",

    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_report_comments_updated') THEN
            CREATE TRIGGER trg_report_comments_updated
            BEFORE UPDATE ON report_comments FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
        END IF;
    END $$""",

    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_report_ai_insights_updated') THEN
            CREATE TRIGGER trg_report_ai_insights_updated
            BEFORE UPDATE ON report_ai_insights FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
        END IF;
    END $$""",

    # ── Triggers — report_projects summary + FTS ───────────────────────────

    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_summary_on_insert') THEN
            CREATE TRIGGER trg_summary_on_insert
            AFTER INSERT ON report_projects
            FOR EACH ROW EXECUTE FUNCTION fn_summary_on_insert();
        END IF;
    END $$""",

    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_summary_on_update') THEN
            CREATE TRIGGER trg_summary_on_update
            AFTER UPDATE ON report_projects
            FOR EACH ROW EXECUTE FUNCTION fn_summary_on_update();
        END IF;
    END $$""",

    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_summary_on_delete') THEN
            CREATE TRIGGER trg_summary_on_delete
            AFTER DELETE ON report_projects
            FOR EACH ROW EXECUTE FUNCTION fn_summary_on_delete();
        END IF;
    END $$""",

    # ── Triggers — issue_item FTS ──────────────────────────────────────────

    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_issue_item_search_insert') THEN
            CREATE TRIGGER trg_issue_item_search_insert
            AFTER INSERT ON issue_item
            FOR EACH ROW EXECUTE FUNCTION fn_issue_item_search_insert();
        END IF;
    END $$""",

    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_issue_item_search_update') THEN
            CREATE TRIGGER trg_issue_item_search_update
            AFTER UPDATE ON issue_item
            FOR EACH ROW EXECUTE FUNCTION fn_issue_item_search_update();
        END IF;
    END $$""",

    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_issue_item_search_delete') THEN
            CREATE TRIGGER trg_issue_item_search_delete
            AFTER DELETE ON issue_item
            FOR EACH ROW EXECUTE FUNCTION fn_issue_item_search_delete();
        END IF;
    END $$""",

    # ── Triggers — report_comments FTS ────────────────────────────────────

    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_fts_comment_insert') THEN
            CREATE TRIGGER trg_fts_comment_insert
            AFTER INSERT ON report_comments
            FOR EACH ROW EXECUTE FUNCTION fn_fts_comment_insert();
        END IF;
    END $$""",

    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_fts_comment_update') THEN
            CREATE TRIGGER trg_fts_comment_update
            AFTER UPDATE ON report_comments
            FOR EACH ROW EXECUTE FUNCTION fn_fts_comment_update();
        END IF;
    END $$""",

    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_fts_comment_delete') THEN
            CREATE TRIGGER trg_fts_comment_delete
            AFTER DELETE ON report_comments
            FOR EACH ROW EXECUTE FUNCTION fn_fts_comment_delete();
        END IF;
    END $$""",

    # ── Trigger — mention → notification ──────────────────────────────────

    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mention_notification') THEN
            CREATE TRIGGER trg_mention_notification
            AFTER INSERT ON comment_mentions
            FOR EACH ROW EXECUTE FUNCTION fn_mention_notification();
        END IF;
    END $$""",
]


# ─────────────────────────────────────────────────────────────────────────────
#  Seed helpers
# ─────────────────────────────────────────────────────────────────────────────

def _count(conn, table: str) -> int:
    return conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]


def _seed(conn, llm_base_url: str, llm_model: str, llm_timeout: float) -> None:
    """Insert reference data only when tables are empty — idempotent."""

    if _count(conn, "ranks") == 0:
        conn.executemany(
            "INSERT INTO ranks(name, sort_order) VALUES(%s, %s)",
            [("사원",1), ("대리",2), ("과장",3), ("차장",4), ("부장",5), ("부서장",6)],
        )

    if _count(conn, "report_status") == 0:
        conn.executemany(
            "INSERT INTO report_status(name, sort_order) VALUES(%s, %s)",
            [("초안",1), ("제출",2), ("승인",3), ("반려",4)],
        )

    if _count(conn, "schedule_type") == 0:
        conn.executemany(
            "INSERT INTO schedule_type(name, sort_order) VALUES(%s, %s)",
            [("출장 (해외)",1), ("출장 (국내)",2), ("외근",3), ("휴가",4), ("휴일 출근",5)],
        )

    if _count(conn, "departments") == 0:
        conn.execute(
            "INSERT INTO departments(id, name, code) VALUES(1, %s, %s)",
            ("Advanced Solution Engineering Department", "Adv.Sol.ENG.Dept"),
        )
        # Keep the sequence in sync after explicit-id insert
        conn.execute("SELECT setval('departments_id_seq', (SELECT MAX(id) FROM departments))")

    if _count(conn, "llm_settings") == 0:
        system_prompt = (
            "You are an assistant that writes concise Korean weekly project summaries "
            "for an internal report. Compare the current week against the previous week, "
            "focus on issue movement, meaningful progress, newly added work, and items "
            "that still need attention. When you mention a current-week issue, use its "
            "exact issue title verbatim so the UI can link it. "
            'Return only valid JSON with this exact shape: '
            '{"summary":"2-4 sentence Korean summary",'
            '"highlights":["bullet 1","bullet 2","bullet 3"]}.'
        )
        conn.execute(
            """INSERT INTO llm_settings(id, base_url, model, timeout_seconds, system_prompt)
               VALUES(1, %s, %s, %s, %s)""",
            (llm_base_url, llm_model, llm_timeout, system_prompt),
        )
    else:
        # Backfill blank system_prompt (same as original behaviour)
        system_prompt = (
            "You are an assistant that writes concise Korean weekly project summaries "
            "for an internal report. Compare the current week against the previous week, "
            "focus on issue movement, meaningful progress, newly added work, and items "
            "that still need attention. When you mention a current-week issue, use its "
            "exact issue title verbatim so the UI can link it. "
            'Return only valid JSON with this exact shape: '
            '{"summary":"2-4 sentence Korean summary",'
            '"highlights":["bullet 1","bullet 2","bullet 3"]}.'
        )
        conn.execute(
            """UPDATE llm_settings
               SET system_prompt = %s
               WHERE id = 1 AND (system_prompt IS NULL OR TRIM(system_prompt) = '')""",
            (system_prompt,),
        )

    if _count(conn, "users") == 0:
        from passlib.context import CryptContext
        pwd = CryptContext(schemes=["bcrypt"])
        h = pwd.hash("password123")
        conn.executemany(
            """INSERT INTO users(name, email, is_admin, employee_id, rank_id, locale, password_hash)
               VALUES(%s, %s, %s, %s, %s, 'ko', %s)""",
            [
                ("양우성", "woosung.yang@yokogawa.com",    False, "30004679", 5, h),
                ("김정년", "jeongnyeon.kim@yokogawa.com",  False, "30036413", 3, h),
                ("김민욱", "minwook.kim@yokogawa.com",     False, "30040640", 4, h),
                ("노덕기", "duckgee.noh@yokogawa.com",     False, "30041568", 4, h),
                ("유세훈", "sehun.yu@yokogawa.com",        False, "30046341", 3, h),
                ("김강년", "khangnyon.kim@yokogawa.com",   True,  "30049038", 2, h),
                ("김정은", "jeongeun.kim@yokogawa.com",    False, "30056725", 3, h),
                ("민준홍", "joonhong.min@yokogawa.com",    False, "30057537", 4, h),
                ("유혜빈", "hyebin.yoo@yokogawa.com",      False, "30059497", 1, h),
                ("오윤석", "yoonseok.oh@yokogawa.com",     False, "35001480", 3, h),
                ("박현민", "hyunmin.park@yokogawa.com",    False, "35003195", 2, h),
            ],
        )

    if _count(conn, "teams") == 0:
        def _uid(emp_id: str):
            row = conn.execute(
                "SELECT id FROM users WHERE employee_id = %s", (emp_id,)
            ).fetchone()
            return row["id"] if row else None

        exec_mgr     = _uid("30004679")   # 양우성 부장
        it_intel_mgr = _uid("30057537")   # 민준홍 차장
        it_digi_mgr  = _uid("30041568")   # 노덕기 차장
        sim_mgr      = _uid("30040640")   # 김민욱 차장
        opt_mgr      = _uid("30046341")   # 유세훈 과장

        for team_id, name, parent, mgr in [
            (1, "PJT Exec PT",          None, exec_mgr),
            (2, "IT-Intelligence PT",   1,    it_intel_mgr),
            (3, "IT-Digitalization PT", 1,    it_digi_mgr),
            (4, "P-Simulation PT",      1,    sim_mgr),
            (5, "P-Optimization PT",    1,    opt_mgr),
        ]:
            conn.execute(
                """INSERT INTO teams(id, name, department_id, parent_team_id, manager_id)
                   VALUES(%s, %s, 1, %s, %s)""",
                (team_id, name, parent, mgr),
            )
        conn.execute("SELECT setval('teams_id_seq', (SELECT MAX(id) FROM teams))")

        roles = [
            ("30004679", 1, "lead",   True),
            ("30057537", 2, "lead",   True),
            ("30036413", 2, "member", True),
            ("30041568", 3, "lead",   True),
            ("30049038", 3, "member", True),
            ("35003195", 3, "member", True),
            ("30040640", 4, "lead",   True),
            ("30056725", 4, "member", True),
            ("30046341", 5, "lead",   True),
            ("35001480", 5, "member", True),
            ("30059497", 5, "member", True),
        ]
        for emp_id, team_id, role, primary in roles:
            user_id = _uid(emp_id)
            if user_id:
                conn.execute(
                    """INSERT INTO user_team_roles(user_id, team_id, role, primary_team)
                       VALUES(%s, %s, %s, %s)
                       ON CONFLICT (user_id, team_id) DO NOTHING""",
                    (user_id, team_id, role, primary),
                )

        leader_map = {
            "30057537": exec_mgr,
            "30041568": exec_mgr,
            "30040640": exec_mgr,
            "30046341": exec_mgr,
            "30036413": it_intel_mgr,
            "30049038": it_digi_mgr,
            "35003195": it_digi_mgr,
            "30056725": sim_mgr,
            "35001480": opt_mgr,
            "30059497": opt_mgr,
        }
        for emp_id, mgr_id in leader_map.items():
            if mgr_id:
                conn.execute(
                    "UPDATE users SET manager_id = %s WHERE employee_id = %s",
                    (mgr_id, emp_id),
                )

    if _count(conn, "tags") == 0:
        conn.executemany(
            "INSERT INTO tags(name) VALUES(%s)",
            [("#shutdown",), ("#safety",), ("#maintenance",),
             ("#commissioning",), ("#urgent",), ("#fyi",)],
        )


# ─────────────────────────────────────────────────────────────────────────────
#  Public entry point
# ─────────────────────────────────────────────────────────────────────────────

def init_db() -> None:
    """
    Idempotent initialisation — safe to call on every app startup.

    1. Runs all CREATE OR REPLACE trigger functions (PL/pgSQL).
    2. Creates tables and indexes if they don't already exist.
    3. Attaches triggers to tables (guarded by pg_trigger existence check).
    4. Seeds reference data only when tables are empty.
    5. Migrates legacy schedule/progress free-text fields if present.
    """
    with get_db() as conn:

        # Step 1 — create/replace all trigger functions in one shot
        # psycopg2 can execute the whole block because it contains no
        # parameterised placeholders — it is pure DDL.
        conn.execute(_TRIGGER_FUNCTIONS)

        # Step 2 + 3 — tables, indexes, triggers (each statement individually)
        for stmt in _DDL_STATEMENTS:
            conn.execute(stmt)

        # Step 4 — seed reference data
        _seed(conn, LLM_BASE_URL, LLM_MODEL, LLM_TIMEOUT_SECONDS)

        # Step 5 — migrate legacy free-text fields (idempotent via NOT EXISTS)
        conn.execute(
            """INSERT INTO project_schedule
                   (report_project_id, title, start_date, created_by, updated_by)
               SELECT rp.id,
                      TRIM(rp.schedule),
                      r.week_start,
                      rp.created_by,
                      rp.updated_by
               FROM report_projects rp
               JOIN reports r ON r.id = rp.report_id
               WHERE rp.schedule IS NOT NULL
                 AND TRIM(rp.schedule) != ''
                 AND NOT EXISTS (
                     SELECT 1 FROM project_schedule ps
                     WHERE ps.report_project_id = rp.id
                 )"""
        )

        conn.execute(
            """INSERT INTO issue_item
                   (report_project_id, title, status, start_date, details,
                    created_by, updated_by)
               SELECT rp.id,
                      'Imported progress',
                      'reported',
                      r.week_start,
                      TRIM(rp.progress),
                      rp.created_by,
                      rp.updated_by
               FROM report_projects rp
               JOIN reports r ON r.id = rp.report_id
               WHERE rp.progress IS NOT NULL
                 AND TRIM(rp.progress) != ''
                 AND NOT EXISTS (
                     SELECT 1 FROM issue_item ii
                     WHERE ii.report_project_id = rp.id
                 )"""
        )

        # Clean up any stale FTS entries from the old 'progress' source_type
        conn.execute(
            "DELETE FROM report_search WHERE source_type = 'progress'"
        )
