from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import date, timedelta

from ..core.deps import get_current_user
from ..db.session import get_db

router = APIRouter(prefix="/api/schedule", tags=["schedule"])


class ScheduleCreate(BaseModel):
    type_id: int
    start_date: str
    end_date: str
    location: Optional[str] = None
    details: Optional[str] = None


@router.get("")
def list_schedule(
    year: Optional[int] = None,
    month: Optional[int] = None,
    current_user=Depends(get_current_user),
):
    q = """SELECT ps.*, st.name as type_name
           FROM personal_schedule ps
           JOIN schedule_type st ON st.id=ps.type_id
           WHERE ps.user_id=?"""
    params: list = [current_user["id"]]
    if year and month:
        first = f"{year:04d}-{month:02d}-01"
        last_day = (date(year, month % 12 + 1, 1) - timedelta(days=1)).day if month < 12 else 31
        last = f"{year:04d}-{month:02d}-{last_day:02d}"
        q += " AND ps.start_date<=? AND ps.end_date>=?"
        params += [last, first]
    q += " ORDER BY ps.start_date"
    with get_db() as conn:
        return conn.execute(q, params).fetchall()


@router.post("")
def create_schedule(body: ScheduleCreate, current_user=Depends(get_current_user)):
    if body.end_date < body.start_date:
        raise HTTPException(400, "종료일은 시작일보다 같거나 늦어야 합니다")
    with get_db() as conn:
        conn.execute(
            """INSERT INTO personal_schedule(user_id,type_id,start_date,end_date,location,details)
               VALUES(?,?,?,?,?,?)""",
            (current_user["id"], body.type_id, body.start_date,
             body.end_date, body.location, body.details),
        )
        sid = conn.execute("SELECT last_insert_rowid() as id").fetchone()["id"]
        return conn.execute(
            """SELECT ps.*, st.name as type_name
               FROM personal_schedule ps
               JOIN schedule_type st ON st.id=ps.type_id WHERE ps.id=?""",
            (sid,),
        ).fetchone()


@router.put("/{schedule_id}")
def update_schedule(
    schedule_id: int,
    body: ScheduleCreate,
    current_user=Depends(get_current_user),
):
    if body.end_date < body.start_date:
        raise HTTPException(400, "종료일은 시작일보다 같거나 늦어야 합니다")
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM personal_schedule WHERE id=?", (schedule_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404)
        if row["user_id"] != current_user["id"] and not current_user["is_admin"]:
            raise HTTPException(403)
        conn.execute(
            """UPDATE personal_schedule
               SET type_id=?,start_date=?,end_date=?,location=?,details=?
               WHERE id=?""",
            (body.type_id, body.start_date, body.end_date,
             body.location, body.details, schedule_id),
        )
        return conn.execute(
            """SELECT ps.*, st.name as type_name
               FROM personal_schedule ps
               JOIN schedule_type st ON st.id=ps.type_id WHERE ps.id=?""",
            (schedule_id,),
        ).fetchone()


@router.delete("/{schedule_id}")
def delete_schedule(schedule_id: int, current_user=Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM personal_schedule WHERE id=?", (schedule_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404)
        if row["user_id"] != current_user["id"] and not current_user["is_admin"]:
            raise HTTPException(403)
        conn.execute("DELETE FROM personal_schedule WHERE id=?", (schedule_id,))
    return {"ok": True}
