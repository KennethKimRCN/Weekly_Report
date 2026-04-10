from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from .security import decode_token
from ..db.session import get_db

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


def get_current_user(token: str = Depends(oauth2_scheme)):
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="인증 정보를 확인할 수 없습니다",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
        raw_sub = payload.get("sub")
        if raw_sub is None:
            raise exc
        user_id = int(raw_sub)
    except (JWTError, ValueError, TypeError):
        raise exc

    with get_db() as conn:
        user = conn.execute(
            "SELECT u.*, r.name as rank_name "
            "FROM users u JOIN ranks r ON r.id=u.rank_id "
            "WHERE u.id=? AND u.is_deleted=0",
            (user_id,),
        ).fetchone()
    if user is None:
        raise exc
    return user


def require_admin(current_user=Depends(get_current_user)):
    if not current_user["is_admin"]:
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다")
    return current_user
