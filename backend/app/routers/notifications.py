from fastapi import APIRouter, Depends

from ..core.deps import get_current_user
from ..db.session import get_db

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
def get_notifications(current_user=Depends(get_current_user)):
    with get_db() as conn:
        return conn.execute(
            """SELECT * FROM notifications
               WHERE user_id=? AND is_deleted=0
               ORDER BY created_at DESC LIMIT 50""",
            (current_user["id"],),
        ).fetchall()


@router.post("/read-all")
def read_all(current_user=Depends(get_current_user)):
    with get_db() as conn:
        conn.execute(
            "UPDATE notifications SET is_read=1 WHERE user_id=? AND is_deleted=0",
            (current_user["id"],),
        )
    return {"ok": True}


@router.patch("/{notif_id}/read")
def read_one(notif_id: int, current_user=Depends(get_current_user)):
    with get_db() as conn:
        conn.execute(
            "UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?",
            (notif_id, current_user["id"]),
        )
    return {"ok": True}
