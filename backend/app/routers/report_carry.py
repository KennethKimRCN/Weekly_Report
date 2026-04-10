"""
Report carry-forward & project issue linking API.
Handles:
  - GET  /api/reports/{id}/carry-preview  — shows what can be carried from last week
  - POST /api/reports/{id}/carry-forward  — actually carries items forward
  - GET  /api/reports/{id}/project-issues — project issues available to include in this report
  - POST /api/reports/{id}/link-issues    — link project issues into this week's report_project
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.deps import get_current_user
from ..db.session import get_db

router = APIRouter(prefix="/api/reports", tags=["carry-forward"])


class CarryForwardBody(BaseModel):
    """Which elements to carry forward from the previous week's report."""
    project_ids: List[int]           # which projects to add (already on report = skipped)
    carry_open_issues: bool = True   # pull open project issues into this week


class LinkIssuesBody(BaseModel):
    report_project_id: int
    issue_ids: List[int]   # project_issues.id to include in this report


# ── Carry-forward preview ──────────────────────────────────────────────────

@router.get("/{report_id}/carry-preview")
def carry_preview(report_id: int, current_user=Depends(get_current_user)):
    """
    Return what the previous week's report contained so the member can
    decide what to pull into this week.
    """
    with get_db() as conn:
        report = conn.execute(
            "SELECT * FROM reports WHERE id=? AND is_deleted=0", (report_id,)
        ).fetchone()
        if not report:
            raise HTTPException(404)
        if report["owner_id"] != current_user["id"] and not current_user["is_admin"]:
            raise HTTPException(403)

        # Find previous report for same owner
        prev = conn.execute(
            """SELECT r.id, r.week_start FROM reports r
               WHERE r.owner_id=? AND r.week_start < ? AND r.is_deleted=0
               ORDER BY r.week_start DESC LIMIT 1""",
            (report["owner_id"], report["week_start"]),
        ).fetchone()
        if not prev:
            return {"prev_week": None, "projects": []}

        prev_projects = conn.execute(
            """SELECT rp.project_id, p.project_name, p.company, p.location,
                      p.status as project_status, rp.remarks
               FROM report_projects rp
               JOIN projects p ON p.id=rp.project_id
               WHERE rp.report_id=? AND p.is_deleted=0
               ORDER BY p.project_name""",
            (prev["id"],),
        ).fetchall()

        # For each prev project, get its open issues from project_issues
        result = []
        for pp in prev_projects:
            pid = pp["project_id"]
            open_issues = conn.execute(
                """SELECT id, title, status, priority, start_date, end_date, details
                   FROM project_issues
                   WHERE project_id=? AND is_deleted=0
                     AND status NOT IN ('완료','Closed','Done','cancelled','취소')
                   ORDER BY start_date, id""",
                (pid,),
            ).fetchall()

            # Check if already on current report
            already = conn.execute(
                "SELECT 1 FROM report_projects WHERE report_id=? AND project_id=?",
                (report_id, pid),
            ).fetchone()

            result.append({
                "project_id": pid,
                "project_name": pp["project_name"],
                "company": pp["company"],
                "location": pp["location"],
                "project_status": pp["project_status"],
                "already_added": bool(already),
                "open_issues": [dict(i) for i in open_issues],
            })

        return {"prev_week": prev["week_start"], "projects": result}


# ── Carry-forward execute ──────────────────────────────────────────────────

@router.post("/{report_id}/carry-forward")
def carry_forward(
    report_id: int,
    body: CarryForwardBody,
    current_user=Depends(get_current_user),
):
    """
    Add projects (and optionally their open issues) to this week's report.
    Projects already on the report are skipped.
    """
    with get_db() as conn:
        report = conn.execute(
            "SELECT * FROM reports WHERE id=? AND is_deleted=0", (report_id,)
        ).fetchone()
        if not report:
            raise HTTPException(404)
        if report["owner_id"] != current_user["id"] and not current_user["is_admin"]:
            raise HTTPException(403)
        if report["is_locked"] and not current_user["is_admin"]:
            raise HTTPException(423, "제출된 보고서는 수정할 수 없습니다.")

        added = []
        for project_id in body.project_ids:
            # Skip if already there
            existing = conn.execute(
                "SELECT id FROM report_projects WHERE report_id=? AND project_id=?",
                (report_id, project_id),
            ).fetchone()
            if existing:
                added.append({"project_id": project_id, "report_project_id": existing["id"]})
                continue

            # Verify project exists and user is assigned
            project = conn.execute(
                "SELECT * FROM projects WHERE id=? AND is_deleted=0", (project_id,)
            ).fetchone()
            if not project:
                continue
            if not current_user["is_admin"]:
                assigned = conn.execute(
                    "SELECT 1 FROM project_assignments WHERE project_id=? AND user_id=?",
                    (project_id, current_user["id"]),
                ).fetchone()
                if not assigned:
                    continue

            conn.execute(
                """INSERT INTO report_projects
                       (report_id, project_id, risk_level, completion_pct, created_by, updated_by)
                   VALUES (?,?,'normal',0,?,?)""",
                (report_id, project_id, current_user["id"], current_user["id"]),
            )
            rp_id = conn.execute("SELECT last_insert_rowid() as id").fetchone()["id"]
            added.append({"project_id": project_id, "report_project_id": rp_id})

        return {"added": added}


# ── Available project issues for a report ─────────────────────────────────

@router.get("/{report_id}/projects/{project_id}/available-issues")
def available_issues(
    report_id: int,
    project_id: int,
    current_user=Depends(get_current_user),
):
    """
    Return all active issues from the project record so the member can
    choose which ones to include in this week's report.
    """
    with get_db() as conn:
        report = conn.execute(
            "SELECT * FROM reports WHERE id=? AND is_deleted=0", (report_id,)
        ).fetchone()
        if not report:
            raise HTTPException(404)

        issues = conn.execute(
            """SELECT pi.id, pi.title, pi.status, pi.priority,
                      pi.start_date, pi.end_date, pi.details,
                      u.name as created_by_name,
                      (SELECT COUNT(*) FROM project_issue_progress pip
                       WHERE pip.issue_id=pi.id AND pip.is_deleted=0) as progress_count
               FROM project_issues pi
               LEFT JOIN users u ON u.id=pi.created_by
               WHERE pi.project_id=? AND pi.is_deleted=0
               ORDER BY
                 CASE pi.status
                   WHEN 'Open'        THEN 0
                   WHEN 'In Progress' THEN 1
                   WHEN 'Done'        THEN 3
                   WHEN 'Closed'      THEN 4
                   ELSE 2
                 END,
                 pi.start_date, pi.id""",
            (project_id,),
        ).fetchall()
        return [dict(i) for i in issues]
