import { useEffect, useState } from 'react'
import { reportsApi } from '../api'
import { useAuthStore } from '../store'
import { StatusChip, ProgressBar, PageSpinner } from '../components/ui'
import { useReportModal } from '../hooks/useReportModal'
import { weekLabel } from '../hooks/useDates'
import type { ReportSummary } from '../types'

export default function TeamReports() {
  const [reports, setReports] = useState<ReportSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [activeWeek, setActiveWeek] = useState('')
  const { user } = useAuthStore()

  async function load() {
    const res = await reportsApi.list()
    setReports(res.data)
    const weeks = [...new Set(res.data.map((r) => r.week_start))].sort().reverse()
    if (weeks.length) setActiveWeek(weeks[0])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const { openReport, modals, setApproveId } = useReportModal({ onApproved: load })

  if (loading) return <PageSpinner />

  const weeks = [...new Set(reports.map((r) => r.week_start))].sort().reverse().slice(0, 8)
  const weekReports = reports.filter((r) => r.week_start === activeWeek)

  return (
    <div>
      <div className="page-header">
        <div className="page-title">팀 보고서</div>
      </div>

      <div className="tabs" role="tablist">
        {weeks.map((w) => (
          <button
            key={w}
            className={`tab ${activeWeek === w ? 'active' : ''}`}
            onClick={() => setActiveWeek(w)}
            role="tab"
            aria-selected={activeWeek === w}
          >
            {weekLabel(w)}
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
                <th>완료율</th>
                <th>위험</th>
                <th>차단</th>
                <th className="col-action">작업</th>
              </tr>
            </thead>
            <tbody>
              {weekReports.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      <div className="empty-icon">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                          <circle cx="9" cy="7" r="4"/>
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                        </svg>
                      </div>
                      <div className="empty-title">이번 주 보고서가 없습니다</div>
                      <div className="empty-body">팀원들이 보고서를 제출하면 여기에 표시됩니다.</div>
                    </div>
                  </td>
                </tr>
              ) : weekReports.map((r) => (
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
                  <td><ProgressBar value={r.avg_completion ?? 0} /></td>
                  <td>{(r.risk_count ?? 0) > 0 ? <span className="chip chip-risk">{r.risk_count}</span> : '—'}</td>
                  <td>{(r.blocker_count ?? 0) > 0 ? <span className="chip chip-blocker">{r.blocker_count}</span> : '—'}</td>
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
      </div>

      {modals}
    </div>
  )
}
