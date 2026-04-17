import json
from urllib import error, request

from fastapi import APIRouter, Depends, HTTPException

from ..core.config import LLM_BASE_URL, LLM_MODEL, LLM_TIMEOUT_SECONDS
from ..core.deps import get_current_user
from ..db.session import get_db
from .reports import _full_report

router = APIRouter(prefix="/api/llm", tags=["llm"])


def _check_llm_available() -> tuple[bool, str | None]:
    req = request.Request(
        f"{LLM_BASE_URL.rstrip('/')}/models",
        headers={"Content-Type": "application/json"},
        method="GET",
    )
    try:
        with request.urlopen(req, timeout=min(10, LLM_TIMEOUT_SECONDS)) as response:
            raw = response.read().decode("utf-8")
        data = json.loads(raw)
        if isinstance(data, dict) and isinstance(data.get("data"), list):
            return True, None
        return False, "Invalid model list response."
    except (error.URLError, error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
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
    available, error_message = _check_llm_available()
    return {
        "available": available,
        "model": LLM_MODEL if available else None,
        "base_url": LLM_BASE_URL,
        "error": error_message,
    }


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


def _call_llm(payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = request.Request(
        f"{LLM_BASE_URL.rstrip('/')}/chat/completions",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with request.urlopen(req, timeout=LLM_TIMEOUT_SECONDS) as response:
        raw = response.read().decode("utf-8")
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
        "model": data.get("model") or LLM_MODEL,
    }


@router.post("/reports/{report_id}/summary")
def generate_report_summary(report_id: int, current_user=Depends(get_current_user)):
    with get_db() as conn:
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

    system_prompt = (
        "You are an assistant that writes concise Korean weekly project summaries for an internal report. "
        "Compare the current week against the previous week, focus on issue movement, meaningful progress, "
        "newly added work, and items that still need attention. When you mention a current-week issue, use its exact issue title verbatim so the UI can link it. "
        "Return only valid JSON with this exact shape: "
        '{"summary":"2-4 sentence Korean summary","highlights":["bullet 1","bullet 2","bullet 3"]}.'
    )
    user_prompt = (
        "현재 주차와 지난 주차 프로젝트 이슈 및 진행내역을 비교해 주세요. "
        "문장은 자연스러운 한국어로 작성하고, 과장 없이 사실 기반으로 요약하세요.\n\n"
        f"{json.dumps(prompt_payload, ensure_ascii=False, indent=2)}"
    )

    fallback = _build_fallback_summary(current_report, previous_report)
    try:
        llm_result = _call_llm(
            {
                "model": LLM_MODEL,
                "temperature": 0.2,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            }
        )
        return {
            **llm_result,
            "previous_week_start": fallback["previous_week_start"],
        }
    except (error.URLError, error.HTTPError, TimeoutError, ValueError, json.JSONDecodeError):
        return fallback
