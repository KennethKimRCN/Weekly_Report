import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { projectRecordApi, type Milestone, type ProjectIssue } from '../api'
import type { ProjectRecord as PR } from '../api'
import { useAuthStore } from '../store'
import { useToast } from '../components/ui/Toast'
import { Modal } from '../components/ui/Modal'
import { PageSpinner } from '../components/ui'

const MILESTONE_STATUS = ['planned', 'done', 'delayed', 'cancelled'] as const
const MILESTONE_LABEL: Record<string, string> = {
  planned: '예정',
  done: '완료',
  delayed: '지연',
  cancelled: '취소',
}
const MILESTONE_CHIP: Record<string, string> = {
  planned: 'chip-submitted',
  done: 'chip-approved',
  delayed: 'chip-risk',
  cancelled: 'chip-draft',
}

const ISSUE_STATUS_OPTIONS = ['초안', '진행중', '완료', '취소']
const PRIORITY_OPTIONS = [
  { value: 'normal', label: '일반', chip: 'chip-draft' },
  { value: 'high', label: '중요', chip: 'chip-on_hold' },
]

export default function ProjectRecord() {
  const { projectId } = useParams<{ projectId: string }>()
  const pid = Number(projectId)
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { toast } = useToast()
  const [record, setRecord] = useState<PR | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'issues' | 'milestones'>('issues')

  const [msModal, setMsModal] = useState<Partial<Milestone> | null>(null)
  const [issueModal, setIssueModal] = useState<Partial<ProjectIssue> | null>(null)
  const [progModal, setProgModal] = useState<{
    issueId: number
    issueName: string
    data: Partial<{ id: number; title: string; start_date: string; end_date: string; details: string }>
  } | null>(null)

  const [msSaving, setMsSaving] = useState(false)
  const [issueSaving, setIssueSaving] = useState(false)
  const [progSaving, setProgSaving] = useState(false)

  const today = new Date().toISOString().slice(0, 10)

  async function load() {
    try {
      const res = await projectRecordApi.get(pid)
      setRecord(res.data)
    } catch {
      toast('프로젝트를 불러오지 못했습니다.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [pid])

  if (loading) return <PageSpinner />
  if (!record) return <div style={{ padding: 40, color: 'var(--ink-4)' }}>프로젝트를 찾을 수 없습니다.</div>

  const canEdit = user?.is_admin === 1 || record.assignees.some((assignee) => assignee.id === user?.id)
  const openIssues = record.issues.filter((issue) => !['완료', '취소'].includes(issue.status))
  const closedIssues = record.issues.filter((issue) => ['완료', '취소'].includes(issue.status))

  async function saveMilestone() {
    if (!msModal?.title || !msModal.planned_date) {
      toast('제목과 예정일을 입력해 주세요.', 'error')
      return
    }
    setMsSaving(true)
    try {
      const body = {
        title: msModal.title,
        planned_date: msModal.planned_date,
        actual_date: msModal.actual_date || null,
        status: msModal.status ?? 'planned',
      }
      if (msModal.id) await projectRecordApi.updateMilestone(pid, msModal.id, body)
      else await projectRecordApi.addMilestone(pid, body)
      setMsModal(null)
      await load()
      toast('마일스톤을 저장했습니다.', 'success')
    } catch (e: any) {
      toast(e.response?.data?.detail ?? '저장하지 못했습니다.', 'error')
    } finally {
      setMsSaving(false)
    }
  }

  async function saveIssue() {
    if (!issueModal?.title || !issueModal.start_date) {
      toast('제목과 시작일을 입력해 주세요.', 'error')
      return
    }
    setIssueSaving(true)
    try {
      const body = {
        title: issueModal.title,
        status: issueModal.status ?? '초안',
        priority: issueModal.priority ?? 'normal',
        start_date: issueModal.start_date,
        end_date: issueModal.end_date || null,
        details: issueModal.details || null,
      }
      if (issueModal.id) await projectRecordApi.updateIssue(pid, issueModal.id, body)
      else await projectRecordApi.addIssue(pid, body)
      setIssueModal(null)
      await load()
      toast('이슈를 저장했습니다.', 'success')
    } catch (e: any) {
      toast(e.response?.data?.detail ?? '저장하지 못했습니다.', 'error')
    } finally {
      setIssueSaving(false)
    }
  }

  async function saveProgress() {
    if (!progModal?.data.title || !progModal.data.start_date) {
      toast('제목과 시작일을 입력해 주세요.', 'error')
      return
    }
    setProgSaving(true)
    try {
      const body = {
        title: progModal.data.title,
        start_date: progModal.data.start_date,
        end_date: progModal.data.end_date || null,
        details: progModal.data.details || null,
      }
      if (progModal.data.id) await projectRecordApi.updateProgress(pid, progModal.issueId, progModal.data.id, body)
      else await projectRecordApi.addProgress(pid, progModal.issueId, body)
      setProgModal(null)
      await load()
      toast('진행내역을 저장했습니다.', 'success')
    } catch (e: any) {
      toast(e.response?.data?.detail ?? '저장하지 못했습니다.', 'error')
    } finally {
      setProgSaving(false)
    }
  }

  async function deleteMilestone(id: number) {
    try {
      await projectRecordApi.deleteMilestone(pid, id)
      await load()
      toast('마일스톤을 삭제했습니다.', 'success')
    } catch {
      toast('삭제하지 못했습니다.', 'error')
    }
  }

  async function deleteIssue(id: number) {
    try {
      await projectRecordApi.deleteIssue(pid, id)
      await load()
      toast('이슈를 삭제했습니다.', 'success')
    } catch {
      toast('삭제하지 못했습니다.', 'error')
    }
  }

  async function deleteProgress(issueId: number, progressId: number) {
    try {
      await projectRecordApi.deleteProgress(pid, issueId, progressId)
      await load()
      toast('진행내역을 삭제했습니다.', 'success')
    } catch {
      toast('삭제하지 못했습니다.', 'error')
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <button className="btn btn-ghost btn-sm" style={{ marginBottom: 6, paddingLeft: 4 }} onClick={() => navigate('/projects')}>
            프로젝트 목록
          </button>
          <div className="page-title">{record.project_name}</div>
          <div className="page-subtitle" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            <span>{record.company}</span>
            <span>·</span>
            <span>{record.location}</span>
            {record.wbs_number && <span>· WBS {record.wbs_number}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {record.assignees.map((assignee) => (
            <span key={assignee.id} className="assignee-chip">{assignee.name}</span>
          ))}
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'issues' ? 'active' : ''}`} onClick={() => setTab('issues')}>
          이슈 트래커 <span style={{ marginLeft: 4 }} className={`chip ${openIssues.length > 0 ? 'chip-submitted' : 'chip-draft'}`}>{openIssues.length}</span>
        </button>
        <button className={`tab ${tab === 'milestones' ? 'active' : ''}`} onClick={() => setTab('milestones')}>
          마일스톤 <span style={{ marginLeft: 4 }} className="chip chip-draft">{record.milestones.length}</span>
        </button>
      </div>

      {tab === 'issues' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-eyebrow">이슈 트래커</div>
                <div className="panel-title">진행 중인 이슈</div>
              </div>
              {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setIssueModal({ status: '초안', priority: 'normal', start_date: today })}>+ 이슈 추가</button>}
            </div>
            {openIssues.length === 0 ? <div className="panel-empty">진행 중인 이슈가 없습니다.</div> : openIssues.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                canEdit={canEdit}
                onEdit={() => setIssueModal({ ...issue })}
                onDelete={() => deleteIssue(issue.id)}
                onAddProgress={() => setProgModal({ issueId: issue.id, issueName: issue.title, data: { start_date: today } })}
                onEditProgress={(progress) => setProgModal({ issueId: issue.id, issueName: issue.title, data: { ...progress } })}
                onDeleteProgress={(progressId) => deleteProgress(issue.id, progressId)}
              />
            ))}
          </div>

          {closedIssues.length > 0 && (
            <div className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-eyebrow">완료된 이슈</div>
                  <div className="panel-title">완료 / 취소</div>
                </div>
              </div>
              {closedIssues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  canEdit={canEdit}
                  closed
                  onEdit={() => setIssueModal({ ...issue })}
                  onDelete={() => deleteIssue(issue.id)}
                  onAddProgress={() => setProgModal({ issueId: issue.id, issueName: issue.title, data: { start_date: today } })}
                  onEditProgress={(progress) => setProgModal({ issueId: issue.id, issueName: issue.title, data: { ...progress } })}
                  onDeleteProgress={(progressId) => deleteProgress(issue.id, progressId)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'milestones' && (
        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-eyebrow">프로젝트 일정</div>
              <div className="panel-title">마일스톤</div>
            </div>
            {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setMsModal({ status: 'planned', planned_date: today })}>+ 마일스톤 추가</button>}
          </div>
          {record.milestones.length === 0 ? (
            <div className="panel-empty">등록된 마일스톤이 없습니다.</div>
          ) : (
            <div className="table-wrap" style={{ border: 'none', borderRadius: 'var(--radius)' }}>
              <table>
                <thead>
                  <tr>
                    <th>항목</th>
                    <th>예정일</th>
                    <th>실행일</th>
                    <th>상태</th>
                    {canEdit && <th>작업</th>}
                  </tr>
                </thead>
                <tbody>
                  {record.milestones.map((milestone) => (
                    <tr key={milestone.id} style={{ opacity: milestone.status === 'cancelled' ? 0.6 : 1 }}>
                      <td className="fw-500">{milestone.title}</td>
                      <td>{milestone.planned_date}</td>
                      <td>{milestone.actual_date || <span className="text-muted">-</span>}</td>
                      <td><span className={`chip ${MILESTONE_CHIP[milestone.status]}`}>{MILESTONE_LABEL[milestone.status]}</span></td>
                      {canEdit && <td><button className="btn btn-ghost btn-sm" onClick={() => setMsModal({ ...milestone })}>편집</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {msModal && (
        <Modal
          title={msModal.id ? '마일스톤 편집' : '마일스톤 추가'}
          onClose={() => setMsModal(null)}
          footer={
            <div className="flex gap-6">
              {msModal.id && <button className="btn btn-danger btn-sm" style={{ marginRight: 'auto' }} onClick={() => { deleteMilestone(msModal.id!); setMsModal(null) }}>삭제</button>}
              <button className="btn btn-primary" disabled={msSaving} onClick={saveMilestone}>{msSaving ? '저장 중...' : '저장'}</button>
              <button className="btn btn-ghost" onClick={() => setMsModal(null)}>취소</button>
            </div>
          }
        >
          <div className="form-group">
            <label>제목</label>
            <input value={msModal.title ?? ''} onChange={(e) => setMsModal({ ...msModal, title: e.target.value })} autoFocus />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>예정일</label>
              <input type="date" value={msModal.planned_date ?? ''} onChange={(e) => setMsModal({ ...msModal, planned_date: e.target.value })} />
            </div>
            <div className="form-group">
              <label>실행일</label>
              <input type="date" value={msModal.actual_date ?? ''} onChange={(e) => setMsModal({ ...msModal, actual_date: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label>상태</label>
            <select value={msModal.status ?? 'planned'} onChange={(e) => setMsModal({ ...msModal, status: e.target.value })}>
              {MILESTONE_STATUS.map((status) => <option key={status} value={status}>{MILESTONE_LABEL[status]}</option>)}
            </select>
          </div>
        </Modal>
      )}

      {issueModal && (
        <Modal
          title={issueModal.id ? '이슈 편집' : '이슈 추가'}
          onClose={() => setIssueModal(null)}
          footer={
            <div className="flex gap-6">
              {issueModal.id && <button className="btn btn-danger btn-sm" style={{ marginRight: 'auto' }} onClick={() => { deleteIssue(issueModal.id!); setIssueModal(null) }}>삭제</button>}
              <button className="btn btn-primary" disabled={issueSaving} onClick={saveIssue}>{issueSaving ? '저장 중...' : '저장'}</button>
              <button className="btn btn-ghost" onClick={() => setIssueModal(null)}>취소</button>
            </div>
          }
        >
          <div className="form-group">
            <label>제목</label>
            <input value={issueModal.title ?? ''} onChange={(e) => setIssueModal({ ...issueModal, title: e.target.value })} autoFocus />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>상태</label>
              <select value={issueModal.status ?? '초안'} onChange={(e) => setIssueModal({ ...issueModal, status: e.target.value })}>
                {ISSUE_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>우선순위</label>
              <select value={issueModal.priority ?? 'normal'} onChange={(e) => setIssueModal({ ...issueModal, priority: e.target.value })}>
                {PRIORITY_OPTIONS.map((priority) => <option key={priority.value} value={priority.value}>{priority.label}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>시작일</label>
              <input type="date" value={issueModal.start_date ?? ''} onChange={(e) => setIssueModal({ ...issueModal, start_date: e.target.value })} />
            </div>
            <div className="form-group">
              <label>종료일</label>
              <input type="date" value={issueModal.end_date ?? ''} onChange={(e) => setIssueModal({ ...issueModal, end_date: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label>상세 내용</label>
            <textarea rows={3} value={issueModal.details ?? ''} onChange={(e) => setIssueModal({ ...issueModal, details: e.target.value })} />
          </div>
        </Modal>
      )}

      {progModal && (
        <Modal
          title={progModal.data.id ? '진행내역 편집' : `진행내역 추가 · ${progModal.issueName}`}
          onClose={() => setProgModal(null)}
          footer={
            <div className="flex gap-6">
              {progModal.data.id && <button className="btn btn-danger btn-sm" style={{ marginRight: 'auto' }} onClick={() => { deleteProgress(progModal.issueId, progModal.data.id!); setProgModal(null) }}>삭제</button>}
              <button className="btn btn-primary" disabled={progSaving} onClick={saveProgress}>{progSaving ? '저장 중...' : '저장'}</button>
              <button className="btn btn-ghost" onClick={() => setProgModal(null)}>취소</button>
            </div>
          }
        >
          <div className="form-group">
            <label>제목</label>
            <input value={progModal.data.title ?? ''} onChange={(e) => setProgModal({ ...progModal, data: { ...progModal.data, title: e.target.value } })} autoFocus />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>시작일</label>
              <input type="date" value={progModal.data.start_date ?? ''} onChange={(e) => setProgModal({ ...progModal, data: { ...progModal.data, start_date: e.target.value } })} />
            </div>
            <div className="form-group">
              <label>종료일</label>
              <input type="date" value={progModal.data.end_date ?? ''} onChange={(e) => setProgModal({ ...progModal, data: { ...progModal.data, end_date: e.target.value } })} />
            </div>
          </div>
          <div className="form-group">
            <label>내용</label>
            <textarea rows={3} value={progModal.data.details ?? ''} onChange={(e) => setProgModal({ ...progModal, data: { ...progModal.data, details: e.target.value } })} />
          </div>
        </Modal>
      )}
    </div>
  )
}

function IssueCard({
  issue,
  canEdit,
  closed = false,
  onEdit,
  onDelete,
  onAddProgress,
  onEditProgress,
  onDeleteProgress,
}: {
  issue: ProjectIssue
  canEdit: boolean
  closed?: boolean
  onEdit: () => void
  onDelete: () => void
  onAddProgress: () => void
  onEditProgress: (progress: any) => void
  onDeleteProgress: (progressId: number) => void
}) {
  const [expanded, setExpanded] = useState(!closed)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const priority = PRIORITY_OPTIONS.find((option) => option.value === issue.priority) ?? PRIORITY_OPTIONS[1]
  const statusChip = issue.status === '완료' ? 'chip-approved' : issue.status === '취소' ? 'chip-cancelled' : issue.status === '진행중' ? 'chip-submitted' : 'chip-draft'

  return (
    <div style={{ borderBottom: '1px solid var(--border-2)', padding: '14px 20px', opacity: closed ? 0.75 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <button style={{ background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer', color: 'var(--ink-4)', flexShrink: 0, marginTop: 1 }} onClick={() => setExpanded((value) => !value)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s' }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 500, fontSize: 14, color: 'var(--ink)' }}>{issue.title}</span>
            <span className={`chip ${priority.chip}`} style={{ fontSize: 10 }}>{priority.label}</span>
            <span className={`chip ${statusChip}`} style={{ fontSize: 10 }}>{issue.status}</span>
          </div>
          {issue.details && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>{issue.details}</div>}
          <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>
            {issue.start_date}
            {issue.end_date ? ` ~ ${issue.end_date}` : ''}
            {issue.progresses.length > 0 && ` · ${issue.progresses.length}개 진행내역`}
          </div>
        </div>

        {canEdit && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button className="btn btn-ghost btn-sm" onClick={onEdit}>편집</button>
            {confirmDelete ? (
              <>
                <button className="btn btn-danger btn-sm" onClick={onDelete}>확인</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>취소</button>
              </>
            ) : (
              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => setConfirmDelete(true)}>삭제</button>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div style={{ marginTop: 10, marginLeft: 24, borderLeft: '2px solid var(--border-2)', paddingLeft: 14 }}>
          {issue.progresses.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-5)', padding: '4px 0' }}>진행내역이 없습니다.</div>
          ) : issue.progresses.map((progress) => (
            <div key={progress.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid var(--border-2)' }}>
              <div style={{ width: 108, fontSize: 11, color: 'var(--ink-4)', flexShrink: 0, paddingTop: 2 }}>
                {progress.start_date}{progress.end_date && progress.end_date !== progress.start_date ? ` ~ ${progress.end_date}` : ''}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{progress.title}</div>
                {progress.details && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{progress.details}</div>}
                {progress.author_name && <div style={{ fontSize: 11, color: 'var(--ink-5)', marginTop: 1 }}>{progress.author_name}</div>}
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                  <button className="btn btn-ghost btn-sm" style={{ padding: '3px 8px' }} onClick={() => onEditProgress(progress)}>편집</button>
                  <button className="btn btn-ghost btn-sm" style={{ padding: '3px 8px', color: 'var(--red)' }} onClick={() => onDeleteProgress(progress.id)}>삭제</button>
                </div>
              )}
            </div>
          ))}
          {canEdit && <button className="btn btn-text btn-sm" style={{ marginTop: 6 }} onClick={onAddProgress}>+ 진행내역 추가</button>}
        </div>
      )}
    </div>
  )
}
