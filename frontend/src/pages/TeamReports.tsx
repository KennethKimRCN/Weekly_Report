import { useEffect, useMemo, useState } from 'react'
import { reportsApi, teamsApi } from '../api'
import { useAuthStore } from '../store'
import { StatusChip, PageSpinner } from '../components/ui'
import { useReportModal } from '../hooks/useReportModal'
import { weekLabel, shortDate, fmtTime } from '../hooks/useDates'
import type { ReportSummary, ReportFull, ReportProject, IssueProgress, TeamsData, ScheduleEntry } from '../types'

// ── Types ─────────────────────────────────────────────────────────────────

interface TreeNode {
  type: 'dept' | 'team' | 'aggregate'
  id: number
  name: string
  teamId?: number
  children: TreeNode[]
  depth: number
}

interface LocalTeamMember {
  id: number
  name: string
  rank_name: string
}

interface AggregatedIssue {
  issueId: number
  title: string
  status: string
  priority?: string
  start_date: string
  end_date: string | null
  details: string | null
  allProgresses: (IssueProgress & { memberName: string })[]
}

interface AggregatedProject {
  projectId: number
  projectName: string
  company: string
  location: string
  solutionProduct: string | null
  wbsNumber: string | null
  memberRemarks: { memberName: string; remark: string }[]
  members: string[]
  issues: AggregatedIssue[]
  projectSchedules: ReportProject['project_schedules']
}

interface AggregatedScheduleEntry extends ScheduleEntry {
  memberName: string
}

interface AggregatedComment {
  id: number
  reportId: number
  user_name: string
  comment: string
  created_at: string
}

// ── Tree helpers ───────────────────────────────────────────────────────────

function buildTree(data: TeamsData): TreeNode[] {
  const deptNodes: TreeNode[] = data.departments.map((d) => ({
    type: 'dept' as const, id: d.id, name: d.name, children: [], depth: 0,
  }))
  const teamsByDept: Record<number, typeof data.teams> = {}
  for (const t of data.teams) {
    if (!t.parent_team_id) {
      if (!teamsByDept[t.department_id]) teamsByDept[t.department_id] = []
      teamsByDept[t.department_id].push(t)
    }
  }
  function buildTeamNode(team: typeof data.teams[0], depth: number): TreeNode {
    const children = data.teams.filter((t) => t.parent_team_id === team.id).map((t) => buildTeamNode(t, depth + 1))
    return { type: 'team', id: team.id, teamId: team.id, name: team.name, children, depth }
  }
  for (const dNode of deptNodes) {
    dNode.children = (teamsByDept[dNode.id] ?? []).map((t) => buildTeamNode(t, 1))
  }
  return deptNodes.filter((d) => d.children.length > 0)
}

function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = []
  function walk(node: TreeNode) { result.push(node); node.children.forEach(walk) }
  nodes.forEach(walk)
  return result
}

// ── Aggregate helpers ──────────────────────────────────────────────────────

function aggregateFullReports(fullReports: { report: ReportSummary; full: ReportFull }[]) {
  const projectMap = new Map<number, AggregatedProject>()
  const allSchedules: AggregatedScheduleEntry[] = []
  const allComments: AggregatedComment[] = []
  const seenScheduleIds = new Set<string>()
  const seenCommentIds = new Set<number>()

  for (const { report, full } of fullReports) {
    const memberName = report.owner_name

    // Projects & issues
    for (const rp of full.projects) {
      const pid = rp.project_id
      if (!projectMap.has(pid)) {
        projectMap.set(pid, {
          projectId: pid,
          projectName: rp.project_name,
          company: rp.company,
          location: rp.location,
          solutionProduct: rp.solution_product,
          wbsNumber: rp.wbs_number,
          memberRemarks: [],
          members: [],
          issues: [],
          projectSchedules: rp.project_schedules,
        })
      }
      const agg = projectMap.get(pid)!
      if (!agg.members.includes(memberName)) agg.members.push(memberName)
      if (rp.remarks?.trim()) agg.memberRemarks.push({ memberName, remark: rp.remarks.trim() })

      for (const issue of rp.issue_items) {
        const existing = agg.issues.find((i) => i.issueId === issue.id)
        const progresses = (issue.full_issue_progresses ?? issue.issue_progresses).map((p) => ({
          ...p, memberName: p.author_name ?? memberName,
        }))
        if (!existing) {
          agg.issues.push({
            issueId: issue.id,
            title: issue.title,
            status: issue.status,
            priority: issue.priority,
            start_date: issue.start_date,
            end_date: issue.end_date,
            details: issue.details,
            allProgresses: progresses,
          })
        } else {
          const seen = new Set(existing.allProgresses.map((p) => p.id))
          for (const p of progresses) {
            if (!seen.has(p.id)) { existing.allProgresses.push(p); seen.add(p.id) }
          }
        }
      }
    }

    // Personal schedules — deduplicate by composite key (memberName+id)
    // personal_schedule.id is per-user autoincrement, so the same integer
    // can exist for different users and must not be used as a global dedup key.
    for (const s of full.week_schedule) {
      const key = `${memberName}:${s.id}`
      if (!seenScheduleIds.has(key)) {
        seenScheduleIds.add(key)
        allSchedules.push({ ...s, memberName })
      }
    }

    // Comments — deduplicate by id, merge across all member reports
    for (const c of full.comments) {
      if (!seenCommentIds.has(c.id)) {
        seenCommentIds.add(c.id)
        allComments.push({ id: c.id, reportId: full.id, user_name: c.user_name, comment: c.comment, created_at: c.created_at })
      }
    }
  }

  const projects = Array.from(projectMap.values()).sort((a, b) => {
    const pa = a.solutionProduct ?? '기타', pb = b.solutionProduct ?? '기타'
    return pa !== pb ? pa.localeCompare(pb) : a.projectName.localeCompare(b.projectName)
  })

  const groupedProjects = (() => {
    const groups = new Map<string, AggregatedProject[]>()
    for (const p of projects) {
      const key = p.solutionProduct?.trim() || '기타'
      const cur = groups.get(key) ?? []
      cur.push(p)
      groups.set(key, cur)
    }
    return Array.from(groups.entries())
      .map(([solution, ps]) => ({ solution, projects: ps }))
      .sort((a, b) => a.solution.localeCompare(b.solution))
  })()

  allSchedules.sort((a, b) => a.start_date.localeCompare(b.start_date))
  allComments.sort((a, b) => a.created_at.localeCompare(b.created_at))

  return { groupedProjects, allSchedules, allComments }
}

// ── Constants ─────────────────────────────────────────────────────────────

const STATUS = { DRAFT: 1, SUBMITTED: 2, APPROVED: 3, REJECTED: 4 }

const ISSUE_STATUS_CHIP: Record<string, string> = {
  '초안': 'chip-draft', '진행중': 'chip-submitted', '완료': 'chip-approved', '취소': 'chip-cancelled',
}
const PRIORITY_CHIP: Record<string, string> = { normal: 'chip-draft', high: 'chip-on_hold' }
const PRIORITY_LABEL: Record<string, string> = { normal: '일반', high: '중요' }
const MILESTONE_STATUS_CHIP: Record<string, string> = {
  planned: 'chip-submitted', done: 'chip-approved', delayed: 'chip-risk', cancelled: 'chip-cancelled',
}
const MILESTONE_STATUS_LABEL: Record<string, string> = {
  planned: '예정', done: '완료', delayed: '지연', cancelled: '취소',
}

// ── Aggregate Report View ─────────────────────────────────────────────────

function AggregateReportView({ scopedMemberIds, activeWeek, allReports, scopeLabel }: {
  scopedMemberIds: Set<number>
  activeWeek: string
  allReports: ReportSummary[]
  scopeLabel: string
}) {
  const [fullReports, setFullReports] = useState<{ report: ReportSummary; full: ReportFull }[]>([])
  const [loading, setLoading] = useState(false)

  // Stable string key from sorted member IDs — changing team or member
  // composition reliably triggers a re-fetch even if set size is unchanged.
  const memberKey = [...scopedMemberIds].sort((a, b) => a - b).join(',')

  // weekReports used for display-level counts (outside the effect)
  const weekReports = allReports.filter(
    (r) => r.week_start === activeWeek && (scopedMemberIds.size === 0 || scopedMemberIds.has(r.owner_id))
  )

  useEffect(() => {
    // Recompute inside the effect so we always read current allReports,
    // not a stale closure from a previous render.
    const currentWeekReports = allReports.filter(
      (r) => r.week_start === activeWeek && (scopedMemberIds.size === 0 || scopedMemberIds.has(r.owner_id))
    )
    if (!activeWeek || currentWeekReports.length === 0) { setFullReports([]); return }
    setLoading(true)
    const toFetch = currentWeekReports.filter((r) => r.status_id !== STATUS.DRAFT)
    Promise.all(toFetch.map((r) => reportsApi.get(r.id).then((res) => ({ report: r, full: res.data }))))
      .then((results) => { setFullReports(results); setLoading(false) })
  }, [activeWeek, memberKey, allReports.length])

  const { groupedProjects, allSchedules, allComments } = useMemo(
    () => aggregateFullReports(fullReports),
    [fullReports]
  )

  const totalProjects = groupedProjects.reduce((s, g) => s + g.projects.length, 0)
  const totalIssues   = groupedProjects.reduce((s, g) => s + g.projects.reduce((ss, p) => ss + p.issues.length, 0), 0)
  const totalProgress = groupedProjects.reduce((s, g) =>
    s + g.projects.reduce((ss, p) =>
      ss + p.issues.reduce((sss, i) => sss + i.allProgresses.length, 0), 0), 0)
  const totalSchedules = groupedProjects.reduce((s, g) =>
    s + g.projects.reduce((ss, p) => ss + p.projectSchedules.length, 0), 0)

  const draftCount    = weekReports.filter((r) => r.status_id === STATUS.DRAFT).length
  const includedCount = weekReports.length - draftCount

  const reportMetrics = [
    { num: totalProjects, lbl: '프로젝트' },
    { num: totalSchedules, lbl: '마일스톤' },
    { num: totalIssues, lbl: '이슈' },
    { num: totalProgress, lbl: '진행내역' },
  ]

  if (loading) return (
    <div className="report-editor">
      <div className="report-hero">
        <div className="report-hero-identity">
          <div className="report-hero-copy">
            <div className="report-hero-kicker">Team overview</div>
            <h2 className="report-owner">{scopeLabel} 종합 보고서</h2>
            <div className="report-week">주간: {activeWeek}</div>
          </div>
        </div>
      </div>
      <PageSpinner />
    </div>
  )

  if (weekReports.length === 0) return (
    <div className="report-editor">
      <div className="report-hero">
        <div className="report-hero-identity">
          <div className="report-hero-copy">
            <div className="report-hero-kicker">Team overview</div>
            <h2 className="report-owner">{scopeLabel} 종합 보고서</h2>
            <div className="report-week">주간: {activeWeek}</div>
          </div>
        </div>
      </div>
      <div className="empty-card">
        <div className="empty-state">
          <div className="empty-title">이번 주 제출된 보고서가 없습니다</div>
          <div className="empty-body">팀원들이 보고서를 제출하면 여기에 취합됩니다.</div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="report-editor">

      {/* ── Hero ── */}
      <div className="report-hero">
        <div className="report-hero-identity">
          <div className="report-hero-copy">
            <div className="report-hero-kicker">Team overview</div>
            <h2 className="report-owner">
              {scopeLabel} 종합 보고서
              <span className="chip chip-approved" style={{ fontSize: 11 }}>종합</span>
            </h2>
            <div className="report-week">주간: {activeWeek}</div>
          </div>
          <div className="report-metrics-inline">
            {reportMetrics.map(({ num, lbl }) => (
              <div key={lbl} className="report-metric-pill">
                <span className="report-metric-num">{num}</span>
                <span className="report-metric-lbl">{lbl}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Info bar */}
        <div className="report-actions" style={{ gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>
            {includedCount}개 보고서 취합
            {draftCount > 0 && <span style={{ color: 'var(--amber)', marginLeft: 6 }}>({draftCount}개 초안 제외)</span>}
          </span>
          <button className="btn btn-secondary" disabled style={{ opacity: 0.45, cursor: 'not-allowed' }}>
            Export to Word
          </button>
        </div>
      </div>

      {/* ── Projects panel ── */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-eyebrow">핵심 업무</div>
            <div className="panel-title">업무 현황</div>
          </div>
        </div>

        {groupedProjects.length === 0 ? (
          <div className="panel-empty">취합된 프로젝트가 없습니다. (제출된 보고서만 포함됩니다)</div>
        ) : (
          <div className="panel-body report-panel-body">
            {groupedProjects.map((group) => (
              <AggSolutionSection key={group.solution} group={group} />
            ))}
          </div>
        )}
      </div>

      {/* ── Schedule panel ── */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-eyebrow">개인 일정</div>
            <div className="panel-title">이번 주 팀 일정</div>
          </div>
        </div>
        {allSchedules.length === 0 ? (
          <div className="panel-empty">이번 주 팀 일정이 없습니다.</div>
        ) : (
          <div className="panel-body panel-body-compact">
            <div className="week-list">
              {allSchedules.map((item) => (
                <div key={item.id} className="week-row">
                  <span className="week-badge">{item.memberName}</span>
                  <span className="week-badge" style={{ background: 'var(--surface-2)', color: 'var(--ink-3)' }}>{item.type_name}</span>
                  <span className="week-date">
                    {shortDate(item.start_date)}
                    {item.start_date !== item.end_date && ` ~ ${shortDate(item.end_date)}`}
                  </span>
                  {item.location && <span className="week-loc">@ {item.location}</span>}
                  {item.details && <span className="week-detail">{item.details}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Comments panel ── */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-eyebrow">협업</div>
            <div className="panel-title">코멘트</div>
          </div>
        </div>
        <div className="panel-body">
          {allComments.length === 0 ? (
            <div className="comments-empty">취합된 코멘트가 없습니다.</div>
          ) : (
            <div className="comment-list">
              {allComments.map((c) => (
                <div key={c.id} className="comment-row">
                  <div className="avatar avatar-sm">{c.user_name?.slice(0, 1)}</div>
                  <div className="comment-body">
                    <div className="comment-meta">
                      <span className="comment-author">{c.user_name}</span>
                      <span className="comment-time">{fmtTime(c.created_at)}</span>
                    </div>
                    <div className="comment-text">{c.comment}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}

// ── Solution section (collapsible) ────────────────────────────────────────

function AggSolutionSection({ group }: { group: { solution: string; projects: AggregatedProject[] } }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <section className="report-solution-section">
      <button type="button" className="report-solution-divider" onClick={() => setCollapsed((v) => !v)}>
        <span className="report-collapse-icon">{collapsed ? '▸' : '▾'}</span>
        <span className="report-solution-title">{group.solution}</span>
        <span className="report-solution-count">{group.projects.length}개 프로젝트</span>
      </button>
      <div className={`report-collapse-panel ${collapsed ? '' : 'is-expanded'}`}>
        <div className="report-collapse-panel-inner report-collapse-panel-spacing">
          <div className="report-solution-list">
            {group.projects.map((proj) => (
              <AggProjectCard key={proj.projectId} proj={proj} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Project card ──────────────────────────────────────────────────────────

function AggProjectCard({ proj }: { proj: AggregatedProject }) {
  const [projectExpanded, setProjectExpanded] = useState(false)
  const [milestoneExpanded, setMilestoneExpanded] = useState(true)
  const [issueExpanded, setIssueExpanded] = useState(true)

  return (
    <article className="project-card report-project-card">
      <div className="project-card-header">
        <div className="project-card-main">
          <button
            className="report-collapse-header project-card-toggle"
            type="button"
            onClick={() => setProjectExpanded((v) => !v)}
          >
            <span className="report-collapse-icon">{projectExpanded ? '▾' : '▸'}</span>
            <div className="project-card-copy">
              <div className="project-name">
                <span>{proj.projectName}</span>
                {/* Member pills */}
                {proj.members.map((m) => (
                  <span key={m} className="chip chip-draft" style={{ fontSize: 10, fontWeight: 500 }}>{m}</span>
                ))}
              </div>
              <div className="project-meta">
                {(proj.solutionProduct || '기타')} · {proj.company} · {proj.location}
                {proj.wbsNumber ? <> · <span className="project-wbs">WBS {proj.wbsNumber}</span></> : ''}
              </div>
            </div>
          </button>
        </div>
      </div>

      <div className={`report-collapse-panel ${projectExpanded ? 'is-expanded' : ''}`}>
        <div className="report-collapse-panel-inner">
          <div className="project-detail-table">

            {/* Milestones */}
            <section className="project-detail-row">
              <button
                type="button"
                className="project-detail-label project-detail-label-button"
                onClick={() => setMilestoneExpanded((v) => !v)}
              >
                <span className="project-detail-label-inner">
                  <span className="project-detail-label-title-row">
                    <span className="report-collapse-icon">{milestoneExpanded ? '▾' : '▸'}</span>
                    <span>마일스톤</span>
                  </span>
                </span>
              </button>
              <div className="project-detail-value">
                <div className={`report-collapse-panel report-collapse-panel--nested ${milestoneExpanded ? 'is-expanded' : ''}`}>
                  <div className="report-collapse-panel-inner">
                    {proj.projectSchedules.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--ink-5)' }}>집계된 마일스톤이 없습니다.</div>
                    ) : (
                      <div className="table-wrap report-milestone-table report-surface-table">
                        <table>
                          <thead>
                            <tr><th>항목</th><th>예정일</th><th>실행일</th><th>상태</th></tr>
                          </thead>
                          <tbody>
                            {proj.projectSchedules.map((item) => (
                              <tr key={item.id}>
                                <td className="fw-500">{item.title}</td>
                                <td>{item.start_date}</td>
                                <td>{item.end_date ?? <span className="text-muted">-</span>}</td>
                                <td>
                                  <span className={`chip ${MILESTONE_STATUS_CHIP[item.status ?? 'planned'] ?? 'chip-draft'}`}>
                                    {MILESTONE_STATUS_LABEL[item.status ?? 'planned'] ?? (item.status ?? '예정')}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* Issues */}
            <section className="project-detail-row">
              <button
                type="button"
                className="project-detail-label project-detail-label-button"
                onClick={() => setIssueExpanded((v) => !v)}
              >
                <span className="project-detail-label-inner">
                  <span className="project-detail-label-title-row">
                    <span className="report-collapse-icon">{issueExpanded ? '▾' : '▸'}</span>
                    <span>이슈 트래커</span>
                  </span>
                </span>
              </button>
              <div className="project-detail-value">
                <div className={`report-collapse-panel report-collapse-panel--nested ${issueExpanded ? 'is-expanded' : ''}`}>
                  <div className="report-collapse-panel-inner">
                    {proj.issues.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--ink-5)' }}>이번 주에 반영된 이슈가 없습니다.</div>
                    ) : (
                      <div className="report-issue-list">
                        {proj.issues.map((issue) => (
                          <AggIssueCard key={issue.issueId} issue={issue} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* Remarks */}
            <section className="project-detail-row">
              <div className="project-detail-label">
                <span className="project-detail-label-inner">
                  <span className="project-detail-label-title-row"><span>Remarks</span></span>
                </span>
              </div>
              <div className="project-detail-value">
                {proj.memberRemarks.length === 0 ? (
                  <div className="project-remarks-block" style={{ color: 'var(--ink-4)' }}>메모가 없습니다.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {proj.memberRemarks.map((r, i) => (
                      <div key={i} className="project-remarks-block" style={{ padding: '10px 14px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue-dark)', marginRight: 8 }}>{r.memberName}</span>
                        <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{r.remark}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

          </div>
        </div>
      </div>
    </article>
  )
}

// ── Issue card ────────────────────────────────────────────────────────────

function AggIssueCard({ issue }: { issue: AggregatedIssue }) {
  const [expanded, setExpanded] = useState(true)
  const priorityKey = issue.priority ?? 'high'
  const statusChip = ISSUE_STATUS_CHIP[issue.status] ?? 'chip-draft'

  return (
    <div className="report-issue-card">
      <div className="report-issue-row">
        <button className="report-issue-toggle" onClick={() => setExpanded((v) => !v)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s' }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        <button type="button" onClick={() => setExpanded((v) => !v)} className="report-issue-hitarea">
          <div className="report-issue-title-row">
            <span className="report-issue-title">{issue.title}</span>
            <span className={`chip ${PRIORITY_CHIP[priorityKey] ?? 'chip-on_hold'}`} style={{ fontSize: 10 }}>
              {PRIORITY_LABEL[priorityKey] ?? '중요'}
            </span>
            <span className={`chip ${statusChip}`} style={{ fontSize: 10 }}>{issue.status}</span>
          </div>
          {issue.details && <div className="report-issue-summary">{issue.details}</div>}
          <div className="report-issue-meta">
            {issue.start_date}{issue.end_date ? ` ~ ${issue.end_date}` : ''}
          </div>
        </button>
      </div>

      <div className={`report-issue-progress-collapse ${expanded ? 'is-expanded' : ''}`}>
        <div style={{ minHeight: 0, overflow: 'hidden' }}>
          {issue.allProgresses.length === 0 ? (
            <div className="report-issue-progress-empty">진행내역이 없습니다.</div>
          ) : (
            issue.allProgresses.map((p, pi) => (
              <div key={p.id ?? pi} className="report-issue-progress-row">
                <div className="report-issue-progress-date">
                  {p.start_date}{p.end_date && p.end_date !== p.start_date ? ` ~ ${p.end_date}` : ''}
                </div>
                <div className="report-issue-progress-copy">
                  <div className="report-issue-progress-title">{p.title}</div>
                  {p.details && <div className="report-issue-progress-detail">{p.details}</div>}
                  <div className="report-issue-progress-author">{p.memberName}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────

export default function TeamReports() {
  const [teamsData, setTeamsData]       = useState<TeamsData | null>(null)
  const [reports, setReports]           = useState<ReportSummary[]>([])
  const [teamMembers, setTeamMembers]   = useState<LocalTeamMember[]>([])
  const [loading, setLoading]           = useState(true)
  const [activeWeek, setActiveWeek]     = useState('')
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null)
  const [statusFilter, setStatusFilter] = useState<number | null>(null)
  const [viewMode, setViewMode]         = useState<'members' | 'aggregate'>('members')

  const { user } = useAuthStore()
  const { openReport, modals, setApproveId } = useReportModal({ onApproved: reload })

  const aggregateNode: TreeNode = { type: 'aggregate', id: -1, name: '팀', children: [], depth: 0 }

  async function reload() {
    if (!selectedNode) return
    const [rRes, mRes] = await Promise.all([
      reportsApi.list({ week_start: activeWeek || undefined }),
      selectedNode.type === 'team'
        ? teamsApi.getMembersRecursive(selectedNode.id)
        : Promise.resolve({ data: [] as LocalTeamMember[] }),
    ])
    setReports(rRes.data); setTeamMembers(mRes.data)
  }

  async function init() {
    setLoading(true)
    const [tdRes, rRes] = await Promise.all([teamsApi.list(), reportsApi.list()])
    setTeamsData(tdRes.data); setReports(rRes.data)
    const weeks = [...new Set(rRes.data.map((r) => r.week_start))].sort().reverse()
    if (weeks.length) setActiveWeek(weeks[0])
    setLoading(false)
  }

  useEffect(() => { init() }, [])

  useEffect(() => {
    if (!teamsData || !user) return
    const myTeam = teamsData.teams.find((t) => t.members.some((m) => m.user_id === user.id))
    if (myTeam) {
      const node = flattenTree(buildTree(teamsData)).find((n) => n.type === 'team' && n.teamId === myTeam.id)
      if (node) { setSelectedNode(node); teamsApi.getMembersRecursive(myTeam.id).then((r) => setTeamMembers(r.data)) }
    }
  }, [teamsData, user])

  useEffect(() => {
    if (!activeWeek || !teamsData) return
    reportsApi.list({ week_start: activeWeek }).then((r) => setReports(r.data))
  }, [activeWeek])

  useEffect(() => {
    if (!selectedNode || selectedNode.type === 'aggregate') return
    if (selectedNode.type === 'team') {
      teamsApi.getMembersRecursive(selectedNode.id).then((r) => setTeamMembers(r.data))
    } else {
      const deptTeams = teamsData?.teams.filter((t) => t.department_id === selectedNode.id) ?? []
      const memberMap = new Map<number, LocalTeamMember>()
      for (const t of deptTeams) {
        for (const m of t.members) {
          if (!memberMap.has(m.user_id)) memberMap.set(m.user_id, { id: m.user_id, name: m.name, rank_name: m.rank_name })
        }
      }
      setTeamMembers(Array.from(memberMap.values()))
    }
  }, [selectedNode])

  if (loading) return <PageSpinner />

  const tree = teamsData ? buildTree(teamsData) : []
  const flatTree = flattenTree(tree)
  const weeks = [...new Set(reports.map((r) => r.week_start))].sort().reverse().slice(0, 8)
  const isAggregate = selectedNode?.type === 'aggregate'
  const scopedMemberIds = new Set(teamMembers.map((m) => m.id))

  const weekReports = reports.filter(
    (r) => r.week_start === activeWeek && (scopedMemberIds.size === 0 || scopedMemberIds.has(r.owner_id))
  )
  const filteredReports = statusFilter ? weekReports.filter((r) => r.status_id === statusFilter) : weekReports
  const submittedIds = new Set(weekReports.map((r) => r.owner_id))
  const missingMembers = teamMembers.filter((m) => !submittedIds.has(m.id))

  const submitted = weekReports.filter((r) => r.status_id === STATUS.SUBMITTED).length
  const approved  = weekReports.filter((r) => r.status_id === STATUS.APPROVED).length
  const rejected  = weekReports.filter((r) => r.status_id === STATUS.REJECTED).length
  const missing   = missingMembers.length
  const total     = teamMembers.length || weekReports.length
  const scopeLabel = isAggregate ? '전체 팀' : (selectedNode?.name ?? '전체')

  // When aggregate node is selected, show aggregate across all members
  const aggregateScopedIds = isAggregate ? new Set<number>() : scopedMemberIds

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

      {/* ── Sidebar ── */}
      <div className="card" style={{ width: 220, flexShrink: 0, padding: '12px 0', position: 'sticky', top: 20 }}>
        <div style={{ padding: '0 14px 10px', fontWeight: 600, fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>팀 선택</div>

        {/* Aggregate row */}
        <button
          onClick={() => { setSelectedNode(aggregateNode); setViewMode('aggregate') }}
          style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '7px 14px',
            background: isAggregate ? 'var(--accent-subtle, #eff6ff)' : 'none',
            border: 'none', cursor: 'pointer',
            borderLeft: isAggregate ? '3px solid var(--accent)' : '3px solid transparent',
            fontWeight: 600, fontSize: 12,
            color: isAggregate ? 'var(--accent)' : 'var(--text)',
            marginBottom: 4,
          }}
        >
          ⊞ 팀 종합
        </button>
        <div style={{ height: 1, background: 'var(--border)', margin: '4px 14px 8px' }} />

        {flatTree.map((node) => {
          const isSelected = !isAggregate && selectedNode?.type === node.type && selectedNode?.id === node.id
          const isDept = node.type === 'dept'
          return (
            <button
              key={`${node.type}-${node.id}`}
              onClick={() => { setSelectedNode(node); setViewMode('members') }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: `6px ${14 + node.depth * 14}px`,
                background: isSelected ? 'var(--accent-subtle, #eff6ff)' : 'none',
                border: 'none', cursor: 'pointer',
                borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
                fontWeight: isDept ? 600 : isSelected ? 500 : 400,
                fontSize: isDept ? 11 : 13,
                color: isDept ? 'var(--text-muted)' : isSelected ? 'var(--accent)' : 'var(--text)',
                textTransform: isDept ? 'uppercase' : 'none',
                letterSpacing: isDept ? '0.04em' : 'normal',
              }}
            >
              {!isDept && <span style={{ marginRight: 6, opacity: 0.4 }}>{'└'.repeat(Math.max(0, node.depth - 1))}{'─'}</span>}
              {node.name}
            </button>
          )
        })}
        {flatTree.length === 0 && <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text-muted)' }}>팀 없음</div>}
      </div>

      {/* ── Main Content ── */}
      <div style={{ flex: 1, minWidth: 0 }}>

        {/* Page header with view toggle */}
        <div className="page-header">
          <div>
            <div className="page-title">팀 보고서</div>
            {selectedNode && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{scopeLabel}</div>}
          </div>
          {selectedNode && !isAggregate && (
            <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
              {(['members', 'aggregate'] as const).map((mode) => (
                <button key={mode} onClick={() => setViewMode(mode)} style={{
                  padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                  background: viewMode === mode ? 'var(--accent)' : 'var(--bg-card)',
                  color: viewMode === mode ? '#fff' : 'var(--text)',
                }}>
                  {mode === 'members' ? '팀원별' : '프로젝트별'}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Week tabs */}
        <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
          {weeks.map((w) => (
            <button key={w} className={`tab ${activeWeek === w ? 'active' : ''}`} onClick={() => setActiveWeek(w)} role="tab" aria-selected={activeWeek === w}>
              {weekLabel(w)}
            </button>
          ))}
        </div>

        {/* Aggregate view */}
        {(isAggregate || viewMode === 'aggregate') && (
          <AggregateReportView
            scopedMemberIds={aggregateScopedIds}
            activeWeek={activeWeek}
            allReports={reports}
            scopeLabel={scopeLabel}
          />
        )}

        {/* Member table view */}
        {!isAggregate && viewMode === 'members' && (
          <>
            {selectedNode && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                <StatChip label="전체" value={total} color="var(--text-muted)" />
                <StatChip label="제출" value={submitted} color="#3b82f6" />
                <StatChip label="승인" value={approved} color="#22c55e" />
                {rejected > 0 && <StatChip label="반려" value={rejected} color="#f97316" />}
                {missing > 0 && <StatChip label="미제출" value={missing} color="#e53e3e" />}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {[null, STATUS.SUBMITTED, STATUS.APPROVED, STATUS.REJECTED].map((s) => (
                <button key={s ?? 'all'} onClick={() => setStatusFilter(s)} style={{
                  padding: '3px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                  border: '1px solid var(--border)',
                  background: statusFilter === s ? 'var(--accent)' : 'var(--bg-card)',
                  color: statusFilter === s ? '#fff' : 'var(--text)',
                  fontWeight: statusFilter === s ? 600 : 400,
                }}>
                  {s === null ? '전체' : s === STATUS.SUBMITTED ? '제출' : s === STATUS.APPROVED ? '승인' : '반려'}
                </button>
              ))}
            </div>
            <div className="card" style={{ padding: 0 }}>
              <div className="table-wrap" style={{ border: 'none', borderRadius: 'var(--radius)' }}>
                <table>
                  <thead>
                    <tr>
                      <th className="col-name">팀원</th>
                      <th className="col-status">상태</th>
                      <th>프로젝트</th>
                      <th className="col-action">작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReports.length === 0 && missingMembers.length === 0 ? (
                      <tr><td colSpan={4}>
                        <div className="empty-state">
                          <div className="empty-icon">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                              <circle cx="9" cy="7" r="4"/>
                              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                            </svg>
                          </div>
                          <div className="empty-title">이번 주 보고서가 없습니다</div>
                          <div className="empty-body">{selectedNode ? `${scopeLabel} 팀원들이 보고서를 제출하면 여기에 표시됩니다.` : '팀을 선택하거나 팀원들이 보고서를 제출하면 여기에 표시됩니다.'}</div>
                        </div>
                      </td></tr>
                    ) : (
                      <>
                        {filteredReports.map((r) => (
                          <tr key={r.id} className="clickable" onClick={() => openReport(r.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openReport(r.id)}>
                            <td className="fw-500">{r.owner_name}</td>
                            <td><StatusChip statusId={r.status_id} /></td>
                            <td>{r.total_projects}</td>
                            <td onClick={(e) => e.stopPropagation()}>
                              {(r.status_id === STATUS.SUBMITTED || r.status_id === STATUS.REJECTED) && user?.is_admin === 1 && (
                                <button className="btn btn-primary btn-sm" onClick={() => setApproveId(r.id)}>검토</button>
                              )}
                            </td>
                          </tr>
                        ))}
                        {!statusFilter && missingMembers.map((m) => (
                          <tr key={`missing-${m.id}`} style={{ opacity: 0.45 }}>
                            <td className="fw-500"><span style={{ marginRight: 8 }}>{m.name}</span><span style={{ fontSize: 11, color: '#e53e3e', fontWeight: 500 }}>미제출</span></td>
                            <td><span className="chip chip-draft">초안</span></td>
                            <td>—</td>
                            <td />
                          </tr>
                        ))}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
      {modals}
    </div>
  )
}

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 20, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <span style={{ fontSize: 18, fontWeight: 700, color }}>{value}</span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
    </div>
  )
}
