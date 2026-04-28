import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { dashboardApi } from '../api'
import { PageSpinner } from '../components/ui'
import { shortDate, fmtTime } from '../hooks/useDates'
import type {
  DashboardData,
  DashboardScheduleItem,
  DashboardIssueUpdate,
  DashboardTeam,
} from '../types'

// ── helpers ───────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<string, string> = {
  '휴가':  'var(--green)',
  '출장':  'var(--blue)',
  '교육':  '#9b59b6',
  '재택':  '#e67e22',
}

const PRIORITY_COLOR: Record<string, string> = {
  critical: 'var(--red)',
  high:     'var(--amber)',
  normal:   'var(--ink-4)',
}

const PRIORITY_LABEL: Record<string, string> = {
  critical: '긴급', high: '높음', normal: '보통',
}

const ISSUE_STATUS_LABEL: Record<string, string> = {
  'Open':        '열림',
  'In Progress': '진행중',
  'Done':        '완료',
  'Closed':      '닫힘',
}

const ISSUE_STATUS_CLASS: Record<string, string> = {
  'Open':        'chip-draft',
  'In Progress': 'chip-submitted',
  'Done':        'chip-approved',
  'Closed':      'chip-completed',
}

const REPORT_STATUS_CLASS: Record<number, string> = {
  1: 'chip-draft', 2: 'chip-submitted', 3: 'chip-approved', 4: 'chip-rejected',
}
const REPORT_STATUS_LABEL: Record<number, string> = {
  1: '초안', 2: '제출', 3: '승인', 4: '반려',
}

function typeColor(name: string) {
  return TYPE_COLOR[name] ?? 'var(--ink-3)'
}

function isToday(iso: string) {
  return iso === new Date().toISOString().slice(0, 10)
}

// ── ScheduleWidget ────────────────────────────────────────────────────────

function ScheduleWidget({ items }: { items: DashboardScheduleItem[] }) {
  const navigate = useNavigate()

  if (items.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '28px 0' }}>
        <div className="empty-title">향후 2주 일정이 없습니다</div>
        <div className="empty-body" style={{ marginTop: 6 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/calendar')}>
            일정 추가
          </button>
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
            fontSize: 11, fontWeight: 600,
            letterSpacing: '0.04em', textTransform: 'uppercase',
            marginBottom: 6,
            color: isToday(dateKey) ? 'var(--blue)' : 'var(--ink-4)',
          }}>
            {isToday(dateKey) ? '오늘' : shortDate(dateKey)}
          </div>
          {entries.map((item) => (
            <div
              key={item.id}
              className="clickable"
              onClick={() => navigate('/calendar')}
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && navigate('/calendar')}
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
                    <span className="text-sm text-muted" style={{ flexShrink: 0 }}>
                      ~ {shortDate(item.end_date)}
                    </span>
                  )}
                  {item.location && (
                    <span className="text-sm text-muted" style={{
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      📍 {item.location}
                    </span>
                  )}
                </div>
                {item.details && (
                  <div className="text-sm" style={{
                    color: 'var(--ink-2)', overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
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

// ── IssueUpdatesWidget ────────────────────────────────────────────────────

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
          key={item.id}
          className="clickable"
          onClick={() => navigate(`/projects/${item.project_id}`)}
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate(`/projects/${item.project_id}`)}
          style={{
            padding: '10px 0',
            borderBottom: idx < items.length - 1 ? '1px solid var(--border-2)' : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <span className="text-sm fw-500" style={{
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
            }}>
              {item.issue_title}
            </span>
            <span
              className={`chip ${ISSUE_STATUS_CLASS[item.status] ?? 'chip-draft'}`}
              style={{ flexShrink: 0, fontSize: 11 }}
            >
              {ISSUE_STATUS_LABEL[item.status] ?? item.status}
            </span>
            {item.priority !== 'normal' && (
              <span style={{
                fontSize: 11, fontWeight: 600, flexShrink: 0,
                color: PRIORITY_COLOR[item.priority] ?? 'var(--ink-4)',
              }}>
                {PRIORITY_LABEL[item.priority] ?? item.priority}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="text-sm text-muted" style={{
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
            }}>
              {item.project_name} · {item.progress_title}
            </span>
            <span className="text-sm text-muted" style={{ flexShrink: 0 }}>
              {fmtTime(item.updated_at)}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── TeamStatusWidget ──────────────────────────────────────────────────────

function TeamStatusWidget({ teams, currentUserId }: { teams: DashboardTeam[]; currentUserId: number }) {
  if (teams.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '28px 0' }}>
        <div className="empty-title">소속 팀 없음</div>
        <div className="empty-body">팀에 배정되면 팀원 현황이 표시됩니다.</div>
      </div>
    )
  }

  return (
    <div>
      {teams.map((team, ti) => (
        <div key={team.team_id} style={{ marginBottom: ti < teams.length - 1 ? 20 : 0 }}>
          {teams.length > 1 && (
            <div style={{
              fontSize: 11, fontWeight: 600, color: 'var(--ink-4)',
              letterSpacing: '0.04em', textTransform: 'uppercase',
              marginBottom: 8,
            }}>
              {team.team_name}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {team.members.map((member) => {
              const isMe = member.id === currentUserId
              const notSubmitted = !member.status_id
              return (
                <div key={member.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', borderRadius: 8,
                  border: isMe
                    ? '1px solid var(--blue-mid)'
                    : notSubmitted ? '1px solid var(--surface-4)' : '1px solid var(--border-2)',
                  background: isMe
                    ? 'var(--blue-light)'
                    : notSubmitted ? 'var(--surface-3)' : 'var(--surface-2)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span className="text-sm" style={{
                      fontWeight: isMe ? 700 : 500,
                      color: isMe ? 'var(--blue-dark)' : 'var(--ink)',
                    }}>
                      {member.name}
                    </span>
                    {isMe && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: 'var(--blue)',
                        background: 'var(--blue-light)', border: '1px solid var(--blue-mid)',
                        borderRadius: 4, padding: '1px 5px', letterSpacing: '0.03em',
                      }}>
                        나
                      </span>
                    )}
                  </div>
                  {member.status_id ? (
                    <span className={`chip ${REPORT_STATUS_CLASS[member.status_id] ?? 'chip-draft'}`}>
                      {REPORT_STATUS_LABEL[member.status_id] ?? '초안'}
                    </span>
                  ) : (
                    <span className="chip" style={{
                      background: 'var(--red-bg)', color: 'var(--red)',
                      border: '1px solid rgba(197,59,50,0.2)',
                    }}>
                      미제출
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [data, setData]           = useState<DashboardData | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else { setLoading(true); setError(null) }
    try {
      const res = await dashboardApi.get()
      setData(res.data)
      setError(null)
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? e?.message ?? '데이터를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

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
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
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

  const cards = [
    {
      title: '개인 일정', subtitle: '향후 14일',
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      ),
      content: <ScheduleWidget items={data.schedule} />,
    },
    {
      title: '이슈 업데이트', subtitle: '최근 7일 · 내 프로젝트',
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      ),
      content: <IssueUpdatesWidget items={data.issue_updates} />,
    },
    {
      title: '팀 현황', subtitle: '이번 주 보고서 제출 상태',
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      ),
      content: <TeamStatusWidget teams={data.team_status} currentUserId={data.current_user_id} />,
    },
  ]

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">대시보드</div>
          <div className="page-subtitle">{dateLabel}</div>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => load(true)}
          disabled={refreshing}
          style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
        >
          <svg
            width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5"
            style={{
              transition: 'transform 0.5s linear',
              transform: refreshing ? 'rotate(360deg)' : 'none',
            }}
          >
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          {refreshing ? '새로고침 중...' : '새로고침'}
        </button>
      </div>

      <div className="dashboard-grid">
        {cards.map((card) => (
          <div key={card.title} className="card">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--ink-3)' }}>{card.icon}</span>
                <span className="card-title">{card.title}</span>
              </div>
              <span className="text-sm text-muted">{card.subtitle}</span>
            </div>
            <div style={{ overflowY: 'auto', maxHeight: 420 }}>
              {card.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
