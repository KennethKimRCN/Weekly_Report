import { useEffect, useRef, useState, useCallback } from 'react'
import { reportsApi } from '../api'
import { useAuthStore } from '../store'
import { ReportEditor } from '../components/ui/ReportEditor'
import { PageSpinner } from '../components/ui'
import { sundayOfToday, weekLabel, shiftWeek } from '../hooks/useDates'
import type { ReportFull, ReportProject } from '../types'

// ── Timeline nav ─────────────────────────────────────────────────────────────

type FlatItem =
  | { kind: 'project'; projectId: number; projectName: string; elementId: string }
  | { kind: 'issue';   issueId: number;   issueTitle: string;  projectName: string; elementId: string }

function buildFlatItems(projects: ReportProject[]): FlatItem[] {
  const items: FlatItem[] = []
  for (const rp of projects) {
    items.push({
      kind: 'project',
      projectId: rp.project_id,
      projectName: rp.project_name,
      elementId: `report-project-${rp.project_id}`,
    })
    for (const issue of rp.issue_items) {
      items.push({
        kind: 'issue',
        issueId: issue.id,
        issueTitle: issue.title,
        projectName: rp.project_name,
        elementId: `report-issue-${issue.id}`,
      })
    }
  }
  return items
}

function IssueTimelineNav({ projects }: { projects: ReportProject[] }) {
  const items = buildFlatItems(projects)

  // activeKey: elementId of the currently visible item
  const [activeKey, setActiveKey] = useState<string>(items[0]?.elementId ?? '')
  // lingerProjectId: project whose label pill is currently shown (Option A)
  const [lingerProjectId, setLingerProjectId] = useState<number | null>(
    items[0]?.kind === 'project' ? items[0].projectId : null
  )
  const [fillPct, setFillPct] = useState(0)
  const dotRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const trackRef = useRef<HTMLDivElement>(null)

  // Observe all project cards and issue cards
  useEffect(() => {
    if (items.length < 2) return
    const els = items
      .map((item) => document.getElementById(item.elementId))
      .filter(Boolean) as HTMLElement[]

    const observer = new IntersectionObserver(
      (entries) => {
        let topmost: { key: string; top: number } | null = null
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const top = entry.boundingClientRect.top
            if (!topmost || top < topmost.top) {
              topmost = { key: entry.target.id, top }
            }
          }
        })
        if (topmost) {
          const key = topmost.key
          setActiveKey(key)
          // Update linger: find which project this key belongs to
          const item = items.find((i) => i.elementId === key)
          if (item) {
            const pid = item.kind === 'project' ? item.projectId : item.projectName
              ? projects.find((p) => p.project_name === item.projectName)?.project_id ?? null
              : null
            setLingerProjectId(pid as number | null)
          }
        }
      },
      { threshold: 0.15 }
    )
    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [items.map((i) => i.elementId).join(',')])

  // Recompute fill % whenever active changes
  useEffect(() => {
    if (!activeKey || !trackRef.current) return
    const trackEl = trackRef.current
    const dotEl = dotRefs.current.get(activeKey)
    if (!dotEl) return
    const trackRect = trackEl.getBoundingClientRect()
    const dotRect = dotEl.getBoundingClientRect()
    const dotCenter = dotRect.top + dotRect.height / 2 - trackRect.top
    setFillPct(Math.max(0, Math.min(100, (dotCenter / trackRect.height) * 100)))
  }, [activeKey])

  const scrollTo = useCallback((item: FlatItem) => {
    document.getElementById(item.elementId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiveKey(item.elementId)
    if (item.kind === 'project') setLingerProjectId(item.projectId)
  }, [])

  if (items.length < 2) return null

  return (
    <>
      <style>{`
        .timeline-col {
          width: 48px;
          flex-shrink: 0;
          align-self: stretch;
        }
        .timeline-sticky {
          position: sticky;
          top: 40px;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 8px 0;
        }
        .timeline-track-wrap {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          padding: 6px 0;
        }
        .timeline-seg {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          width: 1px;
          z-index: 0;
          border-radius: 1px;
        }
        .timeline-seg-unfilled { background: var(--border); }
        .timeline-seg-filled {
          background: var(--blue);
          transition: height 0.25s ease;
        }
        /* each item row */
        .timeline-item {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
        }
        /* issue dot — circle */
        .timeline-item.is-issue { padding: 6px 0; }
        .timeline-dot-issue {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          border: 1.5px solid var(--border);
          background: var(--surface, #fff);
          cursor: pointer;
          padding: 0;
          flex-shrink: 0;
          transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .timeline-dot-issue:hover { transform: scale(1.5); border-color: var(--blue); }
        .timeline-dot-issue.active {
          background: var(--blue);
          border-color: var(--blue);
          transform: scale(1.3);
          box-shadow: 0 0 0 3px rgba(0,84,166,0.15);
        }
        /* project dot — larger diamond */
        .timeline-item.is-project { padding: 9px 0; }
        .timeline-dot-project {
          width: 11px;
          height: 11px;
          border-radius: 2px;
          border: 2px solid var(--border);
          background: var(--surface, #fff);
          cursor: pointer;
          padding: 0;
          flex-shrink: 0;
          transform: rotate(45deg) scale(0.9);
          transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .timeline-dot-project:hover {
          transform: rotate(45deg) scale(1.15);
          border-color: var(--blue);
        }
        .timeline-dot-project.active {
          background: var(--blue);
          border-color: var(--blue);
          transform: rotate(45deg) scale(1.05);
          box-shadow: 0 0 0 3px rgba(0,84,166,0.18);
        }
        /* Option A — floating pill label anchored to the project diamond */
        .timeline-project-pill {
          position: absolute;
          right: calc(100% + 12px);
          top: 50%;
          transform: translateY(-50%);
          background: var(--blue);
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.04em;
          padding: 3px 8px;
          border-radius: 20px;
          white-space: nowrap;
          max-width: 160px;
          overflow: hidden;
          text-overflow: ellipsis;
          pointer-events: none;
          opacity: 0;
          transform: translateY(-50%) translateX(4px);
          transition: opacity 0.2s ease, transform 0.2s ease;
          box-shadow: 0 1px 6px rgba(0,84,166,0.25);
        }
        .timeline-project-pill.visible {
          opacity: 1;
          transform: translateY(-50%) translateX(0);
        }
        /* hover tooltip for all items */
        .timeline-tooltip {
          position: absolute;
          right: calc(100% + 10px);
          top: 50%;
          transform: translateY(-50%);
          background: var(--ink, #1e293b);
          color: #fff;
          font-size: 11px;
          line-height: 1.4;
          padding: 5px 9px;
          border-radius: 5px;
          white-space: nowrap;
          pointer-events: none;
          z-index: 300;
          max-width: 200px;
          overflow: hidden;
          text-overflow: ellipsis;
          box-shadow: 0 2px 10px rgba(0,0,0,0.2);
          opacity: 0;
          transition: opacity 0.12s ease;
        }
        .timeline-item:hover .timeline-tooltip { opacity: 1; }
        /* hide tooltip on project row when pill is already showing */
        .timeline-item.is-project .timeline-tooltip { display: none; }
        .timeline-tooltip::after {
          content: '';
          position: absolute;
          left: 100%;
          top: 50%;
          transform: translateY(-50%);
          border: 5px solid transparent;
          border-left-color: var(--ink, #1e293b);
          border-right: none;
        }
        .timeline-tooltip-label {
          font-size: 9px;
          font-weight: 700;
          opacity: 0.55;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 2px;
        }
      `}</style>

      <div className="timeline-col">
        <div className="timeline-sticky">
          <div className="timeline-track-wrap" ref={trackRef}>
            <div className="timeline-seg timeline-seg-filled" style={{ top: 0, height: `${fillPct}%` }} />
            <div className="timeline-seg timeline-seg-unfilled" style={{ top: `${fillPct}%`, bottom: 0 }} />

            {items.map((item) => {
              const isActive = activeKey === item.elementId
              if (item.kind === 'project') {
                const pillVisible = lingerProjectId === item.projectId
                return (
                  <div key={item.elementId} className="timeline-item is-project">
                    <div className={`timeline-project-pill${pillVisible ? ' visible' : ''}`}>
                      {item.projectName}
                    </div>
                    <button
                      ref={(el) => { if (el) dotRefs.current.set(item.elementId, el) }}
                      className={`timeline-dot-project${isActive ? ' active' : ''}`}
                      onClick={() => scrollTo(item)}
                      aria-label={item.projectName}
                    />
                  </div>
                )
              }
              // issue
              return (
                <div key={item.elementId} className="timeline-item is-issue">
                  <button
                    ref={(el) => { if (el) dotRefs.current.set(item.elementId, el) }}
                    className={`timeline-dot-issue${isActive ? ' active' : ''}`}
                    onClick={() => scrollTo(item)}
                    aria-label={item.issueTitle}
                  />
                  <div className="timeline-tooltip">
                    <div className="timeline-tooltip-label">{item.projectName}</div>
                    <div>{item.issueTitle}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MyReport() {
  const { user } = useAuthStore()
  const [week, setWeek] = useState(sundayOfToday())
  const [report, setReport] = useState<ReportFull | null | undefined>(undefined)
  const [notFound, setNotFound] = useState(false)
  const dirtyCountRef = useRef(0)

  function handleDirtyChange(dirty: boolean) {
    dirtyCountRef.current = dirty ? dirtyCountRef.current + 1 : Math.max(0, dirtyCountRef.current - 1)
  }

  async function load(ws: string) {
    if (!user) return
    setReport(undefined)
    setNotFound(false)
    try {
      const res = await reportsApi.list({ owner_id: user.id, week_start: ws })
      if (!res.data.length) { setNotFound(true); return }
      const full = await reportsApi.get(res.data[0].id)
      setReport(full.data)
    } catch {
      setNotFound(true)
    }
  }

  useEffect(() => { load(week) }, [week, user?.id])

  function navigateWeek(dir: 1 | -1 | 'today') {
    if (dirtyCountRef.current > 0) {
      const ok = window.confirm('저장되지 않은 변경사항이 있습니다. 이동하면 변경사항이 사라집니다. 계속하시겠습니까?')
      if (!ok) return
    }
    if (dir === 'today') { setWeek(sundayOfToday()); return }
    setWeek((currentWeek) => shiftWeek(currentWeek, dir))
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="panel-eyebrow">My workspace</div>
          <div className="page-title">내 보고서</div>
          <div className="page-subtitle">이번 주 업무 흐름을 한눈에 보고 필요한 내용만 펼쳐서 정리할 수 있습니다.</div>
        </div>

        <div className="week-nav">
          <button className="week-nav-btn" onClick={() => navigateWeek(-1)} title="이전 주">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="week-nav-label">{weekLabel(week)}</div>
          <button className="week-nav-btn" onClick={() => navigateWeek(1)} title="다음 주">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <button className="week-nav-btn week-nav-today" onClick={() => navigateWeek('today')}>
            이번 주
          </button>
        </div>
      </div>

      {report === undefined ? (
        <PageSpinner />
      ) : notFound ? (
        <div className="empty-card">
          <div className="empty-state">
            <div className="empty-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
            <div className="empty-title">이번 주 보고서가 없습니다</div>
            <div className="empty-body">보고서는 매주 자동으로 생성됩니다. 다른 주로 이동하거나 관리자에게 문의해 주세요.</div>
          </div>
        </div>
      ) : report ? (
        <div style={{ display: 'flex', gap: 0, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ReportEditor
              report={report}
              readOnly={false}
              isAdmin={user?.is_admin === 1}
              onRefresh={() => load(week)}
              onDirtyChange={handleDirtyChange}
            />
          </div>
          <IssueTimelineNav projects={report.projects} />
        </div>
      ) : null}
    </div>
  )
}
