from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm

from ..core.config import KST
from ..core.security import verify_password, create_access_token
from ..core.deps import get_current_user
from ..db.session import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/token")
def login(form: OAuth2PasswordRequestForm = Depends()):
    with get_db() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE email=? AND is_deleted=0", (form.username,)
        ).fetchone()
    if not user or not verify_password(form.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다")

    token = create_access_token({"sub": user["id"]})
    kst_now = datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S")
    with get_db() as conn:
        conn.execute("UPDATE users SET last_login_at=? WHERE id=?", (kst_now, user["id"]))

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "is_admin": user["is_admin"],
        },
    }


@router.get("/me")
def me(current_user=Depends(get_current_user)):
    with get_db() as conn:
        dept = conn.execute(
            """SELECT d.name FROM user_team_roles utr
               JOIN teams t ON t.id=utr.team_id
               JOIN departments d ON d.id=t.department_id
               WHERE utr.user_id=? AND utr.primary_team=1""",
            (current_user["id"],),
        ).fetchone()
    return {**current_user, "department": dept["name"] if dept else None}
