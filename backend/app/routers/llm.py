import json
from typing import Optional
from urllib import error, request

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ..core.config import LLM_BASE_URL, LLM_MODEL, LLM_TIMEOUT_SECONDS
from ..core.deps import get_current_user, require_admin
from ..db.session import get_db
from .reports import _full_report

router = APIRouter(prefix="/api/llm", tags=["llm"])

DEFAULT_SYSTEM_PROMPT = (
    "You are an assistant that writes concise Korean weekly project summaries for an internal report. "
    "Compare the current week against the previous week, focus on issue movement, meaningful progress, "
    "newly added work, and items that still need attention. When you mention a current-week issue, use its exact issue title verbatim so the UI can link it. "
    'Return only valid JSON with this exact shape: {"summary":"2-4 sentence Korean summary","highlights":["bullet 1","bullet 2","bullet 3"]}.'
)


class LlmSettingsUpdate(BaseModel):
    base_url: str
    model: str
    timeout_seconds: float
    system_prompt: str


def _get_llm_settings(conn) -> dict:
    row = conn.execute(
        "SELECT id, base_url, model, timeout_seconds, system_prompt, updated_at, updated_by FROM llm_settings WHERE id=1"
    ).fetchone()
    if row:
        return dict(row)
    return {
        "id": 1,
        "base_url": LLM_BASE_URL,
        "model": LLM_MODEL,
        "timeout_seconds": LLM_TIMEOUT_SECONDS,
        "system_prompt": DEFAULT_SYSTEM_PROMPT,
        "updated_at": None,
        "updated_by": None,
    }


def _fetch_models(settings: dict) -> list[str]:
    req = request.Request(
        f"{settings['base_url'].rstrip('/')}/models",
        method="GET",
    )
    req.add_unredirected_header("Content-Type", "application/json")
    with request.urlopen(req, timeout=min(10, float(settings["timeout_seconds"]))) as response:
        raw = response.read().decode("utf-8")
    data = json.loads(raw)
    if not isinstance(data, dict) or not isinstance(data.get("data"), list):
        raise ValueError("Invalid model list response.")
    models: list[str] = []
    for item in data["data"]:
        if isinstance(item, dict):
            model_id = item.get("id")
            if isinstance(model_id, str) and model_id.strip():
                models.append(model_id.strip())
    return sorted(set(models), key=str.lower)


def _check_llm_available(settings: dict) -> tuple[bool, str | None]:
    try:
        _fetch_models(settings)
        return True, None
    except (error.URLError, error.HTTPError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
        return False, str(exc)


def _project_snapshot(report: dict) -> list[dict]:
    projects: list[dict] = []
    for project in report.get("projects", []):
        issues = []
        for issue in project.get("issue_items", []):
            progresses = []
            for progress in issue.get("issue_progresses", []):
                progresses.append(
                    {
                        "title": progress.get("title"),
                        "start_date": progress.get("start_date"),
                        "end_date": progress.get("end_date"),
                        "details": progress.get("details"),
                        "author_name": progress.get("author_name"),
                    }
                )
            issues.append(
                {
                    "title": issue.get("title"),
                    "status": issue.get("status"),
                    "priority": issue.get("priority"),
                    "start_date": issue.get("start_date"),
                    "end_date": issue.get("end_date"),
                    "details": issue.get("details"),
                    "progresses": progresses,
                }
            )
        projects.append(
            {
                "project_name": project.get("project_name"),
                "solution_product": project.get("solution_product"),
                "remarks": project.get("remarks"),
                "project_status": project.get("project_status"),
                "issues": issues,
            }
        )
    return projects


def _build_fallback_summary(current_report: dict, previous_report: dict | None) -> dict:
    current_projects = current_report.get("projects", [])
    previous_projects = previous_report.get("projects", []) if previous_report else []
    current_issue_count = sum(len(project.get("issue_items", [])) for project in current_projects)
    previous_issue_count = sum(len(project.get("issue_items", [])) for project in previous_projects)
    current_progress_count = sum(
        len(issue.get("issue_progresses", []))
        for project in current_projects
        for issue in project.get("issue_items", [])
    )
    previous_progress_count = sum(
        len(issue.get("issue_progresses", []))
        for project in previous_projects
        for issue in project.get("issue_items", [])
    )

    current_titles = {
        issue.get("title")
        for project in current_projects
        for issue in project.get("issue_items", [])
        if issue.get("title")
    }
    previous_titles = {
        issue.get("title")
        for project in previous_projects
        for issue in project.get("issue_items", [])
        if issue.get("title")
    }

    new_titles = sorted(current_titles - previous_titles)[:3]
    ongoing_titles = sorted(current_titles & previous_titles)[:3]

    highlights = [
        f"이번 주 이슈 {current_issue_count}건, 진행내역 {current_progress_count}건이 집계되었습니다.",
    ]
    if previous_report:
        highlights.append(
            f"지난주 대비 이슈는 {current_issue_count - previous_issue_count:+d}건, 진행내역은 {current_progress_count - previous_progress_count:+d}건 변화했습니다."
        )
    if new_titles:
        highlights.append(f"새롭게 부각된 이슈: {', '.join(new_titles)}")
    if ongoing_titles:
        highlights.append(f"연속 추적 중인 이슈: {', '.join(ongoing_titles)}")

    return {
        "summary": (
            f"{current_report.get('week_start')} 주간에는 {len(current_projects)}개 프로젝트를 기준으로 "
            f"이슈 {current_issue_count}건과 진행내역 {current_progress_count}건을 정리했습니다."
        ),
        "highlights": highlights,
        "source": "fallback",
        "model": None,
        "previous_week_start": previous_report.get("week_start") if previous_report else None,
    }


@router.get("/status")
def llm_status(current_user=Depends(get_current_user)):
    with get_db() as conn:
        settings = _get_llm_settings(conn)
    available, error_message = _check_llm_available(settings)
    return {
        "available": available,
        "model": settings["model"] if available else settings["model"],
        "base_url": settings["base_url"],
        "error": error_message,
    }


@router.get("/system-prompt")
def get_system_prompt(current_user=Depends(get_current_user)):
    """Public endpoint — returns only the system prompt, safe for all authenticated users."""
    with get_db() as conn:
        settings = _get_llm_settings(conn)
    return {"system_prompt": settings.get("system_prompt") or DEFAULT_SYSTEM_PROMPT}


@router.get("/settings")
def get_llm_settings(current_user=Depends(require_admin)):
    with get_db() as conn:
        return _get_llm_settings(conn)


@router.get("/models")
def get_llm_models(
    base_url: Optional[str] = Query(default=None),
    timeout_seconds: Optional[float] = Query(default=None),
    current_user=Depends(require_admin),
):
    with get_db() as conn:
        settings = _get_llm_settings(conn)
    if base_url is not None and base_url.strip():
        settings["base_url"] = base_url.strip()
    if timeout_seconds is not None:
        settings["timeout_seconds"] = timeout_seconds
    try:
        return {"models": _fetch_models(settings)}
    except (error.URLError, error.HTTPError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(502, str(exc))


@router.put("/settings")
def update_llm_settings(body: LlmSettingsUpdate, current_user=Depends(require_admin)):
    base_url = body.base_url.strip()
    model = body.model.strip()
    timeout_seconds = float(body.timeout_seconds)
    system_prompt = body.system_prompt.strip()
    if not base_url:
        raise HTTPException(400, "base_url is required.")
    if not model:
        raise HTTPException(400, "model is required.")
    if timeout_seconds <= 0:
        raise HTTPException(400, "timeout_seconds must be greater than 0.")
    if not system_prompt:
        raise HTTPException(400, "system_prompt is required.")

    with get_db() as conn:
        conn.execute(
            """INSERT INTO llm_settings(id, base_url, model, timeout_seconds, system_prompt, updated_by)
               VALUES(1, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                   base_url=excluded.base_url,
                   model=excluded.model,
                   timeout_seconds=excluded.timeout_seconds,
                   system_prompt=excluded.system_prompt,
                   updated_at=CURRENT_TIMESTAMP,
                   updated_by=excluded.updated_by""",
            (base_url, model, timeout_seconds, system_prompt, current_user["id"]),
        )
        return _get_llm_settings(conn)


def _extract_json_block(content: str) -> dict:
    text = content.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if len(lines) >= 3:
            text = "\n".join(lines[1:-1]).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("No JSON object found in model response.")
    return json.loads(text[start : end + 1])


def _call_llm(payload: dict, settings: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = request.Request(
        f"{settings['base_url'].rstrip('/')}/chat/completions",
        data=body,
        method="POST",
    )
    # urllib capitalizes only the first letter of header names passed to the constructor
    # (e.g. "Content-Type" becomes "Content-type"), which causes LM Studio to reject the
    # request. add_unredirected_header() bypasses that normalization and sends the exact
    # casing specified.
    req.add_unredirected_header("Content-Type", "application/json")
    try:
        with request.urlopen(req, timeout=float(settings["timeout_seconds"])) as response:
            raw = response.read().decode("utf-8")
    except error.HTTPError as e:
        raw_err = e.read().decode("utf-8", errors="replace")
        raise ValueError(f"LM Studio returned HTTP {e.code}: {raw_err[:300]}") from e
    data = json.loads(raw)
    choices = data.get("choices") or []
    if not choices:
        raise ValueError("LLM response did not include any choices.")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("LLM response content was empty.")
    parsed = _extract_json_block(content)
    summary = str(parsed.get("summary", "")).strip()
    highlights = parsed.get("highlights") or []
    if not summary:
        raise ValueError("LLM response did not contain a summary.")
    if not isinstance(highlights, list):
        raise ValueError("LLM response highlights were not a list.")
    clean_highlights = [str(item).strip() for item in highlights if str(item).strip()][:5]
    return {
        "summary": summary,
        "highlights": clean_highlights,
        "source": "llm",
        "model": data.get("model") or settings["model"],
    }


def _is_e2b_model(model_name: str) -> bool:
    normalized = model_name.strip().lower()
    return "gemma-4-e2b" in normalized


class SummaryRequest(BaseModel):
    system_prompt: Optional[str] = None


@router.post("/reports/{report_id}/summary")
def generate_report_summary(
    report_id: int,
    body: SummaryRequest = None,
    current_user=Depends(get_current_user),
):
    body = body or SummaryRequest()
    with get_db() as conn:
        settings = _get_llm_settings(conn)
        report_row = conn.execute(
            "SELECT id, owner_id, week_start FROM reports WHERE id=? AND is_deleted=0",
            (report_id,),
        ).fetchone()
        if not report_row:
            raise HTTPException(404, "Report not found.")
        if report_row["owner_id"] != current_user["id"] and not current_user["is_admin"]:
            raise HTTPException(403, "You do not have access to this report.")

        current_report = _full_report(conn, report_id)
        previous_row = conn.execute(
            """SELECT id
               FROM reports
               WHERE owner_id=? AND week_start < ? AND is_deleted=0
               ORDER BY week_start DESC
               LIMIT 1""",
            (report_row["owner_id"], report_row["week_start"]),
        ).fetchone()
        previous_report = _full_report(conn, previous_row["id"]) if previous_row else None

    prompt_payload = {
        "current_week": current_report.get("week_start"),
        "previous_week": previous_report.get("week_start") if previous_report else None,
        "owner_name": current_report.get("owner_name"),
        "current_projects": _project_snapshot(current_report),
        "previous_projects": _project_snapshot(previous_report) if previous_report else [],
    }

    # Prefer caller-supplied prompt (unsaved edits); fall back to DB, then hardcoded default.
    system_prompt = (body.system_prompt or "").strip() or settings.get("system_prompt") or DEFAULT_SYSTEM_PROMPT
    user_prompt = (
        "현재 주차와 지난 주차 프로젝트 이슈 및 진행내역을 비교해 주세요. "
        "문장은 자연스러운 한국어로 작성하고, 과장 없이 사실 기반으로 요약하세요.\n\n"
        f"{json.dumps(prompt_payload, ensure_ascii=False, indent=2)}"
    )

    fallback = _build_fallback_summary(current_report, previous_report)
    try:
        primary_payload = {
            "model": settings["model"],
            "temperature": 0.2,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        llm_result = _call_llm(primary_payload, settings)
        return {
            **llm_result,
            "previous_week_start": fallback["previous_week_start"],
        }
    except (error.URLError, error.HTTPError, TimeoutError, ValueError, json.JSONDecodeError):
        if _is_e2b_model(settings["model"]):
            pass  # fall through to e2b retry with single-user-message format
        else:
            return fallback

    try:
        retry_payload = {
            "model": settings["model"],
            "temperature": 0.0,
            "top_p": 0.9,
            "max_tokens": 500,
            "messages": [
                {
                    "role": "user",
                    "content": (
                        f"{system_prompt}\n\n"
                        "Below is the weekly report comparison data.\n"
                        "Write the answer in Korean and return only valid JSON.\n\n"
                        f"{user_prompt}"
                    ),
                }
            ],
        }
        llm_result = _call_llm(retry_payload, settings)
        return {
            **llm_result,
            "previous_week_start": fallback["previous_week_start"],
        }
    except (error.URLError, error.HTTPError, TimeoutError, ValueError, json.JSONDecodeError):
        return fallback
