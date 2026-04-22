from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.deps import get_current_user
from ..core.security import verify_password, hash_password
from ..db.session import get_db

router = APIRouter(prefix="/api/users", tags=["users"])


class UserCreate(BaseModel):
    name: str
    email: str
    employee_id: str
    rank_id: int
    manager_id: Optional[int] = None
    phone: Optional[str] = None
    locale: str = "ko"
    is_admin: int = 0
    password: str


class UserUpdate(BaseModel):
    name: str
    email: str
    employee_id: str
    rank_id: int
    manager_id: Optional[int] = None
    phone: Optional[str] = None
    locale: str = "ko"
    is_admin: int = 0
    new_password: Optional[str] = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


@router.get("")
def list_users(current_user=Depends(get_current_user)):
    with get_db() as conn:
        return conn.execute(
            """SELECT u.id, u.name, u.email, u.employee_id, u.rank_id,
                      u.manager_id, u.phone, u.locale,
                      u.is_admin, u.is_deleted, u.last_login_at,
                      r.name as rank_name,
                      m.name as manager_name,
                      d.name as department_name
               FROM users u
               JOIN ranks r ON r.id=u.rank_id
               LEFT JOIN users m ON m.id=u.manager_id
               LEFT JOIN user_team_roles utr ON utr.user_id=u.id AND utr.primary_team=1
               LEFT JOIN teams t ON t.id=utr.team_id
               LEFT JOIN departments d ON d.id=t.department_id
               WHERE u.is_deleted=0
               ORDER BY r.sort_order DESC, u.name"""
        ).fetchall()


@router.post("")
def create_user(body: UserCreate, current_user=Depends(get_current_user)):
    if not current_user["is_admin"]:
        raise HTTPException(403, "관리자 권한이 필요합니다")
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM users WHERE email=? AND is_deleted=0", (body.email,)
        ).fetchone()
        if existing:
            raise HTTPException(400, "이미 사용 중인 이메일입니다")
        cursor = conn.execute(
            """INSERT INTO users(name,email,employee_id,rank_id,manager_id,phone,locale,is_admin,password_hash,created_by)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (body.name, body.email, body.employee_id, body.rank_id,
             body.manager_id, body.phone, body.locale, body.is_admin,
             hash_password(body.password), current_user["id"]),
        )
        new_id = cursor.lastrowid
        return conn.execute(
            "SELECT u.*, r.name as rank_name FROM users u JOIN ranks r ON r.id=u.rank_id WHERE u.id=?",
            (new_id,),
        ).fetchone()


@router.delete("/{user_id}")
def delete_user(user_id: int, current_user=Depends(get_current_user)):
    if not current_user["is_admin"]:
        raise HTTPException(403, "관리자 권한이 필요합니다")
    if user_id == current_user["id"]:
        raise HTTPException(400, "자기 자신은 삭제할 수 없습니다")
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET is_deleted=1, updated_by=? WHERE id=? AND is_deleted=0",
            (current_user["id"], user_id),
        )
    return {"ok": True}


@router.put("/{user_id}")
def update_user(
    user_id: int,
    body: UserUpdate,
    current_user=Depends(get_current_user),
):
    if not current_user["is_admin"]:
        raise HTTPException(403, "관리자 권한이 필요합니다")
    with get_db() as conn:
        conn.execute(
            """UPDATE users
               SET name=?,email=?,employee_id=?,rank_id=?,
                   manager_id=?,phone=?,locale=?,is_admin=?,updated_by=?
               WHERE id=? AND is_deleted=0""",
            (body.name, body.email, body.employee_id, body.rank_id,
             body.manager_id, body.phone, body.locale, body.is_admin,
             current_user["id"], user_id),
        )
        if body.new_password:
            conn.execute(
                "UPDATE users SET password_hash=? WHERE id=?",
                (hash_password(body.new_password), user_id),
            )
        return conn.execute(
            "SELECT u.*, r.name as rank_name FROM users u "
            "JOIN ranks r ON r.id=u.rank_id WHERE u.id=?",
            (user_id,),
        ).fetchone()


@router.post("/change-password")
def change_password(body: PasswordChange, current_user=Depends(get_current_user)):
    with get_db() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE id=?", (current_user["id"],)
        ).fetchone()
        if not verify_password(body.current_password, user["password_hash"]):
            raise HTTPException(400, "현재 비밀번호가 올바르지 않습니다")
        conn.execute(
            "UPDATE users SET password_hash=? WHERE id=?",
            (hash_password(body.new_password), current_user["id"]),
        )
    return {"ok": True}
