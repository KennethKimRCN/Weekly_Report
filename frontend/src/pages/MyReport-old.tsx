import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { reportsApi } from '../api'
import { useAuthStore } from '../store'
import { ReportEditor } from '../components/ui/ReportEditor'
import { PageSpinner } from '../components/ui'
import { sundayOfToday, weekLabel, shiftWeek } from '../hooks/useDates'
import type { ReportFull, ReportProject } from '../types'

// ── Timeline nav ─────────────────────────────────────────────────────────────

type FlatItem =
  | { kind: 'project'; projectId: number; projectName: string; elementId: string }
  // Fix #6: store projectId directly on issue items — no more fragile name lookup
  | { kind: 'issue'; issueId: number; issueTitle: string; projectId: number; projectName: string; elementId: string }

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
        // Fix #6: carry projectId so linger lookup is O(1) and name-collision-safe
        projectId: rp.project_id,
        projectName: rp.project_name,
        elementId: `report-issue-${issue.id}`,
      })
    }
  }
  return items
}

function IssueTimelineNav({ projects }: { projects: ReportProject[] }) {
  // Fix #4: memoize items so the array reference is stable across renders
  const items = useMemo(() => buildFlatItems(projects), [projects])

  // Fix #3: stable string key derived via useMemo — not .map().join() inline in deps
  const elementIdKey = useMemo(() => items.map((i) => i.elementId).join(','), [items])

  const [activeKey, setActiveKey] = useState<string>(items[0]?.elementId ?? '')
  const [fillPct, setFillPct] = useState(0)
  const dotRefs = useRef<Map<string, HTMLElement>>(new Map())
  const trackRef = useRef<HTMLDivElement>(null)

  // Single source of truth: one scroll listener on .page-content that derives
  // both activeKey and fillPct in one synchronous pass — no IntersectionObserver,
  // no stale closure values, no two systems fighting each other.

  // Stable refs so the scroll handler never needs to be re-registered
  const activeKeyRef = useRef<string>(items[0]?.elementId ?? '')
  const itemsRef = useRef(items)
  useEffect(() => { itemsRef.current = items }, [items])

  const getScroller = useCallback(
    () => document.querySelector<HTMLElement>('.page-content'),
    []
  )

  // isProgrammaticScrollRef suppresses observer-driven updates during click-nav
  const isProgrammaticScrollRef = useRef(false)

  const syncNav = useCallback(() => {
    if (isProgrammaticScrollRef.current) return
    const scroller = getScroller()
    const track = trackRef.current
    if (!scroller || !track) return

    const scrollerRect = scroller.getBoundingClientRect()
    const trackRect = track.getBoundingClientRect()
    if (trackRect.height === 0) return

    // Find which section is at / just above the top of the visible area (with 80px offset
    // so the active item updates as soon as it reaches the top, not when it leaves)
    const viewTop = scrollerRect.top + 80

    // Gather each section's current top edge relative to the viewport
    const sectionTops = itemsRef.current.map((item) => {
      const el = document.getElementById(item.elementId)
      if (!el) return { elementId: item.elementId, top: Infinity }
      return { elementId: item.elementId, top: el.getBoundingClientRect().top }
    })

    // Active = last section whose top is at or above viewTop
    let newActiveKey = sectionTops[0]?.elementId ?? ''
    for (const { elementId, top } of sectionTops) {
      if (top <= viewTop) newActiveKey = elementId
    }

    if (newActiveKey !== activeKeyRef.current) {
      activeKeyRef.current = newActiveKey
      setActiveKey(newActiveKey)
    }

    // Fill %: interpolate the dot track position between active dot and next dot
    // based on how far the page has scrolled between those two section anchors
    const activeIdx = itemsRef.current.findIndex((i) => i.elementId === newActiveKey)
    if (activeIdx === -1) return

    const dotEntries = itemsRef.current.map((item) => {
      const el = dotRefs.current.get(item.elementId)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { elementId: item.elementId, centerY: r.top + r.height / 2 - trackRect.top }
    }).filter(Boolean) as { elementId: string; centerY: number }[]

    if (dotEntries.length === 0) return

    const activeDot = dotEntries[activeIdx]
    const nextDot = dotEntries[activeIdx + 1]

    if (!activeDot) return

    let interpolated = activeDot.centerY

    if (nextDot) {
      const activeEl = document.getElementById(newActiveKey)
      const nextEl = document.getElementById(itemsRef.current[activeIdx + 1]?.elementId ?? '')
      if (activeEl && nextEl) {
        const activeSecTop = activeEl.getBoundingClientRect().top
        const nextSecTop = nextEl.getBoundingClientRect().top
        const range = nextSecTop - activeSecTop
        if (range > 0) {
          // progress 0 = at active section top, 1 = at next section top
          const progress = Math.max(0, Math.min(1, (viewTop - activeSecTop) / range))
          interpolated = activeDot.centerY + (nextDot.centerY - activeDot.centerY) * progress
        }
      }
    }

    setFillPct(Math.max(0, Math.min(100, (interpolated / trackRect.height) * 100)))
  }, [getScroller])

  // Wire the single scroll listener — syncNav is stable so this never re-registers
  useEffect(() => {
    const scroller = getScroller()
    if (!scroller) return
    scroller.addEventListener('scroll', syncNav, { passive: true })
    syncNav() // run once on mount to set initial state
    return () => scroller.removeEventListener('scroll', syncNav)
  }, [syncNav, getScroller])

  // Recalculate when the track resizes (window resize, panel expand/collapse)
  useEffect(() => {
    if (!trackRef.current) return
    const ro = new ResizeObserver(syncNav)
    ro.observe(trackRef.current)
    return () => ro.disconnect()
  }, [syncNav])

  // Programmatic scroll on nav click — suppress syncNav until scroll settles
  const scrollTo = useCallback((item: FlatItem) => {
    const scroller = getScroller()
    const target = document.getElementById(item.elementId)
    if (!scroller || !target) return

    isProgrammaticScrollRef.current = true
    activeKeyRef.current = item.elementId
    setActiveKey(item.elementId)

    const scrollerRect = scroller.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const offset = targetRect.top - scrollerRect.top + scroller.scrollTop - 16
    scroller.scrollTo({ top: offset, behavior: 'smooth' })

    const clear = () => { isProgrammaticScrollRef.current = false }
    scroller.addEventListener('scrollend', clear, { once: true })
    const fallback = setTimeout(() => { isProgrammaticScrollRef.current = false }, 900)
    scroller.addEventListener('scrollend', () => clearTimeout(fallback), { once: true })
  }, [getScroller])

  // Fix #8: show the nav when there are multiple projects, or any issues to navigate to.
  // A single project with many issues is still worth navigating; "< 2 items total" was too strict.
  const hasMultipleProjects = projects.length > 1
  const hasAnyIssues = items.some((i) => i.kind === 'issue')
  if (!hasMultipleProjects && !hasAnyIssues) return null

  return (
    <>
      <style>{`
        /* ── Rail container ───────────────────────────────────────────────── */
        .timeline-rail {
          width: 192px;
          flex-shrink: 0;
          align-self: stretch;
          padding-left: 16px;
        }
        .timeline-sticky {
          position: sticky;
          top: 28px;
          padding: 2px 0 40px;
        }

        /* ── Section label above the nav ──────────────────────────────────── */
        .timeline-heading {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--ink-5);
          padding: 0 6px 8px 6px;
          user-select: none;
        }

        /* ── Track + dot column ───────────────────────────────────────────── */
        .timeline-track-wrap {
          position: relative;
          display: flex;
          flex-direction: column;
          padding: 4px 0;
        }

        /* Vertical track line — centred on the 22px gutter (6px padding + 11px = 17px) */
        .timeline-seg {
          position: absolute;
          left: 17px;
          width: 2px;
          z-index: 0;
          border-radius: 2px;
          transition: height 0.15s ease;
        }
        .timeline-seg-unfilled {
          background: var(--border);
          opacity: 0.6;
        }
        .timeline-seg-filled {
          background: linear-gradient(to bottom, var(--blue), var(--blue-mid));
          transition: height 0.2s ease;
        }

        /* ── Each row ─────────────────────────────────────────────────────── */
        .timeline-item {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          border-radius: 6px;
          background: transparent;
          border: none;
          padding: 0;
          width: 100%;
          text-align: left;
          transition: background 0.15s ease;
        }
        .timeline-item:hover { background: var(--surface-3); }
        .timeline-item.active-row { background: var(--blue-light); }

        /* Active left-edge accent bar */
        .timeline-item::before {
          content: '';
          position: absolute;
          left: 0;
          top: 20%;
          bottom: 20%;
          width: 3px;
          border-radius: 0 2px 2px 0;
          background: var(--blue);
          opacity: 0;
          transition: opacity 0.15s ease;
        }
        .timeline-item.active-row::before { opacity: 1; }

        /* dot gutter — fixed 22px so the line stays centred */
        .timeline-dot-gutter {
          width: 22px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        /* ── Issue row ────────────────────────────────────────────────────── */
        .timeline-item.is-issue { padding: 5px 8px 5px 6px; }
        .timeline-dot-issue {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          border: 1.5px solid var(--ink-5);
          background: var(--surface);
          flex-shrink: 0;
          transition: transform 0.18s cubic-bezier(.34,1.56,.64,1),
                      background 0.15s ease,
                      border-color 0.15s ease,
                      box-shadow 0.15s ease;
        }
        .timeline-item.is-issue:hover .timeline-dot-issue {
          transform: scale(1.45);
          border-color: var(--blue);
          background: var(--blue-light);
        }
        .timeline-dot-issue.active {
          background: var(--blue);
          border-color: var(--blue);
          transform: scale(1.3);
          box-shadow: 0 0 0 3px rgba(0,84,166,0.18);
        }

        /* issue label */
        .timeline-issue-label {
          font-size: 11.5px;
          color: var(--ink-4);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
          min-width: 0;
          transition: color 0.12s ease;
          line-height: 1.35;
        }
        .timeline-item.is-issue:hover .timeline-issue-label { color: var(--ink-2); }
        .timeline-item.is-issue.active-row .timeline-issue-label {
          color: var(--blue-dark);
          font-weight: 500;
        }

        /* ── Project row ──────────────────────────────────────────────────── */
        .timeline-item.is-project { padding: 8px 8px 4px 6px; }
        .timeline-dot-project {
          width: 9px;
          height: 9px;
          border-radius: 2px;
          border: 2px solid var(--ink-5);
          background: var(--surface);
          flex-shrink: 0;
          transform: rotate(45deg) scale(0.85);
          transition: transform 0.18s cubic-bezier(.34,1.56,.64,1),
                      background 0.15s ease,
                      border-color 0.15s ease,
                      box-shadow 0.15s ease;
        }
        .timeline-item.is-project:hover .timeline-dot-project {
          transform: rotate(45deg) scale(1.15);
          border-color: var(--blue);
          background: var(--blue-light);
        }
        .timeline-dot-project.active {
          background: var(--blue);
          border-color: var(--blue);
          transform: rotate(45deg) scale(1.05);
          box-shadow: 0 0 0 3px rgba(0,84,166,0.18);
        }

        /* project label */
        .timeline-project-label {
          font-size: 11.5px;
          font-weight: 600;
          color: var(--ink-2);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
          min-width: 0;
          letter-spacing: 0;
          transition: color 0.12s ease;
        }
        .timeline-item.is-project:hover .timeline-project-label { color: var(--blue); }
        .timeline-item.is-project.active-row .timeline-project-label {
          color: var(--blue-dark);
          font-weight: 600;
        }
      `}</style>

      <div className="timeline-rail">
        <div className="timeline-sticky">
          <div className="timeline-heading">이슈 탐색</div>
          <div className="timeline-track-wrap" ref={trackRef}>
            <div className="timeline-seg timeline-seg-filled" style={{ top: 0, height: `${fillPct}%` }} />
            <div className="timeline-seg timeline-seg-unfilled" style={{ top: `${fillPct}%`, bottom: 0 }} />

            {items.map((item) => {
              const isActive = activeKey === item.elementId
              if (item.kind === 'project') {
                return (
                  <button
                    key={item.elementId}
                    className={`timeline-item is-project${isActive ? ' active-row' : ''}`}
                    onClick={() => scrollTo(item)}
                    title={item.projectName}
                    aria-label={item.projectName}
                  >
                    <div className="timeline-dot-gutter">
                      <span
                        ref={(el) => { if (el) dotRefs.current.set(item.elementId, el) }}
                        className={`timeline-dot-project${isActive ? ' active' : ''}`}
                      />
                    </div>
                    <span className="timeline-project-label">{item.projectName}</span>
                  </button>
                )
              }
              // issue
              return (
                <button
                  key={item.elementId}
                  className={`timeline-item is-issue${isActive ? ' active-row' : ''}`}
                  onClick={() => scrollTo(item)}
                  title={item.issueTitle}
                  aria-label={`${item.projectName}: ${item.issueTitle}`}
                >
                  <div className="timeline-dot-gutter">
                    <span
                      ref={(el) => { if (el) dotRefs.current.set(item.elementId, el) }}
                      className={`timeline-dot-issue${isActive ? ' active' : ''}`}
                    />
                  </div>
                  <span className="timeline-issue-label">{item.issueTitle}</span>
                </button>
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
