from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.deps import get_current_user
from ..db.session import get_db

router = APIRouter(prefix="/api/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    project_name: str
    wbs_number: Optional[str] = None
    solution_product: Optional[str] = None
    company: str
    location: str
    status: str = "active"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    assignee_ids: Optional[List[int]] = None


def _with_assignees(conn, projects: list) -> list:
    result = []
    for p in projects:
        assignees = conn.execute(
            """SELECT u.id, u.name, r.name as rank_name
               FROM project_assignments pa
               JOIN users u ON u.id=pa.user_id
               JOIN ranks r ON r.id=u.rank_id
               WHERE pa.project_id=? AND u.is_deleted=0
               ORDER BY u.name""",
            (p["id"],),
        ).fetchall()
        result.append({**p, "assignees": assignees})
    return result


@router.get("")
def list_projects(
    status: Optional[str] = None,
    q: Optional[str] = None,
    mine: Optional[bool] = None,
    current_user=Depends(get_current_user),
):
    query = """SELECT p.*, d.name as dept_name
               FROM projects p
               LEFT JOIN departments d ON d.id=p.department_id
               WHERE p.is_deleted=0"""
    params: list = []
    if mine:
        query += """ AND EXISTS (
            SELECT 1 FROM project_assignments pa
            WHERE pa.project_id=p.id AND pa.user_id=?)"""
        params.append(current_user["id"])
    if status:
        query += " AND p.status=?"; params.append(status)
    if q:
        query += " AND p.project_name LIKE ?"; params.append(f"%{q}%")
    query += " ORDER BY p.project_name"

    with get_db() as conn:
        projects = conn.execute(query, params).fetchall()
        return _with_assignees(conn, projects)


@router.post("")
def create_project(body: ProjectCreate, current_user=Depends(get_current_user)):
    with get_db() as conn:
        conn.execute(
            """INSERT INTO projects
                   (project_name,wbs_number,solution_product,company,location,
                    status,start_date,end_date,created_by,updated_by)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (body.project_name, body.wbs_number, body.solution_product,
             body.company, body.location, body.status,
             body.start_date, body.end_date,
             current_user["id"], current_user["id"]),
        )
        pid = conn.execute("SELECT last_insert_rowid() as id").fetchone()["id"]
        if body.assignee_ids:
            for uid in body.assignee_ids:
                try:
                    conn.execute(
                        "INSERT INTO project_assignments(project_id,user_id) VALUES(?,?)",
                        (pid, uid),
                    )
                except Exception:
                    pass
        return conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()


@router.put("/{project_id}")
def update_project(
    project_id: int,
    body: ProjectCreate,
    current_user=Depends(get_current_user),
):
    with get_db() as conn:
        conn.execute(
            """UPDATE projects
               SET project_name=?,wbs_number=?,solution_product=?,
                   company=?,location=?,status=?,start_date=?,end_date=?,
                   updated_by=?
               WHERE id=? AND is_deleted=0""",
            (body.project_name, body.wbs_number, body.solution_product,
             body.company, body.location, body.status,
             body.start_date, body.end_date,
             current_user["id"], project_id),
        )
        if body.assignee_ids is not None:
            conn.execute(
                "DELETE FROM project_assignments WHERE project_id=?", (project_id,)
            )
            for uid in body.assignee_ids:
                try:
                    conn.execute(
                        "INSERT INTO project_assignments(project_id,user_id) VALUES(?,?)",
                        (project_id, uid),
                    )
                except Exception:
                    pass
        return conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
