from datetime import date, timedelta
from .session import get_db
from ..core.config import sunday_of_week

REPORT_BACKFILL_START = date(2025, 4, 1)


def _first_sunday_on_or_after(d: date) -> date:
    days_until_sunday = (6 - d.weekday()) % 7
    return d + timedelta(days=days_until_sunday)


def _ensure_current_week_reports():
    """Auto-create draft reports for every active non-deleted user from April 2025 through the current week."""
    today = date.today()
    current_week_start = sunday_of_week(today)
    start_week = _first_sunday_on_or_after(REPORT_BACKFILL_START)

    with get_db() as conn:
        users = conn.execute("SELECT id FROM users WHERE is_deleted=0").fetchall()
        week_start = start_week
        while week_start <= current_week_start:
            week_start_str = week_start.isoformat()
            iso = week_start.isocalendar()
            year, week_number = iso[0], iso[1]
            for u in users:
                uid = u["id"]
                if not conn.execute(
                    "SELECT id FROM reports WHERE owner_id=? AND week_start=?",
                    (uid, week_start_str),
                ).fetchone():
                    conn.execute(
                        """INSERT INTO reports(owner_id,week_start,year,week_number,
                                              status_id,visibility,created_by,updated_by)
                           VALUES(?,?,?,?,1,'team',?,?)""",
                        (uid, week_start_str, year, week_number, uid, uid),
                    )
            week_start += timedelta(days=7)


def init_db():
    with get_db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS ranks (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS report_status (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS schedule_type (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS departments (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, code TEXT UNIQUE,
            parent_id INTEGER, is_deleted INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (parent_id) REFERENCES departments(id)
        );
        CREATE TABLE IF NOT EXISTS teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, department_id INTEGER NOT NULL,
            parent_team_id INTEGER, manager_id INTEGER, is_deleted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (department_id) REFERENCES departments(id),
            FOREIGN KEY (parent_team_id) REFERENCES teams(id),
            FOREIGN KEY (manager_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS user_team_roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, team_id INTEGER NOT NULL,
            role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('lead','member','observer')),
            primary_team INTEGER NOT NULL DEFAULT 0, assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, team_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
            employee_id TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL DEFAULT '',
            rank_id INTEGER NOT NULL, manager_id INTEGER, phone TEXT,
            locale TEXT NOT NULL DEFAULT 'ko' CHECK (locale IN ('ko','en')),
            is_admin INTEGER NOT NULL DEFAULT 0, is_deleted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER, updated_by INTEGER, last_login_at TEXT,
            FOREIGN KEY (rank_id) REFERENCES ranks(id),
            FOREIGN KEY (manager_id) REFERENCES users(id),
            FOREIGN KEY (created_by) REFERENCES users(id),
            FOREIGN KEY (updated_by) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT, project_name TEXT NOT NULL, wbs_number TEXT,
            solution_product TEXT, department_id INTEGER, company TEXT NOT NULL, location TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_hold','completed','cancelled')),
            start_date TEXT CHECK (start_date IS NULL OR start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            end_date TEXT CHECK (end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            is_deleted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER, updated_by INTEGER,
            CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
            FOREIGN KEY (department_id) REFERENCES departments(id),
            FOREIGN KEY (created_by) REFERENCES users(id), FOREIGN KEY (updated_by) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER NOT NULL,
            week_start TEXT NOT NULL CHECK (week_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            year INTEGER NOT NULL, week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 53),
            status_id INTEGER NOT NULL DEFAULT 1,
            visibility TEXT NOT NULL DEFAULT 'team' CHECK (visibility IN ('private','team','department','company')),
            is_locked INTEGER NOT NULL DEFAULT 0, manager_comment TEXT,
            submitted_at TEXT, approved_at TEXT, approved_by INTEGER,
            is_deleted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER, updated_by INTEGER,
            UNIQUE(owner_id, week_start),
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (status_id) REFERENCES report_status(id),
            FOREIGN KEY (approved_by) REFERENCES users(id),
            FOREIGN KEY (created_by) REFERENCES users(id), FOREIGN KEY (updated_by) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS report_projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER NOT NULL, project_id INTEGER NOT NULL,
            schedule TEXT, progress TEXT, remarks TEXT,
            risk_level TEXT NOT NULL DEFAULT 'normal' CHECK (risk_level IN ('normal','risk','blocker')),
            completion_pct INTEGER NOT NULL DEFAULT 0 CHECK (completion_pct BETWEEN 0 AND 100),
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by INTEGER, updated_by INTEGER,
            UNIQUE(report_id, project_id),
            FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id), FOREIGN KEY (updated_by) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS project_schedule (
            id INTEGER PRIMARY KEY AUTOINCREMENT, report_project_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            start_date TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            end_date TEXT CHECK (end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER, updated_by INTEGER,
            CHECK (end_date IS NULL OR end_date >= start_date),
            FOREIGN KEY (report_project_id) REFERENCES report_projects(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id), FOREIGN KEY (updated_by) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS issue_item (
            id INTEGER PRIMARY KEY AUTOINCREMENT, report_project_id INTEGER NOT NULL,
            title TEXT NOT NULL, status TEXT NOT NULL,
            start_date TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            end_date TEXT CHECK (end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            details TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER, updated_by INTEGER,
            CHECK (end_date IS NULL OR end_date >= start_date),
            FOREIGN KEY (report_project_id) REFERENCES report_projects(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id), FOREIGN KEY (updated_by) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS issue_progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT, issue_item_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            start_date TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            end_date TEXT CHECK (end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            details TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CHECK (end_date IS NULL OR end_date >= start_date),
            FOREIGN KEY (issue_item_id) REFERENCES issue_item(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS report_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER NOT NULL,
            version_number INTEGER NOT NULL, snapshot_json TEXT NOT NULL,
            created_by INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(report_id, version_number),
            FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS report_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
            parent_comment_id INTEGER, comment TEXT NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER, updated_by INTEGER,
            FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (parent_comment_id) REFERENCES report_comments(id),
            FOREIGN KEY (created_by) REFERENCES users(id), FOREIGN KEY (updated_by) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS comment_mentions (
            id INTEGER PRIMARY KEY AUTOINCREMENT, comment_id INTEGER NOT NULL,
            mentioned_user_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(comment_id, mentioned_user_id),
            FOREIGN KEY (comment_id) REFERENCES report_comments(id) ON DELETE CASCADE,
            FOREIGN KEY (mentioned_user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS report_approvals (
            id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER NOT NULL, approver_id INTEGER NOT NULL,
            level INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
            comments TEXT, action_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
            FOREIGN KEY (approver_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS project_assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
            role TEXT, assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(project_id, user_id),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        -- ── Project-level persistent records (new) ─────────────────────────
        CREATE TABLE IF NOT EXISTS project_milestones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            planned_date TEXT NOT NULL CHECK (planned_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            actual_date TEXT CHECK (actual_date IS NULL OR actual_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','done','delayed','cancelled')),
            is_deleted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER, updated_by INTEGER,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id),
            FOREIGN KEY (updated_by) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS project_issues (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Open',
            priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','critical')),
            start_date TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            end_date TEXT CHECK (end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            details TEXT,
            is_deleted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER, updated_by INTEGER,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id),
            FOREIGN KEY (updated_by) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS project_issue_progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            start_date TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            end_date TEXT CHECK (end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            details TEXT,
            is_deleted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER, updated_by INTEGER,
            FOREIGN KEY (issue_id) REFERENCES project_issues(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id),
            FOREIGN KEY (updated_by) REFERENCES users(id)
        );

        CREATE INDEX IF NOT EXISTS idx_proj_milestones ON project_milestones(project_id, planned_date);
        CREATE INDEX IF NOT EXISTS idx_proj_issues ON project_issues(project_id, status);
        CREATE INDEX IF NOT EXISTS idx_proj_issue_progress ON project_issue_progress(issue_id, start_date);
        CREATE TABLE IF NOT EXISTS project_dependencies (
            id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, depends_on_id INTEGER NOT NULL,
            UNIQUE(project_id, depends_on_id), CHECK(project_id != depends_on_id),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (depends_on_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER, project_id INTEGER, comment_id INTEGER,
            file_name TEXT NOT NULL, file_path TEXT NOT NULL UNIQUE, mime_type TEXT, file_size INTEGER,
            is_deleted INTEGER NOT NULL DEFAULT 0, uploaded_by INTEGER, uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CHECK((report_id IS NOT NULL)+(project_id IS NOT NULL)+(comment_id IS NOT NULL)=1),
            FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (comment_id) REFERENCES report_comments(id) ON DELETE CASCADE,
            FOREIGN KEY (uploaded_by) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS report_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER NOT NULL,
            metric_name TEXT NOT NULL, metric_value REAL NOT NULL, metric_unit TEXT,
            UNIQUE(report_id, metric_name),
            FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL,
            title TEXT NOT NULL, message TEXT, reference_type TEXT, reference_id INTEGER,
            is_read INTEGER NOT NULL DEFAULT 0, is_deleted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS report_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 0, is_deleted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS report_template_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL, project_id INTEGER NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0, UNIQUE(template_id, project_id),
            FOREIGN KEY (template_id) REFERENCES report_templates(id) ON DELETE CASCADE,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS project_risk_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, report_id INTEGER NOT NULL,
            week_start TEXT NOT NULL, risk_level TEXT NOT NULL CHECK (risk_level IN ('normal','risk','blocker')),
            description TEXT, created_by INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
        CREATE TABLE IF NOT EXISTS entity_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tag_id INTEGER NOT NULL,
            entity_type TEXT NOT NULL CHECK (entity_type IN ('report','project','comment')),
            entity_id INTEGER NOT NULL, tagged_by INTEGER, tagged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(tag_id, entity_type, entity_id),
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
            FOREIGN KEY (tagged_by) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS report_ai_insights (
            id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER NOT NULL UNIQUE,
            summary TEXT, risk_summary TEXT, model_used TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS personal_schedule (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type_id INTEGER NOT NULL,
            start_date TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            end_date TEXT NOT NULL CHECK (end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            location TEXT, details TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CHECK(end_date >= start_date),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (type_id) REFERENCES schedule_type(id)
        );
        CREATE TABLE IF NOT EXISTS holidays (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            description TEXT, country_code TEXT NOT NULL DEFAULT 'KR', UNIQUE(date, country_code)
        );
        CREATE TABLE IF NOT EXISTS report_summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER NOT NULL UNIQUE,
            total_projects INTEGER NOT NULL DEFAULT 0, risk_count INTEGER NOT NULL DEFAULT 0,
            blocker_count INTEGER NOT NULL DEFAULT 0, avg_completion INTEGER NOT NULL DEFAULT 0,
            generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, table_name TEXT NOT NULL,
            record_id INTEGER NOT NULL, action TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
            old_values TEXT, new_values TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS report_search USING fts5(
            content, report_id UNINDEXED, source_type UNINDEXED, source_id UNINDEXED
        );

        CREATE INDEX IF NOT EXISTS idx_reports_owner_week ON reports(owner_id, week_start);
        CREATE INDEX IF NOT EXISTS idx_reports_week ON reports(week_start);
        CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status_id);
        CREATE INDEX IF NOT EXISTS idx_reports_year_week ON reports(year, week_number);
        CREATE INDEX IF NOT EXISTS idx_rp_report ON report_projects(report_id);
        CREATE INDEX IF NOT EXISTS idx_rp_project ON report_projects(project_id);
        CREATE INDEX IF NOT EXISTS idx_project_schedule_rp ON project_schedule(report_project_id, start_date);
        CREATE INDEX IF NOT EXISTS idx_issue_item_rp ON issue_item(report_project_id, start_date);
        CREATE INDEX IF NOT EXISTS idx_issue_progress_issue ON issue_progress(issue_item_id, start_date);
        CREATE INDEX IF NOT EXISTS idx_rc_report ON report_comments(report_id);
        CREATE INDEX IF NOT EXISTS idx_notif_user_read ON notifications(user_id, is_read);
        CREATE INDEX IF NOT EXISTS idx_notif_user_time ON notifications(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
        CREATE INDEX IF NOT EXISTS idx_utr_user ON user_team_roles(user_id);

        CREATE TRIGGER IF NOT EXISTS trg_users_updated AFTER UPDATE ON users FOR EACH ROW
        WHEN OLD.updated_at = NEW.updated_at BEGIN UPDATE users SET updated_at=CURRENT_TIMESTAMP WHERE id=OLD.id; END;

        CREATE TRIGGER IF NOT EXISTS trg_projects_updated AFTER UPDATE ON projects FOR EACH ROW
        WHEN OLD.updated_at = NEW.updated_at BEGIN UPDATE projects SET updated_at=CURRENT_TIMESTAMP WHERE id=OLD.id; END;

        CREATE TRIGGER IF NOT EXISTS trg_reports_updated AFTER UPDATE ON reports FOR EACH ROW
        WHEN OLD.updated_at = NEW.updated_at BEGIN UPDATE reports SET updated_at=CURRENT_TIMESTAMP WHERE id=OLD.id; END;

        CREATE TRIGGER IF NOT EXISTS trg_report_projects_updated AFTER UPDATE ON report_projects FOR EACH ROW
        WHEN OLD.updated_at = NEW.updated_at BEGIN UPDATE report_projects SET updated_at=CURRENT_TIMESTAMP WHERE id=OLD.id; END;

        CREATE TRIGGER IF NOT EXISTS trg_project_schedule_updated AFTER UPDATE ON project_schedule FOR EACH ROW
        WHEN OLD.updated_at = NEW.updated_at BEGIN UPDATE project_schedule SET updated_at=CURRENT_TIMESTAMP WHERE id=OLD.id; END;

        CREATE TRIGGER IF NOT EXISTS trg_issue_item_updated AFTER UPDATE ON issue_item FOR EACH ROW
        WHEN OLD.updated_at = NEW.updated_at BEGIN UPDATE issue_item SET updated_at=CURRENT_TIMESTAMP WHERE id=OLD.id; END;

        CREATE TRIGGER IF NOT EXISTS trg_issue_progress_updated AFTER UPDATE ON issue_progress FOR EACH ROW
        WHEN OLD.updated_at = NEW.updated_at BEGIN UPDATE issue_progress SET updated_at=CURRENT_TIMESTAMP WHERE id=OLD.id; END;

        CREATE TRIGGER IF NOT EXISTS trg_report_comments_updated AFTER UPDATE ON report_comments FOR EACH ROW
        WHEN OLD.updated_at = NEW.updated_at BEGIN UPDATE report_comments SET updated_at=CURRENT_TIMESTAMP WHERE id=OLD.id; END;

        CREATE TRIGGER IF NOT EXISTS trg_summary_on_insert AFTER INSERT ON report_projects FOR EACH ROW
        BEGIN
            INSERT INTO report_summaries(report_id,total_projects,risk_count,blocker_count,avg_completion,generated_at)
            SELECT NEW.report_id,COUNT(*),
                   COALESCE(SUM(CASE WHEN risk_level='risk'    THEN 1 ELSE 0 END),0),
                   COALESCE(SUM(CASE WHEN risk_level='blocker' THEN 1 ELSE 0 END),0),
                   COALESCE(CAST(AVG(completion_pct) AS INTEGER),0),CURRENT_TIMESTAMP
            FROM report_projects WHERE report_id=NEW.report_id
            ON CONFLICT(report_id) DO UPDATE SET
                total_projects=excluded.total_projects,risk_count=excluded.risk_count,
                blocker_count=excluded.blocker_count,avg_completion=excluded.avg_completion,generated_at=excluded.generated_at;
            INSERT INTO project_risk_log(project_id,report_id,week_start,risk_level)
            SELECT NEW.project_id,NEW.report_id,r.week_start,NEW.risk_level FROM reports r WHERE r.id=NEW.report_id;
            INSERT INTO report_search(content,report_id,source_type,source_id)
            SELECT NEW.remarks,NEW.report_id,'remarks',NEW.id WHERE NEW.remarks IS NOT NULL AND NEW.remarks!='';
        END;

        CREATE TRIGGER IF NOT EXISTS trg_summary_on_update AFTER UPDATE ON report_projects FOR EACH ROW
        WHEN OLD.risk_level!=NEW.risk_level OR OLD.completion_pct!=NEW.completion_pct OR OLD.remarks IS NOT NEW.remarks
        BEGIN
            INSERT INTO report_summaries(report_id,total_projects,risk_count,blocker_count,avg_completion,generated_at)
            SELECT NEW.report_id,COUNT(*),
                   COALESCE(SUM(CASE WHEN risk_level='risk'    THEN 1 ELSE 0 END),0),
                   COALESCE(SUM(CASE WHEN risk_level='blocker' THEN 1 ELSE 0 END),0),
                   COALESCE(CAST(AVG(completion_pct) AS INTEGER),0),CURRENT_TIMESTAMP
            FROM report_projects WHERE report_id=NEW.report_id
            ON CONFLICT(report_id) DO UPDATE SET
                total_projects=excluded.total_projects,risk_count=excluded.risk_count,
                blocker_count=excluded.blocker_count,avg_completion=excluded.avg_completion,generated_at=excluded.generated_at;
            INSERT INTO project_risk_log(project_id,report_id,week_start,risk_level)
            SELECT NEW.project_id,NEW.report_id,r.week_start,NEW.risk_level FROM reports r WHERE r.id=NEW.report_id AND OLD.risk_level!=NEW.risk_level;
            DELETE FROM report_search WHERE source_type='remarks' AND source_id=OLD.id;
            INSERT INTO report_search(content,report_id,source_type,source_id)
            SELECT NEW.remarks,NEW.report_id,'remarks',NEW.id WHERE NEW.remarks IS NOT NULL AND NEW.remarks!='';
        END;

        CREATE TRIGGER IF NOT EXISTS trg_summary_on_delete AFTER DELETE ON report_projects FOR EACH ROW
        BEGIN
            INSERT INTO report_summaries(report_id,total_projects,risk_count,blocker_count,avg_completion,generated_at)
            SELECT OLD.report_id,COUNT(*),
                   COALESCE(SUM(CASE WHEN risk_level='risk'    THEN 1 ELSE 0 END),0),
                   COALESCE(SUM(CASE WHEN risk_level='blocker' THEN 1 ELSE 0 END),0),
                   COALESCE(CAST(AVG(completion_pct) AS INTEGER),0),CURRENT_TIMESTAMP
            FROM report_projects WHERE report_id=OLD.report_id
            ON CONFLICT(report_id) DO UPDATE SET
                total_projects=excluded.total_projects,risk_count=excluded.risk_count,
                blocker_count=excluded.blocker_count,avg_completion=excluded.avg_completion,generated_at=excluded.generated_at;
            DELETE FROM report_search WHERE source_type='remarks' AND source_id=OLD.id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_issue_item_search_insert AFTER INSERT ON issue_item FOR EACH ROW
        BEGIN
            INSERT INTO report_search(content,report_id,source_type,source_id)
            SELECT NEW.title || ' ' || COALESCE(NEW.status,'') || ' ' || COALESCE(NEW.details,''),
                   rp.report_id,'issue_item',NEW.id
            FROM report_projects rp
            WHERE rp.id=NEW.report_project_id
              AND TRIM(NEW.title || ' ' || COALESCE(NEW.status,'') || ' ' || COALESCE(NEW.details,''))!='';
        END;

        CREATE TRIGGER IF NOT EXISTS trg_issue_item_search_update AFTER UPDATE ON issue_item FOR EACH ROW
        BEGIN
            DELETE FROM report_search WHERE source_type='issue_item' AND source_id=OLD.id;
            INSERT INTO report_search(content,report_id,source_type,source_id)
            SELECT NEW.title || ' ' || COALESCE(NEW.status,'') || ' ' || COALESCE(NEW.details,''),
                   rp.report_id,'issue_item',NEW.id
            FROM report_projects rp
            WHERE rp.id=NEW.report_project_id
              AND TRIM(NEW.title || ' ' || COALESCE(NEW.status,'') || ' ' || COALESCE(NEW.details,''))!='';
        END;

        CREATE TRIGGER IF NOT EXISTS trg_issue_item_search_delete AFTER DELETE ON issue_item FOR EACH ROW
        BEGIN
            DELETE FROM report_search WHERE source_type='issue_item' AND source_id=OLD.id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_fts_comment_insert AFTER INSERT ON report_comments FOR EACH ROW
        WHEN NEW.is_deleted=0 AND NEW.comment!=''
        BEGIN INSERT INTO report_search(content,report_id,source_type,source_id) VALUES(NEW.comment,NEW.report_id,'comment',NEW.id); END;

        CREATE TRIGGER IF NOT EXISTS trg_fts_comment_update AFTER UPDATE ON report_comments FOR EACH ROW
        WHEN OLD.comment IS NOT NEW.comment OR OLD.is_deleted!=NEW.is_deleted
        BEGIN
            DELETE FROM report_search WHERE source_type='comment' AND source_id=OLD.id;
            INSERT INTO report_search(content,report_id,source_type,source_id)
            SELECT NEW.comment,NEW.report_id,'comment',NEW.id WHERE NEW.is_deleted=0 AND NEW.comment!='';
        END;

        CREATE TRIGGER IF NOT EXISTS trg_fts_comment_delete AFTER DELETE ON report_comments FOR EACH ROW
        BEGIN DELETE FROM report_search WHERE source_type='comment' AND source_id=OLD.id; END;

        CREATE TRIGGER IF NOT EXISTS trg_mention_notification AFTER INSERT ON comment_mentions FOR EACH ROW
        BEGIN
            INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id)
            SELECT NEW.mentioned_user_id,'mention',u.name||' mentioned you in a comment',rc.comment,'report',rc.report_id
            FROM report_comments rc JOIN users u ON u.id=rc.user_id WHERE rc.id=NEW.comment_id;
        END;
        """)

        conn.execute(
            """
            INSERT INTO project_schedule(report_project_id,title,start_date,end_date,created_by,updated_by)
            SELECT rp.id, TRIM(rp.schedule), r.week_start, NULL, rp.created_by, rp.updated_by
            FROM report_projects rp
            JOIN reports r ON r.id=rp.report_id
            WHERE rp.schedule IS NOT NULL
              AND TRIM(rp.schedule)!=''
              AND NOT EXISTS (
                  SELECT 1 FROM project_schedule ps WHERE ps.report_project_id=rp.id
              )
            """
        )
        conn.execute(
            """
            INSERT INTO issue_item(report_project_id,title,status,start_date,end_date,details,created_by,updated_by)
            SELECT rp.id, 'Imported progress', 'reported', r.week_start, NULL, TRIM(rp.progress),
                   rp.created_by, rp.updated_by
            FROM report_projects rp
            JOIN reports r ON r.id=rp.report_id
            WHERE rp.progress IS NOT NULL
              AND TRIM(rp.progress)!=''
              AND NOT EXISTS (
                  SELECT 1 FROM issue_item ii WHERE ii.report_project_id=rp.id
              )
            """
        )
        conn.execute("DELETE FROM report_search WHERE source_type='progress'")

        # Seeds
        if conn.execute("SELECT COUNT(*) FROM ranks").fetchone()["COUNT(*)"] == 0:
            conn.executemany("INSERT INTO ranks(name,sort_order) VALUES(?,?)",
                [("사원",1),("대리",2),("과장",3),("차장",4),("부장",5)])

        if conn.execute("SELECT COUNT(*) FROM report_status").fetchone()["COUNT(*)"] == 0:
            conn.executemany("INSERT INTO report_status(name,sort_order) VALUES(?,?)",
                [("초안",1),("제출",2),("승인",3),("반려",4)])

        if conn.execute("SELECT COUNT(*) FROM schedule_type").fetchone()["COUNT(*)"] == 0:
            conn.executemany("INSERT INTO schedule_type(name,sort_order) VALUES(?,?)",
                [("출장 (해외)",1),("출장 (국내)",2),("외근",3),("휴가",4),("휴일 출근",5)])

        if conn.execute("SELECT COUNT(*) FROM departments").fetchone()["COUNT(*)"] == 0:
            conn.execute("INSERT INTO departments(id,name,code) VALUES(1,'Solution & Consulting','SCS')")

        if conn.execute("SELECT COUNT(*) FROM users").fetchone()["COUNT(*)"] == 0:
            from passlib.context import CryptContext
            pwd = CryptContext(schemes=["bcrypt"])
            h = pwd.hash("password123")
            conn.executemany(
                "INSERT INTO users(name,email,is_admin,employee_id,rank_id,locale,password_hash) VALUES(?,?,?,?,?,'ko',?)",
                [
                    ("양우성","woosung.yang@yokogawa.com",   0,"30004679",5,h),
                    ("김정년","jeongnyeon.kim@yokogawa.com", 0,"30036413",3,h),
                    ("김민욱","minwook.kim@yokogawa.com",    0,"30040640",4,h),
                    ("노덕기","duckgee.noh@yokogawa.com",    0,"30041568",4,h),
                    ("유세훈","sehun.yu@yokogawa.com",       0,"30046341",3,h),
                    ("김강년","khangnyon.kim@yokogawa.com",  1,"30049038",2,h),
                    ("김정은","jeongeun.kim@yokogawa.com",   0,"30056725",3,h),
                    ("민준홍","joonhong.min@yokogawa.com",   0,"30057537",4,h),
                    ("유혜빈","hyebin.yoo@yokogawa.com",     0,"30059497",1,h),
                    ("오윤석","yoonseok.oh@yokogawa.com",    0,"35001480",3,h),
                    ("박현민","hyunmin.park@yokogawa.com",   0,"35003195",2,h),
                ]
            )

        if conn.execute("SELECT COUNT(*) FROM teams").fetchone()["COUNT(*)"] == 0:
            conn.execute("INSERT INTO teams(id,name,department_id) VALUES(1,'SCS Team',1)")
            conn.execute("INSERT INTO user_team_roles(user_id,team_id,role,primary_team) SELECT id,1,'member',1 FROM users")

        if conn.execute("SELECT COUNT(*) FROM tags").fetchone()["COUNT(*)"] == 0:
            conn.executemany("INSERT INTO tags(name) VALUES(?)",
                [("#shutdown",),("#safety",),("#maintenance",),("#commissioning",),("#urgent",),("#fyi",)])

        if conn.execute("SELECT COUNT(*) FROM projects").fetchone()["COUNT(*)"] == 0:
            conn.executemany(
                "INSERT INTO projects(project_name,wbs_number,company,location,status,created_by) VALUES(?,?,?,?,?,1)",
                [
                    ("KNPP DCS Upgrade","KR-2025-001","한국수력원자력","Gyeongju","active"),
                    ("Ulsan Refinery APC","KR-2025-002","SK Energy","Ulsan","active"),
                    ("LNG Terminal SCADA","KR-2025-003","Kogas","Incheon","active"),
                    ("Steel Mill PLC Migration","KR-2025-004","POSCO","Pohang","on_hold"),
                    ("Cement Plant DCS","KR-2025-005","Ssangyong Cement","Donghae","active"),
                ]
            )
