import { useEffect, useState } from 'react'
import { analyticsApi } from '../api'
import { BarChart, PageSpinner, ProgressBar } from '../components/ui'
import { shortDate } from '../hooks/useDates'
import type { AnalyticsData } from '../types'

export default function Analytics() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { analyticsApi.overview(8).then((r) => { setData(r.data); setLoading(false) }) }, [])

  if (loading) return <PageSpinner />
  if (!data) return null

  const weekly = data.weekly ?? []
  const last   = weekly[weekly.length - 1]
  const maxRisk = Math.max(...weekly.map((w) => w.total_risks + w.total_blockers), 1)

  const submitChartData = weekly.map((w) => ({
    label: shortDate(w.week_start), total: w.total_reports, submitted: w.submitted, approved: w.approved,
  }))

  const submissionRate = last && last.total_reports
    ? Math.round((last.submitted / last.total_reports) * 100)
    : 0

  return (
    <div>
      <div className="page-header">
        <div className="page-title">팀 분석</div>
      </div>

      {last && (
        <div className="grid-4 mb-24">
          {[
            { value: last.total_reports, label: '이번 주 보고서', variant: '', color: undefined },
            { value: `${submissionRate}%`, label: '제출률', variant: '', color: 'var(--blue)' },
            { value: last.total_risks, label: '위험 항목', variant: last.total_risks > 0 ? 'stat-card--warning' : '' },
            { value: last.total_blockers, label: '차단 항목', variant: last.total_blockers > 0 ? 'stat-card--danger' : '' },
          ].map(({ value, label, variant, color }) => (
            <div key={label} className={`stat-card ${variant}`}>
              <div className="stat-value" style={color ? { color } : undefined}>{value}</div>
              <div className="stat-label">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid-2 mb-24">
        <div className="card">
          <div className="card-header"><span className="card-title">주간 제출 현황</span></div>
          {weekly.length === 0 ? (
            <div className="empty-state">
              <div className="empty-title">데이터 없음</div>
              <div className="empty-body">아직 보고서 제출 이력이 없습니다.</div>
            </div>
          ) : (
            <BarChart data={submitChartData} />
          )}
        </div>
        <div className="card">
          <div className="card-header"><span className="card-title">위험 / 차단 추이</span></div>
          {weekly.length === 0 ? (
            <div className="empty-state">
              <div className="empty-title">데이터 없음</div>
            </div>
          ) : (
            <>
              <div className="bar-chart" style={{ height: 120 }}>
                {weekly.map((w, i) => {
                  const h  = 120
                  const hB = Math.round((w.total_blockers / maxRisk) * h)
                  const hR = Math.round((w.total_risks    / maxRisk) * h)
                  return (
                    <div key={i} className="bar-col">
                      <div className="bar-stack" style={{ height: h }}>
                        {hB > 0 && <div className="bar-seg" style={{ height: hB, background: 'var(--red)' }} />}
                        {hR > 0 && <div className="bar-seg" style={{ height: hR, background: 'var(--amber)' }} />}
                      </div>
                      <div className="bar-lbl">{shortDate(w.week_start)}</div>
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-12 mt-8">
                {[{ color: 'var(--amber)', label: '위험' }, { color: 'var(--red)', label: '차단' }].map(({ color, label }) => (
                  <div key={label} className="flex items-center gap-4">
                    <div style={{ width: 9, height: 9, borderRadius: '50%', background: color }} />
                    <span className="text-sm text-muted">{label}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">프로젝트별 활동</span></div>
        {data.top_projects.length === 0 ? (
          <div className="empty-state">
            <div className="empty-title">프로젝트 데이터 없음</div>
            <div className="empty-body">보고서에 프로젝트가 기록되면 여기에 표시됩니다.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="col-name">프로젝트명</th>
                  <th>회사</th>
                  <th>보고 횟수</th>
                  <th>평균 완료율</th>
                  <th>차단 횟수</th>
                </tr>
              </thead>
              <tbody>
                {data.top_projects.map((p, i) => (
                  <tr key={i}>
                    <td className="fw-500">{p.project_name}</td>
                    <td>{p.company}</td>
                    <td>{p.report_count}</td>
                    <td><ProgressBar value={p.avg_completion ?? 0} /></td>
                    <td>{p.blocker_count > 0 ? <span className="chip chip-blocker">{p.blocker_count}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
