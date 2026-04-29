import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { dashboardApi, analyticsApi } from '../api'
import { PageSpinner } from '../components/ui'
import { shortDate, fmtTime } from '../hooks/useDates'
import type {
  DashboardData,
  DashboardScheduleItem,
  DashboardIssueUpdate,
  DashboardTeam,
  AnalyticsData,
} from '../types'

// ── constants ─────────────────────────────────────────────────────────────

const VIEW_KEY = 'dashboard_view'

const TYPE_COLOR: Record<string, string> = {
  '휴가': 'var(--green)',
  '출장': 'var(--blue)',
  '교육': '#9b59b6',
  '재택': '#e67e22',
}

const PRIORITY_COLOR: Record<string, string> = {
  critical: 'var(--red)',
  high: 'var(--amber)',
  normal: 'var(--ink-4)',
}

const PRIORITY_LABEL: Record<string, string> = {
  critical: '긴급', high: '높음', normal: '보통',
}

const ISSUE_STATUS_LABEL: Record<string, string> = {
  'Open': '열림', 'In Progress': '진행중', 'Done': '완료', 'Closed': '닫힘',
}

const ISSUE_STATUS_CLASS: Record<string, string> = {
  'Open': 'chip-draft', 'In Progress': 'chip-submitted',
  'Done': 'chip-approved', 'Closed': 'chip-completed',
}

const REPORT_STATUS_CLASS: Record<number, string> = {
  1: 'chip-draft', 2: 'chip-submitted', 3: 'chip-approved', 4: 'chip-rejected',
}
const REPORT_STATUS_LABEL: Record<number, string> = {
  1: '초안', 2: '제출', 3: '승인', 4: '반려',
}

function typeColor(name: string) { return TYPE_COLOR[name] ?? 'var(--ink-3)' }
function isToday(iso: string) { return iso === new Date().toISOString().slice(0, 10) }

// ── ViewToggle ─────────────────────────────────────────────────────────────

function ViewToggle({
  view, onChange,
}: { view: 'my' | 'team'; onChange: (v: 'my' | 'team') => void }) {
  return (
    <div style={{
      display: 'flex', gap: 0, background: 'var(--surface-3)',
      border: '1px solid var(--border)', borderRadius: 8, padding: 3,
    }}>
      {(['my', 'team'] as const).map((v) => {
        const active = view === v
        return (
          <button
            key={v}
            onClick={() => onChange(v)}
            style={{
              padding: '6px 18px', borderRadius: 6, border: 'none',
              fontSize: 13, fontWeight: active ? 600 : 400,
              background: active ? 'var(--surface)' : 'transparent',
              color: active ? 'var(--ink)' : 'var(--ink-4)',
              boxShadow: active ? 'var(--shadow-1)' : 'none',
              transition: 'all .15s ease', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {v === 'my' ? '내 현황' : '팀 현황'}
          </button>
        )
      })}
    </div>
  )
}

// ── RefreshButton ──────────────────────────────────────────────────────────

function RefreshButton({ refreshing, onClick }: { refreshing: boolean; onClick: () => void }) {
  return (
    <button
      className="btn btn-secondary btn-sm"
      onClick={onClick}
      disabled={refreshing}
      style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
    >
      <svg
        width="13" height="13" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2.5"
        style={{ transition: 'transform 0.5s linear', transform: refreshing ? 'rotate(360deg)' : 'none' }}
      >
        <polyline points="23 4 23 10 17 10" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
      </svg>
      {refreshing ? '새로고침 중...' : '새로고침'}
    </button>
  )
}

// ══════════════════════════════════════════════════════════════════════════
//  MY VIEW widgets
// ══════════════════════════════════════════════════════════════════════════

function MyReportStatusCard({ data }: { data: DashboardData }) {
  const navigate = useNavigate()
  const allMembers = data.team_status.flatMap(t => t.members)
  const me = allMembers.find(m => m.id === data.current_user_id)
  const statusId = me?.status_id ?? null
  const statusLabel = statusId ? (REPORT_STATUS_LABEL[statusId] ?? '초안') : '미제출'
  const statusClass = statusId ? (REPORT_STATUS_CLASS[statusId] ?? 'chip-draft') : ''
  const isRejected = statusId === 4
  const isApproved = statusId === 3
  const isSubmitted = statusId === 2
  const isDraft = statusId === 1 || statusId === null

  return (
    <div className="card" style={{ height: '100%' }}>
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--ink-3)' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </span>
          <span className="card-title">내 보고서</span>
        </div>
        <span className="text-sm text-muted">이번 주</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="text-sm" style={{ color: 'var(--ink-3)' }}>제출 상태</span>
          {statusId ? (
            <span className={`chip ${statusClass}`} style={{ fontSize: 13, padding: '4px 12px' }}>
              {statusLabel}
            </span>
          ) : (
            <span className="chip" style={{
              fontSize: 13, padding: '4px 12px',
              background: 'var(--red-bg)', color: 'var(--red)',
              border: '1px solid rgba(197,59,50,0.2)',
            }}>
              {statusLabel}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="text-sm" style={{ color: 'var(--ink-3)' }}>보고서 주차</span>
          <span className="text-sm fw-500">{shortDate(data.week_start)} 주</span>
        </div>

        <div style={{
          padding: '12px 14px', borderRadius: 8,
          background: isRejected ? 'var(--red-bg)' : isApproved ? 'var(--green-bg)' : 'var(--surface-3)',
          border: `1px solid ${isRejected ? 'rgba(197,59,50,0.2)' : isApproved ? 'rgba(23,114,69,0.2)' : 'var(--border-2)'}`,
        }}>
          <div className="text-sm" style={{
            color: isRejected ? 'var(--red)' : isApproved ? 'var(--green)' : 'var(--ink-3)',
            fontWeight: 500,
          }}>
            {isRejected && '⚠ 보고서가 반려되었습니다. 수정 후 재제출해 주세요.'}
            {isApproved && '✓ 이번 주 보고서가 승인되었습니다.'}
            {isSubmitted && '보고서가 제출되었습니다. 관리자 검토 중입니다.'}
            {isDraft && !statusId && '아직 이번 주 보고서를 제출하지 않았습니다.'}
            {isDraft && statusId === 1 && '보고서 초안이 저장되어 있습니다. 작성을 완료하고 제출해 주세요.'}
          </div>
        </div>

        <button
          className={`btn ${isDraft || isRejected ? 'btn-primary' : 'btn-secondary'} btn-sm`}
          onClick={() => navigate('/my-report')}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {isRejected ? '보고서 수정하기' : isApproved ? '보고서 보기' : isSubmitted ? '보고서 보기' : '보고서 작성하기'}
        </button>
      </div>
    </div>
  )
}

function ScheduleWidget({ items }: { items: DashboardScheduleItem[] }) {
  const navigate = useNavigate()
  if (items.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '28px 0' }}>
        <div className="empty-title">향후 2주 일정이 없습니다</div>
        <div className="empty-body" style={{ marginTop: 6 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/calendar')}>일정 추가</button>
        </div>
      </div>
    )
  }

  const grouped: Record<string, DashboardScheduleItem[]> = {}
  for (const item of items) {
    if (!grouped[item.start_date]) grouped[item.start_date] = []
    grouped[item.start_date].push(item)
  }

  return (
    <div>
      {Object.entries(grouped).map(([dateKey, entries]) => (
        <div key={dateKey} style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
            marginBottom: 6, color: isToday(dateKey) ? 'var(--blue)' : 'var(--ink-4)',
          }}>
            {isToday(dateKey) ? '오늘' : shortDate(dateKey)}
          </div>
          {entries.map((item) => (
            <div
              key={item.id} className="clickable" onClick={() => navigate('/calendar')}
              tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate('/calendar')}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '8px 10px', borderRadius: 8,
                border: '1px solid var(--border-2)', marginBottom: 6,
                background: 'var(--surface-2)',
              }}
            >
              <div style={{
                width: 4, borderRadius: 4, alignSelf: 'stretch',
                background: typeColor(item.type_name), flexShrink: 0, minHeight: 20,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: typeColor(item.type_name), flexShrink: 0 }}>
                    {item.type_name}
                  </span>
                  {item.end_date !== item.start_date && (
                    <span className="text-sm text-muted" style={{ flexShrink: 0 }}>~ {shortDate(item.end_date)}</span>
                  )}
                  {item.location && (
                    <span className="text-sm text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      📍 {item.location}
                    </span>
                  )}
                </div>
                {item.details && (
                  <div className="text-sm" style={{ color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.details}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function IssueUpdatesWidget({ items }: { items: DashboardIssueUpdate[] }) {
  const navigate = useNavigate()
  if (items.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '28px 0' }}>
        <div className="empty-title">최근 이슈 업데이트 없음</div>
        <div className="empty-body">지난 7일간 내 프로젝트의 이슈 변경사항이 없습니다.</div>
      </div>
    )
  }

  return (
    <div>
      {items.map((item, idx) => (
        <div
          key={item.id} className="clickable"
          onClick={() => navigate(`/projects/${item.project_id}`)}
          tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/projects/${item.project_id}`)}
          style={{ padding: '10px 0', borderBottom: idx < items.length - 1 ? '1px solid var(--border-2)' : 'none' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <span className="text-sm fw-500" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {item.issue_title}
            </span>
            <span className={`chip ${ISSUE_STATUS_CLASS[item.status] ?? 'chip-draft'}`} style={{ flexShrink: 0, fontSize: 11 }}>
              {ISSUE_STATUS_LABEL[item.status] ?? item.status}
            </span>
            {item.priority !== 'normal' && (
              <span style={{ fontSize: 11, fontWeight: 600, flexShrink: 0, color: PRIORITY_COLOR[item.priority] ?? 'var(--ink-4)' }}>
                {PRIORITY_LABEL[item.priority] ?? item.priority}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="text-sm text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {item.project_name} · {item.progress_title}
            </span>
            <span className="text-sm text-muted" style={{ flexShrink: 0 }}>{fmtTime(item.updated_at)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
//  TEAM VIEW widgets
// ══════════════════════════════════════════════════════════════════════════

interface KpiData {
  submitted: number; total: number; unresolvedIssues: number
  avgCompletion: number; rejected: number
}

function deriveKpi(dashData: DashboardData, analyticsData: AnalyticsData | null): KpiData {
  const allMembers = dashData.team_status.flatMap(t => t.members)
  const total = allMembers.length
  const submitted = allMembers.filter(m => m.status_id && m.status_id >= 2).length
  const rejected = allMembers.filter(m => m.status_id === 4).length
  const latestWeek = analyticsData?.weekly?.[analyticsData.weekly.length - 1]
  const unresolvedIssues = latestWeek?.total_risks ?? 0
  const avgCompletion = Math.round(latestWeek?.avg_completion ?? 0)
  return { submitted, total, unresolvedIssues, avgCompletion, rejected }
}

function KpiBar({ kpi }: { kpi: KpiData }) {
  const submissionPct = kpi.total > 0 ? Math.round((kpi.submitted / kpi.total) * 100) : 0
  const submissionVariant = submissionPct < 60 ? 'stat-card--danger' : submissionPct < 85 ? 'stat-card--warning' : ''
  const issueVariant = kpi.unresolvedIssues > 10 ? 'stat-card--danger' : kpi.unresolvedIssues > 5 ? 'stat-card--warning' : ''
  const rejectedVariant = kpi.rejected > 0 ? 'stat-card--danger' : ''
  const barColor = submissionPct < 60 ? 'var(--red)' : submissionPct < 85 ? 'var(--amber)' : 'var(--green)'

  const stats = [
    {
      label: '제출률', variant: submissionVariant,
      main: `${kpi.submitted} / ${kpi.total}명`, sub: `${submissionPct}%`,
      bar: submissionPct, barColor,
    },
    {
      label: '미완료 이슈', variant: issueVariant,
      main: String(kpi.unresolvedIssues), sub: '건',
      bar: null, barColor: '',
    },
    {
      label: '평균 완료율', variant: kpi.avgCompletion < 50 ? 'stat-card--warning' : '',
      main: `${kpi.avgCompletion}%`, sub: '전체 프로젝트',
      bar: kpi.avgCompletion, barColor: 'var(--blue)',
    },
    {
      label: '반려 보고서', variant: rejectedVariant,
      main: String(kpi.rejected), sub: '건',
      bar: null, barColor: '',
    },
  ]

  return (
    <div className="grid-4" style={{ marginBottom: 20 }}>
      {stats.map((s) => (
        <div key={s.label} className={`stat-card ${s.variant}`}>
          <div className="stat-label">{s.label}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, margin: '8px 0 4px' }}>
            <span className="stat-value" style={{ fontSize: 26 }}>{s.main}</span>
            <span style={{ fontSize: 12, color: 'var(--ink-4)', fontWeight: 500 }}>{s.sub}</span>
          </div>
          {s.bar !== null && (
            <div style={{ height: 3, borderRadius: 99, background: 'var(--surface-4)', marginTop: 8 }}>
              <div style={{
                height: '100%', borderRadius: 99, background: s.barColor,
                width: `${Math.min(s.bar, 100)}%`, transition: 'width .4s ease',
              }} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function TeamSubmissionTable({
  teams, currentUserId,
}: { teams: DashboardTeam[]; currentUserId: number }) {
  const navigate = useNavigate()

  if (teams.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '28px 0' }}>
        <div className="empty-title">소속 팀 없음</div>
        <div className="empty-body">팀에 배정되면 팀원 현황이 표시됩니다.</div>
      </div>
    )
  }

  const statusOrder: Record<number, number> = { 4: 1, 1: 2, 2: 3, 3: 4 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {teams.map((team) => {
        const sorted = [...team.members].sort((a, b) => {
          if (!a.status_id && b.status_id) return -1
          if (a.status_id && !b.status_id) return 1
          const ao = a.status_id ? (statusOrder[a.status_id] ?? 5) : 0
          const bo = b.status_id ? (statusOrder[b.status_id] ?? 5) : 0
          return ao - bo
        })

        return (
          <div key={team.team_id}>
            {teams.length > 1 && (
              <div style={{
                fontSize: 11, fontWeight: 700, color: 'var(--ink-4)',
                letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10,
              }}>
                {team.team_name}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {sorted.map((member) => {
                const isMe = member.id === currentUserId
                const notSubmitted = !member.status_id
                return (
                  <div
                    key={member.id} className="clickable"
                    onClick={() => navigate('/team-reports')}
                    tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate('/team-reports')}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '9px 13px', borderRadius: 8,
                      border: isMe ? '1px solid var(--blue-mid)' : notSubmitted ? '1px solid var(--surface-4)' : '1px solid var(--border-2)',
                      background: isMe ? 'var(--blue-light)' : notSubmitted ? 'var(--surface-3)' : 'var(--surface-2)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="text-sm" style={{ fontWeight: isMe ? 700 : 500, color: isMe ? 'var(--blue-dark)' : 'var(--ink)' }}>
                        {member.name}
                      </span>
                      {isMe && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: 'var(--blue)',
                          background: 'var(--blue-light)', border: '1px solid var(--blue-mid)',
                          borderRadius: 4, padding: '1px 5px', letterSpacing: '0.03em',
                        }}>나</span>
                      )}
                    </div>
                    {member.status_id ? (
                      <span className={`chip ${REPORT_STATUS_CLASS[member.status_id] ?? 'chip-draft'}`}>
                        {REPORT_STATUS_LABEL[member.status_id] ?? '초안'}
                      </span>
                    ) : (
                      <span className="chip" style={{ background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid rgba(197,59,50,0.2)' }}>
                        미제출
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TopProjectsPanel({ analytics }: { analytics: AnalyticsData | null }) {
  const navigate = useNavigate()

  if (!analytics || analytics.top_projects.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '28px 0' }}>
        <div className="empty-title">프로젝트 데이터 없음</div>
        <div className="empty-body">활성 프로젝트가 생기면 여기에 표시됩니다.</div>
      </div>
    )
  }

  const maxBlockers = Math.max(...analytics.top_projects.map(p => p.blocker_count), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {analytics.top_projects.slice(0, 6).map((proj) => {
        const hasBlockers = proj.blocker_count > 0
        return (
          <div
            key={proj.project_name} className="clickable"
            onClick={() => navigate('/projects')}
            tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate('/projects')}
            style={{
              padding: '10px 12px', borderRadius: 8,
              border: `1px solid ${hasBlockers ? 'rgba(197,59,50,0.2)' : 'var(--border-2)'}`,
              background: hasBlockers ? 'var(--red-bg)' : 'var(--surface-2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span className="text-sm fw-500" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>
                {proj.project_name}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {hasBlockers && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--red)' }}>블로커 {proj.blocker_count}</span>
                )}
                <span className="text-sm text-muted">{Math.round(proj.avg_completion)}%</span>
              </div>
            </div>
            <div style={{ height: 3, borderRadius: 99, background: 'var(--surface-4)' }}>
              <div style={{
                height: '100%', borderRadius: 99,
                background: hasBlockers ? 'var(--red)' : 'var(--blue)',
                width: `${Math.min(proj.avg_completion, 100)}%`, transition: 'width .4s ease',
              }} />
            </div>
            {maxBlockers > 0 && (
              <div style={{ height: 2, borderRadius: 99, background: 'var(--surface-4)', marginTop: 4 }}>
                <div style={{
                  height: '100%', borderRadius: 99, background: 'var(--amber)',
                  width: `${(proj.blocker_count / maxBlockers) * 100}%`, transition: 'width .4s ease',
                }} />
              </div>
            )}
          </div>
        )
      })}
      <div className="text-sm text-muted" style={{ marginTop: 4, display: 'flex', gap: 12 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 3, borderRadius: 99, background: 'var(--blue)', display: 'inline-block' }} />완료율
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 2, borderRadius: 99, background: 'var(--amber)', display: 'inline-block' }} />블로커
        </span>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
//  Main page
// ══════════════════════════════════════════════════════════════════════════

export default function Dashboard() {
  const [view, setView] = useState<'my' | 'team'>(() =>
    (localStorage.getItem(VIEW_KEY) as 'my' | 'team') ?? 'my'
  )
  const [data, setData] = useState<DashboardData | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else { setLoading(true); setError(null) }
    try {
      const [dashRes, analyticsRes] = await Promise.all([
        dashboardApi.get(),
        analyticsApi.overview(1).catch(() => null),
      ])
      setData(dashRes.data)
      setAnalytics(analyticsRes?.data ?? null)
      setLastUpdated(new Date())
      setError(null)
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? e?.message ?? '데이터를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // auto-refresh every 60s
  useEffect(() => {
    const id = setInterval(() => load(true), 60_000)
    return () => clearInterval(id)
  }, [load])

  const handleViewChange = (v: 'my' | 'team') => {
    setView(v)
    localStorage.setItem(VIEW_KEY, v)
  }

  if (loading) return <PageSpinner />

  if (error) {
    return (
      <div>
        <div className="page-header"><div className="page-title">대시보드</div></div>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: '60px 24px', gap: 16, textAlign: 'center',
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div style={{ fontWeight: 600, color: 'var(--ink)' }}>데이터를 불러오지 못했습니다</div>
          <div className="text-sm text-muted">{error}</div>
          <button className="btn btn-secondary btn-sm" onClick={() => load()}>다시 시도</button>
        </div>
      </div>
    )
  }

  if (!data) return null

  const dateLabel = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  })

  const lastUpdatedLabel = lastUpdated
    ? (() => {
        const diff = Math.round((Date.now() - lastUpdated.getTime()) / 1000)
        if (diff < 60) return '방금 전'
        if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
        return `${Math.floor(diff / 3600)}시간 전`
      })()
    : null

  const kpi = deriveKpi(data, analytics)

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">대시보드</div>
          <div className="page-subtitle" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>{dateLabel}</span>
            {lastUpdatedLabel && (
              <>
                <span style={{ color: 'var(--border)' }}>·</span>
                <span style={{ color: 'var(--ink-5)' }}>최종 업데이트 {lastUpdatedLabel}</span>
              </>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ViewToggle view={view} onChange={handleViewChange} />
          <RefreshButton refreshing={refreshing} onClick={() => load(true)} />
        </div>
      </div>

      <div key={view} style={{ animation: 'fadeSlideIn .18s ease' }}>
        {view === 'my' ? (
          <div className="dashboard-grid">
            <MyReportStatusCard data={data} />

            <div className="card">
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--ink-3)' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" />
                      <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                  </span>
                  <span className="card-title">개인 일정</span>
                </div>
                <span className="text-sm text-muted">향후 14일</span>
              </div>
              <div style={{ overflowY: 'auto', maxHeight: 420 }}>
                <ScheduleWidget items={data.schedule} />
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--ink-3)' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  </span>
                  <span className="card-title">이슈 업데이트</span>
                </div>
                <span className="text-sm text-muted">최근 7일 · 내 프로젝트</span>
              </div>
              <div style={{ overflowY: 'auto', maxHeight: 420 }}>
                <IssueUpdatesWidget items={data.issue_updates} />
              </div>
            </div>
          </div>
        ) : (
          <div>
            <KpiBar kpi={kpi} />
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, alignItems: 'start' }}>
              <div className="card">
                <div className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: 'var(--ink-3)' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                    </span>
                    <span className="card-title">팀원 제출 현황</span>
                  </div>
                  <span className="text-sm text-muted">이번 주 보고서 상태</span>
                </div>
                <div style={{ overflowY: 'auto', maxHeight: 480 }}>
                  <TeamSubmissionTable teams={data.team_status} currentUserId={data.current_user_id} />
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: 'var(--ink-3)' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                    </span>
                    <span className="card-title">프로젝트 현황</span>
                  </div>
                  <span className="text-sm text-muted">완료율 · 블로커</span>
                </div>
                <div style={{ overflowY: 'auto', maxHeight: 480 }}>
                  <TopProjectsPanel analytics={analytics} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}