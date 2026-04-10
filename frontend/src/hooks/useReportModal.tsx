import { useState } from 'react'
import { reportsApi } from '../api'
import { useAuthStore } from '../store'
import { Modal } from '../components/ui/Modal'
import { ReportEditor } from '../components/ui/ReportEditor'
import { ApproveModal } from '../components/ui/ApproveModal'
import { weekLabel } from './useDates'
import type { ReportFull } from '../types'

/**
 * Shared hook for opening a report in a read-only modal viewer.
 * Handles fetch, state, and renders both the viewer and approve/reject modals.
 *
 * Usage:
 *   const { openReport, modals } = useReportModal({ onApproved: load })
 *   ...
 *   <button onClick={() => openReport(id)} />
 *   {modals}
 */
export function useReportModal({ onApproved }: { onApproved?: () => void } = {}) {
  const [viewReport, setViewReport] = useState<ReportFull | null>(null)
  const [approveId, setApproveId]   = useState<number | null>(null)
  const { user } = useAuthStore()

  async function openReport(id: number) {
    try {
      const res = await reportsApi.get(id)
      setViewReport(res.data)
    } catch {}
  }

  const modals = (
    <>
      {viewReport && (
        <Modal
          title={`${viewReport.owner_name} · ${weekLabel(viewReport.week_start)}`}
          onClose={() => setViewReport(null)}
          size="lg"
          footer={
            <div className="flex gap-6">
              {viewReport.status_id === 2 && user?.is_admin === 1 && (
                <button
                  className="btn btn-primary"
                  onClick={() => { setApproveId(viewReport.id); setViewReport(null) }}
                >
                  검토하기
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => setViewReport(null)}>닫기</button>
            </div>
          }
        >
          <ReportEditor
            report={viewReport}
            readOnly
            isAdmin={user?.is_admin === 1}
            onRefresh={() => openReport(viewReport.id)}
          />
        </Modal>
      )}

      {approveId && (
        <ApproveModal
          reportId={approveId}
          onDone={() => onApproved?.()}
          onClose={() => setApproveId(null)}
        />
      )}
    </>
  )

  return { openReport, modals, setApproveId }
}
