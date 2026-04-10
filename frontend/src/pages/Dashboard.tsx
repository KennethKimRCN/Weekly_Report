import { useEffect, useState } from 'react'
import { dashboardApi } from '../api'
import { useAuthStore } from '../store'
import { StatusChip, ProgressBar, BarChart, PageSpinner, TableSkeleton } from '../components/ui'
import { useReportModal } from '../hooks/useReportModal'
import { weekLabel, shortDate } from '../hooks/useDates'
import type { DashboardData } from '../types'

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const { user } = useAuthStore()

  async function load() {
    try { const res = await dashboardApi.get(); setData(res.data) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const { openReport, modals, setApproveId } = useReportModal({ onApproved: load })

  if (loading) return <PageSpinner />
  if (!data) return null

  const chartData = data.submission_stats.map((s) => ({
    label: shortDate(s.week_start), total: s.total, submitted: s.submitted, approved: s.approved,
  }))

  const riskCount    = data.team_reports.reduce((s, r) => s + (r.risk_count ?? 0), 0)
  const blockerCount = data.blockers.length

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">대시보드</div>
          <div className="page-subtitle">{weekLabel(data.week_start)}</div>
        </div>
      </div>

      <div className="grid-4 mb-24">
        {[
          { value: data.team_reports.length,                                          label: '이번 주 보고서', variant: '' },
          { value: data.team_reports.filter((r) => r.status_id >= 2).length,          label: '제출됨',        variant: '', color: 'var(--blue)' },
          { value: riskCount,                                                          label: '위험 항목',     variant: riskCount > 0 ? 'stat-card--warning' : '' },
          { value: blockerCount,                                                       label: '차단 항목',     variant: blockerCount > 0 ? 'stat-card--danger' : '' },
        ].map(({ value, label, variant, color }) => (
          <div key={label} className={`stat-card ${variant}`}>
            <div className="stat-value" style={color ? { color } : undefined}>{value}</div>
            <div className="stat-label">{label}</div>
            {label === '차단 항목' && data.pending_approvals.length > 0 && (
              <div className="stat-delta down">{data.pending_approvals.length}개 승인 대기</div>
            )}
          </div>
        ))}
      </div>

      <div className="grid-2 mb-24">
        <div className="card">
          <div className="card-header"><span className="card-title">최근 8주 제출 현황</span></div>
          <BarChart data={chartData} />
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">차단 항목</span>
            {blockerCount > 0 && <span className="chip chip-blocker">{blockerCount}</span>}
          </div>
          {data.blockers.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: 'var(--ink-4)' }}>
              차단 항목 없음 ✓
            </div>
          ) : (
            data.blockers.map((b, i) => (
              <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-2)' }}>
                <div className="flex items-center gap-6 mb-4">
                  <span className="chip chip-blocker">차단</span>
                  <span className="fw-500 text-sm">{b.project_name}</span>
                  <span className="text-sm text-muted ml-auto">{b.reporter}</span>
                </div>
                {b.remarks && <div className="text-sm text-muted">{b.remarks}</div>}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">팀 보고서 현황</span>
          {data.pending_approvals.length > 0 && (
            <span className="chip chip-submitted">{data.pending_approvals.length}개 승인 대기</span>
          )}
        </div>
        {data.team_reports.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <div className="empty-title">이번 주 보고서가 없습니다</div>
            <div className="empty-body">팀원들이 보고서를 제출하면 여기에 표시됩니다.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="col-name">팀원</th>
                  <th className="col-status">상태</th>
                  <th>프로젝트</th>
                  <th>완료율</th>
                  <th>위험/차단</th>
                  <th className="col-action">작업</th>
                </tr>
              </thead>
              <tbody>
                {data.team_reports.map((r) => (
                  <tr
                    key={r.id}
                    className="clickable"
                    onClick={() => openReport(r.id)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && openReport(r.id)}
                  >
                    <td className="fw-500">{r.owner_name}</td>
                    <td><StatusChip statusId={r.status_id} /></td>
                    <td>{r.total_projects}</td>
                    <td><ProgressBar value={r.avg_completion ?? 0} riskLevel={r.risk_count > 0 ? 'risk' : 'normal'} /></td>
                    <td>
                      {(r.risk_count ?? 0) > 0 && <span className="chip chip-risk mr-4">{r.risk_count} 위험</span>}
                      {(r.blocker_count ?? 0) > 0 && <span className="chip chip-blocker">{r.blocker_count} 차단</span>}
                      {!r.risk_count && !r.blocker_count && <span className="text-muted text-sm">—</span>}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {r.status_id === 2 && user?.is_admin === 1 && (
                        <button className="btn btn-primary btn-sm" onClick={() => setApproveId(r.id)}>검토</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modals}
    </div>
  )
}
