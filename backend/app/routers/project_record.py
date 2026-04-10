"""
Project Record API
Manages the persistent project-level schedule and issue tracker.
These records live on the project itself, shared across all assigned members.
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.deps import get_current_user
from ..db.session import get_db

router = APIRouter(prefix="/api/projects", tags=["project-record"])

ISSUE_STATUS_MAP = {
    "Open": "초안",
    "In Progress": "진행중",
    "Done": "완료",
    "Closed": "취소",
    "draft": "초안",
    "in_progress": "진행중",
    "completed": "완료",
    "cancelled": "취소",
}

PRIORITY_MAP = {
    "normal": "normal",
    "high": "high",
    "critical": "high",
    "important": "high",
}


# ── Pydantic models ────────────────────────────────────────────────────────

class MilestoneUpsert(BaseModel):
    title: str
    planned_date: str
    actual_date: Optional[str] = None
    status: str = "planned"   # planned | done | delayed | cancelled


class IssueCreate(BaseModel):
    title: str
    status: str = "초안"
    priority: str = "normal"  # normal | high | critical
    start_date: str
    end_date: Optional[str] = None
    details: Optional[str] = None


class IssueUpdate(BaseModel):
    title: str
    status: str
    priority: str = "normal"
    start_date: str
    end_date: Optional[str] = None
    details: Optional[str] = None


class ProgressCreate(BaseModel):
    title: str
    start_date: str
    end_date: Optional[str] = None
    details: Optional[str] = None


def _normalize_issue_status(value: Optional[str]) -> str:
    if not value:
        return "초안"
    return ISSUE_STATUS_MAP.get(value, value)


def _normalize_issue_priority(value: Optional[str]) -> str:
    if not value:
        return "normal"
    return PRIORITY_MAP.get(value, value)


# ── Helpers ────────────────────────────────────────────────────────────────

def _assert_assigned(conn, project_id: int, user_id: int, is_admin: bool):
    """Non-admins must be assigned to the project to modify its record."""
    if is_admin:
        return
    assigned = conn.execute(
        "SELECT 1 FROM project_assignments WHERE project_id=? AND user_id=?",
        (project_id, user_id),
    ).fetchone()
    if not assigned:
        raise HTTPException(403, "이 프로젝트의 담당자만 수정할 수 있습니다.")


def _full_project_record(conn, project_id: int) -> dict:
    milestones = conn.execute(
        """SELECT * FROM project_milestones
           WHERE project_id=? AND is_deleted=0
           ORDER BY planned_date, id""",
        (project_id,),
    ).fetchall()

    issues_raw = conn.execute(
        """SELECT * FROM project_issues
           WHERE project_id=? AND is_deleted=0
           ORDER BY start_date, id""",
        (project_id,),
    ).fetchall()

    if issues_raw:
        issue_ids = [i["id"] for i in issues_raw]
        placeholders = ",".join("?" * len(issue_ids))
        progresses = conn.execute(
            f"""SELECT pip.*, u.name as author_name
                FROM project_issue_progress pip
                LEFT JOIN users u ON u.id=pip.created_by
                WHERE pip.issue_id IN ({placeholders}) AND pip.is_deleted=0
                ORDER BY pip.start_date, pip.id""",
            issue_ids,
        ).fetchall()
        prog_by_issue: dict[int, list] = {}
        for p in progresses:
            prog_by_issue.setdefault(p["issue_id"], []).append(dict(p))
    else:
        prog_by_issue = {}

    issues = []
    for i in issues_raw:
        d = dict(i)
        d["status"] = _normalize_issue_status(d.get("status"))
        d["priority"] = _normalize_issue_priority(d.get("priority"))
        d["progresses"] = prog_by_issue.get(i["id"], [])
        issues.append(d)

    return {"milestones": [dict(m) for m in milestones], "issues": issues}


# ── Routes ─────────────────────────────────────────────────────────────────

@router.get("/{project_id}/record")
def get_project_record(project_id: int, current_user=Depends(get_current_user)):
    with get_db() as conn:
        project = conn.execute(
            """SELECT p.*, d.name as dept_name FROM projects p
               LEFT JOIN departments d ON d.id=p.department_id
               WHERE p.id=? AND p.is_deleted=0""",
            (project_id,),
        ).fetchone()
        if not project:
            raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")

        assignees = conn.execute(
            """SELECT u.id, u.name, r.name as rank_name
               FROM project_assignments pa
               JOIN users u ON u.id=pa.user_id
               JOIN ranks r ON r.id=u.rank_id
               WHERE pa.project_id=? AND u.is_deleted=0
               ORDER BY u.name""",
            (project_id,),
        ).fetchall()

        record = _full_project_record(conn, project_id)
        return {**project, "assignees": [dict(a) for a in assignees], **record}


# ── Milestones ─────────────────────────────────────────────────────────────

@router.post("/{project_id}/milestones")
def add_milestone(
    project_id: int,
    body: MilestoneUpsert,
    current_user=Depends(get_current_user),
):
    with get_db() as conn:
        _assert_assigned(conn, project_id, current_user["id"], bool(current_user["is_admin"]))
        conn.execute(
            """INSERT INTO project_milestones
                   (project_id, title, planned_date, actual_date, status, created_by, updated_by)
               VALUES (?,?,?,?,?,?,?)""",
            (project_id, body.title.strip(), body.planned_date,
             body.actual_date, body.status,
             current_user["id"], current_user["id"]),
        )
        mid = conn.execute("SELECT last_insert_rowid() as id").fetchone()["id"]
        return conn.execute("SELECT * FROM project_milestones WHERE id=?", (mid,)).fetchone()


@router.put("/{project_id}/milestones/{milestone_id}")
def update_milestone(
    project_id: int,
    milestone_id: int,
    body: MilestoneUpsert,
    current_user=Depends(get_current_user),
):
    with get_db() as conn:
        _assert_assigned(conn, project_id, current_user["id"], bool(current_user["is_admin"]))
        conn.execute(
            """UPDATE project_milestones
               SET title=?, planned_date=?, actual_date=?, status=?, updated_by=?
               WHERE id=? AND project_id=? AND is_deleted=0""",
            (body.title.strip(), body.planned_date, body.actual_date, body.status,
             current_user["id"], milestone_id, project_id),
        )
        return conn.execute("SELECT * FROM project_milestones WHERE id=?", (milestone_id,)).fetchone()


@router.delete("/{project_id}/milestones/{milestone_id}")
def delete_milestone(
    project_id: int,
    milestone_id: int,
    current_user=Depends(get_current_user),
):
    with get_db() as conn:
        _assert_assigned(conn, project_id, current_user["id"], bool(current_user["is_admin"]))
        conn.execute(
            "UPDATE project_milestones SET is_deleted=1 WHERE id=? AND project_id=?",
            (milestone_id, project_id),
        )
    return {"ok": True}


# ── Issues ─────────────────────────────────────────────────────────────────

@router.post("/{project_id}/issues")
def add_issue(
    project_id: int,
    body: IssueCreate,
    current_user=Depends(get_current_user),
):
    with get_db() as conn:
        _assert_assigned(conn, project_id, current_user["id"], bool(current_user["is_admin"]))
        conn.execute(
            """INSERT INTO project_issues
                   (project_id, title, status, priority, start_date, end_date, details,
                    created_by, updated_by)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                project_id,
                body.title.strip(),
                _normalize_issue_status(body.status),
                _normalize_issue_priority(body.priority),
                body.start_date,
                body.end_date,
                body.details,
                current_user["id"],
                current_user["id"],
            ),
        )
        iid = conn.execute("SELECT last_insert_rowid() as id").fetchone()["id"]
        row = dict(conn.execute("SELECT * FROM project_issues WHERE id=?", (iid,)).fetchone())
        row["status"] = _normalize_issue_status(row.get("status"))
        row["priority"] = _normalize_issue_priority(row.get("priority"))
        row["progresses"] = []
        return row


@router.put("/{project_id}/issues/{issue_id}")
def update_issue(
    project_id: int,
    issue_id: int,
    body: IssueUpdate,
    current_user=Depends(get_current_user),
):
    with get_db() as conn:
        _assert_assigned(conn, project_id, current_user["id"], bool(current_user["is_admin"]))
        conn.execute(
            """UPDATE project_issues
               SET title=?, status=?, priority=?, start_date=?, end_date=?, details=?, updated_by=?
               WHERE id=? AND project_id=? AND is_deleted=0""",
            (
                body.title.strip(),
                _normalize_issue_status(body.status),
                _normalize_issue_priority(body.priority),
                body.start_date,
                body.end_date,
                body.details,
                current_user["id"],
                issue_id,
                project_id,
            ),
        )
        row = dict(conn.execute("SELECT * FROM project_issues WHERE id=?", (issue_id,)).fetchone())
        row["status"] = _normalize_issue_status(row.get("status"))
        row["priority"] = _normalize_issue_priority(row.get("priority"))
        progresses = conn.execute(
            """SELECT pip.*, u.name as author_name
               FROM project_issue_progress pip
               LEFT JOIN users u ON u.id=pip.created_by
               WHERE pip.issue_id=? AND pip.is_deleted=0
               ORDER BY pip.start_date, pip.id""",
            (issue_id,),
        ).fetchall()
        row["progresses"] = [dict(p) for p in progresses]
        return row


@router.delete("/{project_id}/issues/{issue_id}")
def delete_issue(
    project_id: int,
    issue_id: int,
    current_user=Depends(get_current_user),
):
    with get_db() as conn:
        _assert_assigned(conn, project_id, current_user["id"], bool(current_user["is_admin"]))
        conn.execute(
            "UPDATE project_issues SET is_deleted=1 WHERE id=? AND project_id=?",
            (issue_id, project_id),
        )
    return {"ok": True}


# ── Issue progress ─────────────────────────────────────────────────────────

@router.post("/{project_id}/issues/{issue_id}/progress")
def add_progress(
    project_id: int,
    issue_id: int,
    body: ProgressCreate,
    current_user=Depends(get_current_user),
):
    with get_db() as conn:
        _assert_assigned(conn, project_id, current_user["id"], bool(current_user["is_admin"]))
        # Verify issue belongs to this project
        issue = conn.execute(
            "SELECT id FROM project_issues WHERE id=? AND project_id=? AND is_deleted=0",
            (issue_id, project_id),
        ).fetchone()
        if not issue:
            raise HTTPException(404, "이슈를 찾을 수 없습니다.")

        conn.execute(
            """INSERT INTO project_issue_progress
                   (issue_id, title, start_date, end_date, details, created_by, updated_by)
               VALUES (?,?,?,?,?,?,?)""",
            (issue_id, body.title.strip(), body.start_date, body.end_date, body.details,
             current_user["id"], current_user["id"]),
        )
        pid = conn.execute("SELECT last_insert_rowid() as id").fetchone()["id"]
        return conn.execute(
            """SELECT pip.*, u.name as author_name
               FROM project_issue_progress pip
               LEFT JOIN users u ON u.id=pip.created_by
               WHERE pip.id=?""",
            (pid,),
        ).fetchone()


@router.put("/{project_id}/issues/{issue_id}/progress/{progress_id}")
def update_progress(
    project_id: int,
    issue_id: int,
    progress_id: int,
    body: ProgressCreate,
    current_user=Depends(get_current_user),
):
    with get_db() as conn:
        _assert_assigned(conn, project_id, current_user["id"], bool(current_user["is_admin"]))
        conn.execute(
            """UPDATE project_issue_progress
               SET title=?, start_date=?, end_date=?, details=?, updated_by=?
               WHERE id=? AND issue_id=? AND is_deleted=0""",
            (body.title.strip(), body.start_date, body.end_date, body.details,
             current_user["id"], progress_id, issue_id),
        )
        return conn.execute(
            """SELECT pip.*, u.name as author_name
               FROM project_issue_progress pip
               LEFT JOIN users u ON u.id=pip.created_by
               WHERE pip.id=?""",
            (progress_id,),
        ).fetchone()


@router.delete("/{project_id}/issues/{issue_id}/progress/{progress_id}")
def delete_progress(
    project_id: int,
    issue_id: int,
    progress_id: int,
    current_user=Depends(get_current_user),
):
    with get_db() as conn:
        _assert_assigned(conn, project_id, current_user["id"], bool(current_user["is_admin"]))
        conn.execute(
            "UPDATE project_issue_progress SET is_deleted=1 WHERE id=? AND issue_id=?",
            (progress_id, issue_id),
        )
    return {"ok": True}
