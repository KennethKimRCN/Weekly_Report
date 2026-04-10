import json
import re
from datetime import date, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..core.deps import get_current_user
from ..db.session import get_db

router = APIRouter(prefix="/api/reports", tags=["reports"])

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

class ReportProjectUpsert(BaseModel):
    project_id: int
    remarks: Optional[str] = None
    project_status: str = "active"
    project_schedules: list["ProjectScheduleInput"] = Field(default_factory=list)
    issue_items: list["IssueItemInput"] = Field(default_factory=list)


class ProjectScheduleInput(BaseModel):
    title: str
    start_date: str
    end_date: Optional[str] = None


class IssueItemInput(BaseModel):
    title: str
    status: str
    start_date: str
    end_date: Optional[str] = None
    details: Optional[str] = None
    issue_progresses: list["IssueProgressInput"] = Field(default_factory=list)


class IssueProgressInput(BaseModel):
    title: str
    start_date: str
    end_date: Optional[str] = None
    details: Optional[str] = None


class ReportAction(BaseModel):
    manager_comment: Optional[str] = None


class CommentCreate(BaseModel):
    comment: str
    parent_comment_id: Optional[int] = None


def _normalize_issue_status(value: Optional[str]) -> str:
    if not value:
        return "초안"
    return ISSUE_STATUS_MAP.get(value, value)


def _normalize_issue_priority(value: Optional[str]) -> str:
    if not value:
        return "normal"
    return PRIORITY_MAP.get(value, value)


# ── Helpers ────────────────────────────────────────────────────────────────

def _full_report(conn, report_id: int) -> dict:
    report = conn.execute(
        """SELECT r.*, u.name as owner_name, rs.name as status_name,
                  COALESCE(rs2.total_projects,0) as total_projects,
                  COALESCE(rs2.risk_count,0) as risk_count,
                  COALESCE(rs2.blocker_count,0) as blocker_count,
                  COALESCE(rs2.avg_completion,0) as avg_completion
           FROM reports r
           JOIN users u ON u.id=r.owner_id
           JOIN report_status rs ON rs.id=r.status_id
           LEFT JOIN report_summaries rs2 ON rs2.report_id=r.id
           WHERE r.id=? AND r.is_deleted=0""",
        (report_id,),
    ).fetchone()
    if not report:
        raise HTTPException(404, "보고서를 찾을 수 없습니다")

    week_start = date.fromisoformat(report["week_start"])
    week_end = week_start + timedelta(days=6)
    week_start_str = week_start.isoformat()
    week_end_str = week_end.isoformat()

    projects = [
        dict(row)
        for row in conn.execute(
            """SELECT rp.*, p.project_name, p.solution_product, p.company, p.location,
                      p.wbs_number, p.status as project_status
               FROM report_projects rp
               JOIN projects p ON p.id=rp.project_id
               WHERE rp.report_id=?
               ORDER BY COALESCE(NULLIF(TRIM(p.solution_product), ''), '기타'), p.project_name""",
            (report_id,),
        ).fetchall()
    ]

    project_ids = [project["project_id"] for project in projects]
    milestones_by_project: dict[int, list[dict]] = {}
    issues_by_project: dict[int, list[dict]] = {}

    if project_ids:
        placeholders = ",".join("?" for _ in project_ids)

        for row in conn.execute(
            f"""SELECT pm.*, rp.id as report_project_id
                FROM project_milestones pm
                JOIN report_projects rp ON rp.project_id=pm.project_id
                WHERE rp.report_id=?
                  AND pm.project_id IN ({placeholders})
                  AND pm.is_deleted=0
                ORDER BY pm.planned_date, pm.id""",
            [report_id, *project_ids],
        ).fetchall():
            milestone = dict(row)
            milestones_by_project.setdefault(milestone["report_project_id"], []).append(
                {
                    "id": milestone["id"],
                    "report_project_id": milestone["report_project_id"],
                    "title": milestone["title"],
                    "start_date": milestone["planned_date"],
                    "end_date": milestone["actual_date"],
                    "status": milestone["status"],
                    "created_at": milestone["created_at"],
                    "updated_at": milestone["updated_at"],
                }
            )

        issue_rows = conn.execute(
            f"""SELECT pi.*, rp.id as report_project_id
                FROM project_issues pi
                JOIN report_projects rp ON rp.project_id=pi.project_id
                WHERE rp.report_id=?
                  AND pi.project_id IN ({placeholders})
                  AND pi.is_deleted=0
                ORDER BY pi.start_date, pi.id""",
            [report_id, *project_ids],
        ).fetchall()

        issue_id_to_meta: dict[int, tuple[int, dict]] = {}
        issue_ids: list[int] = []
        for row in issue_rows:
            issue = dict(row)
            issue["status"] = _normalize_issue_status(issue.get("status"))
            issue["priority"] = _normalize_issue_priority(issue.get("priority"))
            issue["issue_progresses"] = []
            issue_id_to_meta[issue["id"]] = (issue["report_project_id"], issue)
            issue_ids.append(issue["id"])

        if issue_ids:
            issue_placeholders = ",".join("?" for _ in issue_ids)
            all_progress_rows = conn.execute(
                f"""SELECT pip.*, u.name as author_name
                    FROM project_issue_progress pip
                    LEFT JOIN users u ON u.id=pip.created_by
                    WHERE pip.issue_id IN ({issue_placeholders})
                      AND pip.is_deleted=0
                    ORDER BY pip.start_date, COALESCE(pip.end_date, pip.start_date), pip.id""",
                issue_ids,
            ).fetchall()

            for row in all_progress_rows:
                progress = dict(row)
                project_info = issue_id_to_meta.get(progress["issue_id"])
                if not project_info:
                    continue
                _, issue = project_info
                issue.setdefault("full_issue_progresses", []).append(
                    {
                        "id": progress["id"],
                        "issue_item_id": progress["issue_id"],
                        "title": progress["title"],
                        "start_date": progress["start_date"],
                        "end_date": progress["end_date"],
                        "details": progress["details"],
                        "author_name": progress["author_name"],
                        "created_at": progress["created_at"],
                        "updated_at": progress["updated_at"],
                    }
                )

            progress_rows = conn.execute(
                f"""SELECT pip.*, u.name as author_name
                    FROM project_issue_progress pip
                    LEFT JOIN users u ON u.id=pip.created_by
                    WHERE pip.issue_id IN ({issue_placeholders})
                      AND pip.is_deleted=0
                      AND pip.created_by=?
                      AND pip.start_date<=?
                      AND COALESCE(pip.end_date, pip.start_date)>=?
                    ORDER BY pip.start_date, COALESCE(pip.end_date, pip.start_date), pip.id""",
                [*issue_ids, report["owner_id"], week_end_str, week_start_str],
            ).fetchall()

            for row in progress_rows:
                progress = dict(row)
                project_info = issue_id_to_meta.get(progress["issue_id"])
                if not project_info:
                    continue
                _, issue = project_info
                issue["issue_progresses"].append(
                    {
                        "id": progress["id"],
                        "issue_item_id": progress["issue_id"],
                        "title": progress["title"],
                        "start_date": progress["start_date"],
                        "end_date": progress["end_date"],
                        "details": progress["details"],
                        "author_name": progress["author_name"],
                        "created_at": progress["created_at"],
                        "updated_at": progress["updated_at"],
                    }
                )

        for _, issue in issue_id_to_meta.values():
            issue.setdefault("full_issue_progresses", [])
            is_open_without_end = (
                issue.get("status") not in {"완료", "취소"}
                and not issue.get("end_date")
            )
            if issue["issue_progresses"] or is_open_without_end:
                issues_by_project.setdefault(issue["report_project_id"], []).append(issue)

    for project in projects:
        project["project_schedules"] = milestones_by_project.get(project["id"], [])
        project["issue_items"] = issues_by_project.get(project["id"], [])

    comments = conn.execute(
        """SELECT rc.*, u.name as user_name
           FROM report_comments rc
           JOIN users u ON u.id=rc.user_id
           WHERE rc.report_id=? AND rc.is_deleted=0
           ORDER BY rc.created_at""",
        (report_id,),
    ).fetchall()

    week_schedule = conn.execute(
        """SELECT ps.*, st.name as type_name
           FROM personal_schedule ps
           JOIN schedule_type st ON st.id=ps.type_id
           WHERE ps.user_id=? AND ps.start_date<=? AND ps.end_date>=?
           ORDER BY ps.start_date""",
        (report["owner_id"], week_end_str, week_start_str),
    ).fetchall()

    return {**report, "projects": projects, "comments": comments,
            "week_schedule": week_schedule}


# ── Routes ────────────────────────────────────────────────────────────────

@router.get("")
def list_reports(
    week_start: Optional[str] = None,
    owner_id: Optional[int] = None,
    status_id: Optional[int] = None,
    current_user=Depends(get_current_user),
):
    q = """SELECT r.*, u.name as owner_name, rs.name as status_name,
                  COALESCE(rs2.total_projects,0) as total_projects,
                  COALESCE(rs2.risk_count,0) as risk_count,
                  COALESCE(rs2.blocker_count,0) as blocker_count,
                  COALESCE(rs2.avg_completion,0) as avg_completion
           FROM reports r
           JOIN users u ON u.id=r.owner_id
           JOIN report_status rs ON rs.id=r.status_id
           LEFT JOIN report_summaries rs2 ON rs2.report_id=r.id
           WHERE r.is_deleted=0 AND u.is_deleted=0"""
    params: list = []
    if week_start:
        q += " AND r.week_start=?"; params.append(week_start)
    if owner_id:
        q += " AND r.owner_id=?"; params.append(owner_id)
    if status_id:
        q += " AND r.status_id=?"; params.append(status_id)
    q += " ORDER BY r.week_start DESC, u.name"
    with get_db() as conn:
        return conn.execute(q, params).fetchall()


@router.get("/{report_id}")
def get_report(report_id: int, current_user=Depends(get_current_user)):
    with get_db() as conn:
        return _full_report(conn, report_id)


@router.put("/{report_id}/projects")
def upsert_report_project(
    report_id: int,
    body: ReportProjectUpsert,
    current_user=Depends(get_current_user),
):
    with get_db() as conn:
        report = conn.execute(
            "SELECT * FROM reports WHERE id=? AND is_deleted=0", (report_id,)
        ).fetchone()
        if not report:
            raise HTTPException(404, "보고서를 찾을 수 없습니다")
        if report["owner_id"] != current_user["id"] and not current_user["is_admin"]:
            raise HTTPException(403, "본인의 보고서만 수정할 수 있습니다")
        if report["is_locked"] and not current_user["is_admin"]:
            raise HTTPException(423, "제출된 보고서는 수정할 수 없습니다")
        if not current_user["is_admin"]:
            assigned = conn.execute(
                "SELECT id FROM project_assignments WHERE project_id=? AND user_id=?",
                (body.project_id, report["owner_id"]),
            ).fetchone()
            if not assigned:
                raise HTTPException(403, "배정되지 않은 프로젝트입니다")

        conn.execute(
            """INSERT INTO report_projects
                   (report_id,project_id,schedule,progress,remarks,
                    risk_level,completion_pct,created_by,updated_by)
               VALUES(?,?,?,?,?,?,?,?,?)
               ON CONFLICT(report_id,project_id) DO UPDATE SET
                   schedule=excluded.schedule, progress=excluded.progress,
                   remarks=excluded.remarks, risk_level=excluded.risk_level,
                   completion_pct=excluded.completion_pct,
                   updated_by=excluded.updated_by""",
            (report_id, body.project_id, None, None, body.remarks,
             "normal", 0,
             current_user["id"], current_user["id"]),
        )
        conn.execute(
            "UPDATE projects SET status=?, updated_by=? WHERE id=?",
            (body.project_status, current_user["id"], body.project_id),
        )
        report_project = conn.execute(
            """SELECT id
               FROM report_projects
               WHERE report_id=? AND project_id=?""",
            (report_id, body.project_id),
        ).fetchone()
        report_project_id = report_project["id"]

        conn.execute("DELETE FROM project_schedule WHERE report_project_id=?", (report_project_id,))
        for item in body.project_schedules:
            title = item.title.strip()
            if not title:
                continue
            conn.execute(
                """INSERT INTO project_schedule
                       (report_project_id,title,start_date,end_date,created_by,updated_by)
                   VALUES(?,?,?,?,?,?)""",
                (
                    report_project_id,
                    title,
                    item.start_date,
                    item.end_date,
                    current_user["id"],
                    current_user["id"],
                ),
            )

        conn.execute("DELETE FROM issue_item WHERE report_project_id=?", (report_project_id,))
        for item in body.issue_items:
            title = item.title.strip()
            status = item.status.strip()
            details = item.details.strip() if item.details else None
            if not title or not status:
                continue
            conn.execute(
                """INSERT INTO issue_item
                       (report_project_id,title,status,start_date,end_date,details,created_by,updated_by)
                   VALUES(?,?,?,?,?,?,?,?)""",
                (
                    report_project_id,
                    title,
                    status,
                    item.start_date,
                    item.end_date,
                    details,
                    current_user["id"],
                    current_user["id"],
                ),
            )
            issue_item_id = conn.execute("SELECT last_insert_rowid() as id").fetchone()["id"]

            for progress in item.issue_progresses:
                progress_title = progress.title.strip()
                progress_details = progress.details.strip() if progress.details else None
                if not progress_title:
                    continue
                conn.execute(
                    """INSERT INTO issue_progress
                           (issue_item_id,title,start_date,end_date,details)
                       VALUES(?,?,?,?,?)""",
                    (
                        issue_item_id,
                        progress_title,
                        progress.start_date,
                        progress.end_date,
                        progress_details,
                    ),
                )

        projects = _full_report(conn, report_id)["projects"]
        return next((project for project in projects if project["project_id"] == body.project_id), None)


@router.delete("/{report_id}/projects/{project_id}")
def remove_report_project(
    report_id: int,
    project_id: int,
    current_user=Depends(get_current_user),
):
    with get_db() as conn:
        report = conn.execute(
            "SELECT * FROM reports WHERE id=? AND is_deleted=0", (report_id,)
        ).fetchone()
        if not report:
            raise HTTPException(404)
        if report["owner_id"] != current_user["id"] and not current_user["is_admin"]:
            raise HTTPException(403)
        conn.execute(
            "DELETE FROM report_projects WHERE report_id=? AND project_id=?",
            (report_id, project_id),
        )
    return {"ok": True}


@router.post("/{report_id}/submit")
def submit_report(report_id: int, current_user=Depends(get_current_user)):
    with get_db() as conn:
        report = conn.execute(
            "SELECT * FROM reports WHERE id=? AND is_deleted=0", (report_id,)
        ).fetchone()
        if not report:
            raise HTTPException(404)
        if report["owner_id"] != current_user["id"]:
            raise HTTPException(403)
        if report["status_id"] != 1:
            raise HTTPException(400, "초안 상태의 보고서만 제출할 수 있습니다")

        conn.execute(
            """UPDATE reports SET status_id=2, is_locked=1,
               submitted_at=CURRENT_TIMESTAMP, updated_by=? WHERE id=?""",
            (current_user["id"], report_id),
        )

        full_report = _full_report(conn, report_id)
        max_ver = conn.execute(
            "SELECT COALESCE(MAX(version_number),0) as v FROM report_versions "
            "WHERE report_id=?", (report_id,)
        ).fetchone()["v"]
        conn.execute(
            "INSERT INTO report_versions(report_id,version_number,snapshot_json,created_by) "
            "VALUES(?,?,?,?)",
            (report_id, max_ver + 1,
             json.dumps({"report": dict(report),
                         "projects": full_report["projects"]}),
             current_user["id"]),
        )

        for adm in conn.execute(
            "SELECT id FROM users WHERE is_admin=1 AND is_deleted=0 AND id!=?",
            (current_user["id"],),
        ).fetchall():
            conn.execute(
                """INSERT INTO notifications
                       (user_id,type,title,message,reference_type,reference_id)
                   VALUES(?,?,?,?,?,?)""",
                (adm["id"], "report_submitted",
                 f"{current_user['name']}이(가) 주간 보고서를 제출했습니다",
                 f"Week: {report['week_start']}", "report", report_id),
            )
        if current_user.get("manager_id"):
            conn.execute(
                """INSERT OR IGNORE INTO notifications
                       (user_id,type,title,message,reference_type,reference_id)
                   VALUES(?,?,?,?,?,?)""",
                (current_user["manager_id"], "report_submitted",
                 f"{current_user['name']}이(가) 주간 보고서를 제출했습니다",
                 f"Week: {report['week_start']}", "report", report_id),
            )
    return {"ok": True}


@router.post("/{report_id}/approve")
def approve_report(
    report_id: int,
    body: ReportAction,
    current_user=Depends(get_current_user),
):
    with get_db() as conn:
        report = conn.execute(
            "SELECT * FROM reports WHERE id=? AND is_deleted=0", (report_id,)
        ).fetchone()
        if not report:
            raise HTTPException(404)
        if report["status_id"] != 2:
            raise HTTPException(400, "제출된 보고서만 승인할 수 있습니다")

        conn.execute(
            """UPDATE reports SET status_id=3, approved_at=CURRENT_TIMESTAMP,
               approved_by=?, manager_comment=?, updated_by=? WHERE id=?""",
            (current_user["id"], body.manager_comment, current_user["id"], report_id),
        )
        conn.execute(
            "INSERT INTO report_approvals(report_id,approver_id,level,status,comments) "
            "VALUES(?,?,1,'approved',?)",
            (report_id, current_user["id"], body.manager_comment),
        )
        conn.execute(
            "INSERT INTO notifications(user_id,type,title,reference_type,reference_id) "
            "VALUES(?,?,?,?,?)",
            (report["owner_id"], "report_approved", "보고서가 승인되었습니다",
             "report", report_id),
        )
    return {"ok": True}


@router.post("/{report_id}/reject")
def reject_report(
    report_id: int,
    body: ReportAction,
    current_user=Depends(get_current_user),
):
    with get_db() as conn:
        report = conn.execute(
            "SELECT * FROM reports WHERE id=? AND is_deleted=0", (report_id,)
        ).fetchone()
        if not report:
            raise HTTPException(404)

        conn.execute(
            """UPDATE reports SET status_id=4, is_locked=0,
               manager_comment=?, updated_by=? WHERE id=?""",
            (body.manager_comment, current_user["id"], report_id),
        )
        conn.execute(
            "INSERT INTO report_approvals(report_id,approver_id,level,status,comments) "
            "VALUES(?,?,1,'rejected',?)",
            (report_id, current_user["id"], body.manager_comment),
        )
        conn.execute(
            "INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id) "
            "VALUES(?,?,?,?,?,?)",
            (report["owner_id"], "report_rejected", "보고서가 반려되었습니다",
             body.manager_comment or "", "report", report_id),
        )
    return {"ok": True}


@router.post("/{report_id}/comments")
def add_comment(
    report_id: int,
    body: CommentCreate,
    current_user=Depends(get_current_user),
):
    with get_db() as conn:
        conn.execute(
            """INSERT INTO report_comments
                   (report_id,user_id,parent_comment_id,comment,created_by,updated_by)
               VALUES(?,?,?,?,?,?)""",
            (report_id, current_user["id"], body.parent_comment_id,
             body.comment, current_user["id"], current_user["id"]),
        )
        cid = conn.execute("SELECT last_insert_rowid() as id").fetchone()["id"]

        for name in re.findall(r"@(\S+)", body.comment):
            user = conn.execute(
                "SELECT id FROM users WHERE name=? AND is_deleted=0", (name,)
            ).fetchone()
            if user and user["id"] != current_user["id"]:
                try:
                    conn.execute(
                        "INSERT INTO comment_mentions(comment_id,mentioned_user_id) "
                        "VALUES(?,?)",
                        (cid, user["id"]),
                    )
                except Exception:
                    pass

        return conn.execute(
            "SELECT rc.*, u.name as user_name FROM report_comments rc "
            "JOIN users u ON u.id=rc.user_id WHERE rc.id=?",
            (cid,),
        ).fetchone()
