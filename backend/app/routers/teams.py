from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.deps import get_current_user
from ..db.session import get_db

router = APIRouter(prefix="/api/teams", tags=["teams"])


class TeamCreate(BaseModel):
    name: str
    department_id: int
    parent_team_id: Optional[int] = None
    manager_id: Optional[int] = None


class TeamUpdate(BaseModel):
    name: str
    department_id: int
    parent_team_id: Optional[int] = None
    manager_id: Optional[int] = None


class TeamMemberUpdate(BaseModel):
    user_ids: list[int]


@router.get("")
def list_teams(current_user=Depends(get_current_user)):
    with get_db() as conn:
        teams = conn.execute(
            """SELECT t.id, t.name, t.department_id, t.parent_team_id, t.manager_id,
                      d.name as department_name,
                      m.name as manager_name,
                      pt.name as parent_team_name
               FROM teams t
               JOIN departments d ON d.id=t.department_id
               LEFT JOIN users m ON m.id=t.manager_id
               LEFT JOIN teams pt ON pt.id=t.parent_team_id
               WHERE t.is_deleted=0
               ORDER BY d.name, t.name"""
        ).fetchall()

        members = conn.execute(
            """SELECT utr.team_id, utr.user_id, utr.role, utr.primary_team,
                      u.name, u.rank_id, r.name as rank_name
               FROM user_team_roles utr
               JOIN users u ON u.id=utr.user_id AND u.is_deleted=0
               JOIN ranks r ON r.id=u.rank_id
               ORDER BY r.sort_order DESC, u.name"""
        ).fetchall()

        members_by_team: dict = {}
        for m in members:
            tid = m["team_id"]
            if tid not in members_by_team:
                members_by_team[tid] = []
            members_by_team[tid].append(dict(m))

        result = []
        for t in teams:
            td = dict(t)
            td["members"] = members_by_team.get(t["id"], [])
            result.append(td)

        departments = conn.execute(
            "SELECT * FROM departments WHERE is_deleted=0 ORDER BY name"
        ).fetchall()

        return {"teams": result, "departments": [dict(d) for d in departments]}


@router.post("")
def create_team(body: TeamCreate, current_user=Depends(get_current_user)):
    if not current_user["is_admin"]:
        raise HTTPException(403, "관리자 권한이 필요합니다")
    with get_db() as conn:
        cursor = conn.execute(
            """INSERT INTO teams(name, department_id, parent_team_id, manager_id)
               VALUES(?,?,?,?)""",
            (body.name, body.department_id, body.parent_team_id, body.manager_id),
        )
        new_id = cursor.lastrowid
        return conn.execute(
            """SELECT t.*, d.name as department_name
               FROM teams t JOIN departments d ON d.id=t.department_id
               WHERE t.id=?""",
            (new_id,),
        ).fetchone()


@router.put("/{team_id}")
def update_team(team_id: int, body: TeamUpdate, current_user=Depends(get_current_user)):
    if not current_user["is_admin"]:
        raise HTTPException(403, "관리자 권한이 필요합니다")
    if body.parent_team_id == team_id:
        raise HTTPException(400, "팀은 자기 자신의 상위 팀이 될 수 없습니다")
    with get_db() as conn:
        conn.execute(
            """UPDATE teams SET name=?, department_id=?, parent_team_id=?, manager_id=?
               WHERE id=? AND is_deleted=0""",
            (body.name, body.department_id, body.parent_team_id, body.manager_id, team_id),
        )
        return conn.execute(
            """SELECT t.*, d.name as department_name
               FROM teams t JOIN departments d ON d.id=t.department_id
               WHERE t.id=?""",
            (team_id,),
        ).fetchone()


@router.delete("/{team_id}")
def delete_team(team_id: int, current_user=Depends(get_current_user)):
    if not current_user["is_admin"]:
        raise HTTPException(403, "관리자 권한이 필요합니다")
    with get_db() as conn:
        conn.execute(
            "UPDATE teams SET is_deleted=1 WHERE id=? AND is_deleted=0", (team_id,)
        )
    return {"ok": True}


@router.put("/{team_id}/members")
def update_team_members(team_id: int, body: TeamMemberUpdate, current_user=Depends(get_current_user)):
    if not current_user["is_admin"]:
        raise HTTPException(403, "관리자 권한이 필요합니다")
    with get_db() as conn:
        # Remove members not in the new list
        conn.execute(
            "DELETE FROM user_team_roles WHERE team_id=?", (team_id,)
        )
        for uid in body.user_ids:
            conn.execute(
                """INSERT OR IGNORE INTO user_team_roles(user_id, team_id, role, primary_team)
                   VALUES(?, ?, 'member', 0)""",
                (uid, team_id),
            )
    return {"ok": True}


# ─── Departments ─────────────────────────────────────────────────────────────

class DepartmentCreate(BaseModel):
    name: str
    code: Optional[str] = None
    parent_id: Optional[int] = None


class DepartmentUpdate(BaseModel):
    name: str
    code: Optional[str] = None
    parent_id: Optional[int] = None


@router.post("/departments")
def create_department(body: DepartmentCreate, current_user=Depends(get_current_user)):
    if not current_user["is_admin"]:
        raise HTTPException(403, "관리자 권한이 필요합니다")
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM departments WHERE name=? AND is_deleted=0", (body.name,)
        ).fetchone()
        if existing:
            raise HTTPException(400, "이미 존재하는 부서 이름입니다")
        cursor = conn.execute(
            "INSERT INTO departments(name, code, parent_id) VALUES(?,?,?)",
            (body.name, body.code or None, body.parent_id),
        )
        new_id = cursor.lastrowid
        return conn.execute("SELECT * FROM departments WHERE id=?", (new_id,)).fetchone()


@router.put("/departments/{dept_id}")
def update_department(dept_id: int, body: DepartmentUpdate, current_user=Depends(get_current_user)):
    if not current_user["is_admin"]:
        raise HTTPException(403, "관리자 권한이 필요합니다")
    with get_db() as conn:
        duplicate = conn.execute(
            "SELECT id FROM departments WHERE name=? AND id!=? AND is_deleted=0", (body.name, dept_id)
        ).fetchone()
        if duplicate:
            raise HTTPException(400, "이미 존재하는 부서 이름입니다")
        conn.execute(
            "UPDATE departments SET name=?, code=?, parent_id=? WHERE id=? AND is_deleted=0",
            (body.name, body.code or None, body.parent_id, dept_id),
        )
        return conn.execute("SELECT * FROM departments WHERE id=?", (dept_id,)).fetchone()


@router.delete("/departments/{dept_id}")
def delete_department(dept_id: int, current_user=Depends(get_current_user)):
    if not current_user["is_admin"]:
        raise HTTPException(403, "관리자 권한이 필요합니다")
    with get_db() as conn:
        in_use = conn.execute(
            "SELECT id FROM teams WHERE department_id=? AND is_deleted=0 LIMIT 1", (dept_id,)
        ).fetchone()
        if in_use:
            raise HTTPException(400, "이 부서에 속한 팀이 있어 삭제할 수 없습니다")
        conn.execute("UPDATE departments SET is_deleted=1 WHERE id=?", (dept_id,))
    return {"ok": True}


@router.get("/{team_id}/members-recursive")
def get_team_members_recursive(team_id: int, current_user=Depends(get_current_user)):
    """Return all members of a team and all its sub-teams."""
    with get_db() as conn:
        def collect_team_ids(tid: int) -> list[int]:
            ids = [tid]
            children = conn.execute(
                "SELECT id FROM teams WHERE parent_team_id=? AND is_deleted=0", (tid,)
            ).fetchall()
            for child in children:
                ids.extend(collect_team_ids(child["id"]))
            return ids

        team_ids = collect_team_ids(team_id)
        placeholders = ",".join("?" * len(team_ids))
        members = conn.execute(
            f"""SELECT DISTINCT u.id, u.name, u.rank_id, r.name as rank_name,
                       utr.team_id, utr.role, utr.primary_team
                FROM user_team_roles utr
                JOIN users u ON u.id=utr.user_id AND u.is_deleted=0
                JOIN ranks r ON r.id=u.rank_id
                WHERE utr.team_id IN ({placeholders})
                ORDER BY r.sort_order DESC, u.name""",
            team_ids,
        ).fetchall()
        return [dict(m) for m in members]
