import { useState } from 'react'
import { reportsApi } from '../../api'
import { useToast } from './Toast'
import { Modal } from './Modal'

interface Props { reportId: number; onDone: () => void; onClose: () => void }

export function ApproveModal({ reportId, onDone, onClose }: Props) {
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)
  const { toast } = useToast()

  async function doApprove() {
    setLoading('approve')
    try { await reportsApi.approve(reportId, comment); toast('승인되었습니다', 'success'); onDone(); onClose() }
    catch (e: any) { toast(e.response?.data?.detail ?? '오류', 'error') }
    finally { setLoading(null) }
  }

  async function doReject() {
    if (!comment.trim()) { toast('반려 사유를 입력해주세요', 'error'); return }
    setLoading('reject')
    try { await reportsApi.reject(reportId, comment); toast('반려되었습니다'); onDone(); onClose() }
    catch (e: any) { toast(e.response?.data?.detail ?? '오류', 'error') }
    finally { setLoading(null) }
  }

  return (
    <Modal title="보고서 검토" onClose={onClose}
      footer={
        <div className="flex gap-6">
          <button className="btn btn-danger" onClick={doReject} disabled={loading !== null}>
            {loading === 'reject' ? '처리 중…' : '반려'}
          </button>
          <button className="btn btn-primary" onClick={doApprove} disabled={loading !== null}>
            {loading === 'approve' ? '처리 중…' : '승인'}
          </button>
          <button className="btn btn-ghost" onClick={onClose} disabled={loading !== null}>취소</button>
        </div>
      }
    >
      <div className="form-group">
        <label>관리자 코멘트</label>
        <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)}
          placeholder="승인 코멘트 (선택) 또는 반려 사유 (필수)" autoFocus />
      </div>
    </Modal>
  )
}
