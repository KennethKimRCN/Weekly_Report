import { useEffect, useRef, useState } from 'react'
import { reportsApi } from '../api'
import { useAuthStore } from '../store'
import { ReportEditor } from '../components/ui/ReportEditor'
import { PageSpinner } from '../components/ui'
import { sundayOfToday, weekLabel, shiftWeek } from '../hooks/useDates'
import type { ReportFull } from '../types'

export default function MyReport() {
  const { user } = useAuthStore()
  const [week, setWeek] = useState(sundayOfToday())
  const [report, setReport] = useState<ReportFull | null | undefined>(undefined)
  const [notFound, setNotFound] = useState(false)
  const dirtyCountRef = useRef(0)

  async function load(ws: string) {
    if (!user) return
    setReport(undefined)
    setNotFound(false)

    try {
      const res = await reportsApi.list({ owner_id: user.id, week_start: ws })
      if (!res.data.length) {
        setNotFound(true)
        return
      }

      const full = await reportsApi.get(res.data[0].id)
      setReport(full.data)
    } catch {
      setNotFound(true)
    }
  }

  useEffect(() => {
    load(week)
  }, [week, user?.id])

  function navigateWeek(dir: 1 | -1 | 'today') {
    if (dirtyCountRef.current > 0) {
      const ok = window.confirm('저장되지 않은 변경사항이 있습니다. 이동하면 변경사항이 사라집니다. 계속하시겠습니까?')
      if (!ok) return
    }

    if (dir === 'today') {
      setWeek(sundayOfToday())
      return
    }

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
        <ReportEditor
          report={report}
          readOnly={false}
          isAdmin={user?.is_admin === 1}
          onRefresh={() => load(week)}
        />
      ) : null}
    </div>
  )
}
