import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
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
const ISSUE_STATUS_META: Record<string, { chip: string; columnClass: string }> = {
  초안: { chip: 'chip-draft', columnClass: 'kanban-column-draft' },
  진행중: { chip: 'chip-submitted', columnClass: 'kanban-column-active' },
  완료: { chip: 'chip-approved', columnClass: 'kanban-column-done' },
  취소: { chip: 'chip-cancelled', columnClass: 'kanban-column-cancelled' },
}

export default function ProjectRecord() {
  const { projectId } = useParams<{ projectId: string }>()
  const pid = Number(projectId)
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { toast } = useToast()
  const [record, setRecord] = useState<PR | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'issues' | 'milestones'>('issues')
  const [issueView, setIssueView] = useState<'kanban' | 'timeline'>('kanban')
  const [issueSearch, setIssueSearch] = useState('')
  const [issueDateFrom, setIssueDateFrom] = useState('')
  const [issueDateTo, setIssueDateTo] = useState('')
  const [issueThisWeek, setIssueThisWeek] = useState(false)

  const [msModal, setMsModal] = useState<Partial<Milestone> | null>(null)
  const [issueModal, setIssueModal] = useState<Partial<ProjectIssue> | null>(null)
  const [detailIssue, setDetailIssue] = useState<ProjectIssue | null>(null)
  const [progModal, setProgModal] = useState<{
    issueId: number
    issueName: string
    data: Partial<{ id: number; title: string; start_date: string; end_date: string; details: string }>
  } | null>(null)

  const [msSaving, setMsSaving] = useState(false)
  const [issueSaving, setIssueSaving] = useState(false)
  const [progSaving, setProgSaving] = useState(false)

  const today = new Date().toISOString().slice(0, 10)

  async function load(keepDetailId?: number) {
    try {
      const res = await projectRecordApi.get(pid)
      setRecord(res.data)
      if (keepDetailId !== undefined) {
        const fresh = res.data.issues.find((i: ProjectIssue) => i.id === keepDetailId)
        if (fresh) setDetailIssue(fresh)
      }
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
  const thisWeekRange = getThisWeekRange()
  const effectiveIssueDateFrom = issueThisWeek ? thisWeekRange.from : issueDateFrom
  const effectiveIssueDateTo = issueThisWeek ? thisWeekRange.to : issueDateTo
  const issueQuery = issueSearch.trim().toLowerCase()
  const hasIssueFilters = Boolean(issueQuery || effectiveIssueDateFrom || effectiveIssueDateTo)

  const filteredIssueEntries = record.issues
    .map((issue) => {
      const issueMatchesQuery = !issueQuery || matchesIssueQuery(issue, issueQuery)
      const issueMatchesDate = !effectiveIssueDateFrom && !effectiveIssueDateTo
        ? true
        : doesRangeOverlap(issue.start_date, issue.end_date, effectiveIssueDateFrom, effectiveIssueDateTo)

      const matchedProgresses = issue.progresses.filter((progress) => {
        const queryMatch = !issueQuery || matchesProgressQuery(progress, issueQuery)
        const dateMatch = !effectiveIssueDateFrom && !effectiveIssueDateTo
          ? true
          : doesRangeOverlap(progress.start_date, progress.end_date, effectiveIssueDateFrom, effectiveIssueDateTo)
        return queryMatch && dateMatch
      })

      return {
        issue,
        matchedProgresses,
        isMatch: !hasIssueFilters || (issueMatchesQuery && issueMatchesDate) || matchedProgresses.length > 0,
      }
    })
    .filter((entry) => entry.isMatch)

  const issueColumns = ISSUE_STATUS_OPTIONS.map((status) => ({
    status,
    issues: filteredIssueEntries.filter((entry) => entry.issue.status === status),
  }))

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
      const keepId = progModal.issueId
      setProgModal(null)
      await load(keepId)
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
      await load(issueId)
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
        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-eyebrow">이슈 트래커</div>
              <div className="panel-title">{issueView === 'kanban' ? '칸반 보드' : '타임라인'}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Kanban / Timeline toggle */}
              <div className="view-toggle">
                <button
                  className={`view-toggle-btn ${issueView === 'kanban' ? 'active' : ''}`}
                  onClick={() => setIssueView('kanban')}
                  title="칸반 보드"
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <rect x="1" y="2" width="4" height="12" rx="1.5" />
                    <rect x="6" y="2" width="4" height="8" rx="1.5" />
                    <rect x="11" y="2" width="4" height="10" rx="1.5" />
                  </svg>
                  칸반
                </button>
                <button
                  className={`view-toggle-btn ${issueView === 'timeline' ? 'active' : ''}`}
                  onClick={() => setIssueView('timeline')}
                  title="타임라인"
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <line x1="1" y1="4" x2="15" y2="4" />
                    <line x1="1" y1="8" x2="15" y2="8" />
                    <line x1="1" y1="12" x2="15" y2="12" />
                    <rect x="2" y="2.5" width="5" height="3" rx="1" fill="currentColor" stroke="none" />
                    <rect x="7" y="6.5" width="6" height="3" rx="1" fill="currentColor" stroke="none" />
                    <rect x="3" y="10.5" width="8" height="3" rx="1" fill="currentColor" stroke="none" />
                  </svg>
                  타임라인
                </button>
              </div>
              {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setIssueModal({ status: '초안', priority: 'normal', start_date: today })}>+ 이슈 추가</button>}
            </div>
          </div>

          <div className="panel-body">
            <div className="issue-search-bar">
              <div className="issue-search-row">
                <div className="issue-search-input-wrap">
                  <span className="issue-search-icon" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                  </span>
                  <input
                    className="issue-search-input"
                    value={issueSearch}
                    onChange={(e) => setIssueSearch(e.target.value)}
                    placeholder="이슈 제목, 내용, 진행내역까지 검색"
                  />
                  {issueSearch && (
                    <button className="issue-search-clear" onClick={() => setIssueSearch('')} aria-label="검색어 지우기">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>

                <div className="issue-search-range">
                  <input
                    className="issue-date-input"
                    type="date"
                    value={issueDateFrom}
                    onChange={(e) => { setIssueThisWeek(false); setIssueDateFrom(e.target.value) }}
                  />
                  <span className="issue-range-sep">~</span>
                  <input
                    className="issue-date-input"
                    type="date"
                    value={issueDateTo}
                    onChange={(e) => { setIssueThisWeek(false); setIssueDateTo(e.target.value) }}
                  />
                  <button
                    className={`btn btn-ghost btn-sm ${issueThisWeek ? 'issue-filter-week-active' : ''}`}
                    onClick={() => setIssueThisWeek((value) => !value)}
                  >
                    이번 주
                  </button>
                  {(hasIssueFilters || issueThisWeek) && (
                    <button
                      className="issue-search-reset"
                      onClick={() => {
                        setIssueSearch('')
                        setIssueDateFrom('')
                        setIssueDateTo('')
                        setIssueThisWeek(false)
                      }}
                    >
                      초기화
                    </button>
                  )}
                </div>
              </div>

              <div className="issue-search-summary">
                <span>결과 <strong>{filteredIssueEntries.length}</strong>건</span>
                {issueQuery && <span className="iss-mode-badge">검색어 적용</span>}
                {issueThisWeek && (
                  <span className="iss-range-chip">이번 주 {effectiveIssueDateFrom} ~ {effectiveIssueDateTo}</span>
                )}
                {!issueThisWeek && (effectiveIssueDateFrom || effectiveIssueDateTo) && (
                  <span className="iss-range-chip">
                    날짜 {effectiveIssueDateFrom || '시작'} ~ {effectiveIssueDateTo || '종료'}
                  </span>
                )}
                <span>이슈 항목과 진행내역 둘 다 검색/필터링됩니다.</span>
              </div>
            </div>

            {issueView === 'kanban' ? (
              <div className="kanban-board">
                {issueColumns.map((column) => (
                  <section
                    key={column.status}
                    className={`kanban-column ${ISSUE_STATUS_META[column.status].columnClass}`}
                  >
                    <div className="kanban-column-header">
                      <div className="kanban-column-title-row">
                        <span className="kanban-column-title">{column.status}</span>
                        <span className={`chip ${ISSUE_STATUS_META[column.status].chip}`}>{column.issues.length}</span>
                      </div>
                      <div className="kanban-column-subtitle">
                        {column.status === '진행중' ? '현재 진행 중인 업무' : column.status === '초안' ? '정리 중인 업무' : column.status === '완료' ? '마무리된 업무' : '중단되거나 보류된 업무'}
                      </div>
                    </div>

                    <div className="kanban-column-body">
                      {column.issues.length === 0 ? (
                        <div className="kanban-empty">이 상태의 이슈가 없습니다.</div>
                      ) : column.issues.map(({ issue, matchedProgresses }) => (
                        <IssueCard
                          key={issue.id}
                          issue={issue}
                          matchedProgresses={matchedProgresses}
                          searchActive={hasIssueFilters}
                          canEdit={canEdit}
                          closed={column.status === '완료' || column.status === '취소'}
                          onOpen={() => setDetailIssue(issue)}
                          onEdit={() => setIssueModal({ ...issue })}
                          onDelete={() => deleteIssue(issue.id)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <IssueTimeline
                issues={filteredIssueEntries.map((entry) => entry.issue)}
                today={today}
                canEdit={canEdit}
                onOpen={(issue) => setDetailIssue(issue)}
                onEdit={(issue) => setIssueModal({ ...issue })}
              />
            )}
          </div>
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
            <div className="milestone-timeline">
              {/* Summary stats row */}
              <div className="milestone-stats">
                {(['planned','done','delayed','cancelled'] as const).map((s) => {
                  const count = record.milestones.filter(m => m.status === s).length
                  return (
                    <div key={s} className={`milestone-stat milestone-stat-${s}`}>
                      <span className="milestone-stat-count">{count}</span>
                      <span className="milestone-stat-label">{MILESTONE_LABEL[s]}</span>
                    </div>
                  )
                })}
              </div>

              {/* Timeline items */}
              <div className="milestone-track">
                <div className="milestone-spine" />
                {record.milestones
                  .slice()
                  .sort((a, b) => a.planned_date.localeCompare(b.planned_date))
                  .map((milestone, idx) => {
                    const isDone = milestone.status === 'done'
                    const isDelayed = milestone.status === 'delayed'
                    const isCancelled = milestone.status === 'cancelled'
                    const isOverdue = !isDone && !isCancelled && milestone.planned_date < today
                    const dotClass = isDone ? 'ms-dot-done' : isDelayed || isOverdue ? 'ms-dot-delayed' : isCancelled ? 'ms-dot-cancelled' : 'ms-dot-planned'
                    return (
                      <div key={milestone.id} className={`milestone-row ${isCancelled ? 'ms-row-cancelled' : ''}`}>
                        {/* Dot + connector */}
                        <div className="milestone-dot-col">
                          <div className={`milestone-dot ${dotClass}`}>
                            {isDone && (
                              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="2 6 5 9 10 3" />
                              </svg>
                            )}
                            {(isDelayed || isOverdue) && !isDone && (
                              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                <line x1="6" y1="3" x2="6" y2="7" /><circle cx="6" cy="9.5" r="0.8" fill="currentColor" />
                              </svg>
                            )}
                            {isCancelled && (
                              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                <line x1="3" y1="3" x2="9" y2="9" /><line x1="9" y1="3" x2="3" y2="9" />
                              </svg>
                            )}
                          </div>
                        </div>

                        {/* Content card */}
                        <div className="milestone-card">
                          <div className="milestone-card-top">
                            <div className="milestone-card-title">{milestone.title}</div>
                            <div className="milestone-card-actions">
                              <span className={`chip ${MILESTONE_CHIP[milestone.status]}`}>{MILESTONE_LABEL[milestone.status]}</span>
                              {canEdit && (
                                <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px' }} onClick={() => setMsModal({ ...milestone })}>편집</button>
                              )}
                            </div>
                          </div>
                          <div className="milestone-card-dates">
                            <span className="milestone-date-item">
                              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                                <rect x="2" y="3" width="12" height="11" rx="2" /><line x1="5" y1="1" x2="5" y2="5" /><line x1="11" y1="1" x2="11" y2="5" /><line x1="2" y1="7" x2="14" y2="7" />
                              </svg>
                              예정 <strong>{milestone.planned_date}</strong>
                            </span>
                            {milestone.actual_date && (
                              <span className="milestone-date-item ms-actual">
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                                  <circle cx="8" cy="8" r="6" /><polyline points="8 5 8 8 10.5 10" />
                                </svg>
                                실행 <strong>{milestone.actual_date}</strong>
                              </span>
                            )}
                            {isOverdue && !isDone && (
                              <span className="milestone-date-item ms-overdue">기한 초과</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
              </div>
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

      {detailIssue && (
        <IssueDetailModal
          issue={detailIssue}
          canEdit={canEdit}
          today={today}
          onClose={() => setDetailIssue(null)}
          onEdit={() => { setIssueModal({ ...detailIssue }); setDetailIssue(null) }}
          onDelete={() => { deleteIssue(detailIssue.id); setDetailIssue(null) }}
          onAddProgress={() => setProgModal({ issueId: detailIssue.id, issueName: detailIssue.title, data: { start_date: today } })}
          onEditProgress={(progress) => setProgModal({ issueId: detailIssue.id, issueName: detailIssue.title, data: { ...progress } })}
          onDeleteProgress={(progressId) => deleteProgress(detailIssue.id, progressId)}
        />
      )}
    </div>
  )
}

function matchesIssueQuery(issue: ProjectIssue, query: string) {
  return [
    issue.title,
    issue.details ?? '',
    issue.status,
    issue.priority ?? '',
    issue.start_date,
    issue.end_date ?? '',
  ].join(' ').toLowerCase().includes(query)
}

function matchesProgressQuery(progress: ProjectIssue['progresses'][number], query: string) {
  return [
    progress.title,
    progress.details ?? '',
    progress.author_name ?? '',
    progress.start_date,
    progress.end_date ?? '',
  ].join(' ').toLowerCase().includes(query)
}

function doesRangeOverlap(start: string, end: string | null | undefined, from: string, to: string) {
  const rangeStart = from ? new Date(from) : null
  const rangeEnd = to ? new Date(to) : null
  const itemStart = new Date(start)
  const itemEnd = new Date(end ?? start)

  if (rangeStart && itemEnd < rangeStart) return false
  if (rangeEnd && itemStart > rangeEnd) return false
  return true
}

function getThisWeekRange() {
  const now = new Date()
  const day = now.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const start = new Date(now)
  start.setDate(now.getDate() + diffToMonday)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  end.setHours(23, 59, 59, 999)
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  }
}

function IssueCard({
  issue,
  matchedProgresses,
  searchActive,
  canEdit,
  closed = false,
  onOpen,
  onEdit,
  onDelete,
}: {
  issue: ProjectIssue
  matchedProgresses?: ProjectIssue['progresses']
  searchActive?: boolean
  canEdit: boolean
  closed?: boolean
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const priority = PRIORITY_OPTIONS.find((option) => option.value === issue.priority) ?? PRIORITY_OPTIONS[0]
  const statusChip = issue.status === '완료' ? 'chip-approved' : issue.status === '취소' ? 'chip-cancelled' : issue.status === '진행중' ? 'chip-submitted' : 'chip-draft'
  const visibleProgresses = matchedProgresses ?? []

  return (
    <div
      className={`project-issue-card ${closed ? 'is-closed' : ''} issue-card-clickable`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
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
            {issue.progresses.length > 0 && (
              <span style={{ marginLeft: 4, color: 'var(--blue)', fontWeight: 500 }}>
                · 진행내역 {issue.progresses.length}개
              </span>
            )}
          </div>
        </div>

        {canEdit && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
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

      {searchActive && visibleProgresses.length > 0 ? (
        <div className="issue-card-prog-snippets">
          {visibleProgresses.slice(0, 2).map((progress) => (
            <div key={progress.id} className="issue-card-prog-snippet">
              <span className="icps-date">{progress.start_date}{progress.end_date && progress.end_date !== progress.start_date ? ` ~ ${progress.end_date}` : ''}</span>
              <span className="icps-title">{progress.title}</span>
              {progress.details && <span className="icps-details">{progress.details}</span>}
            </div>
          ))}
          {visibleProgresses.length > 2 && <div className="icps-more">외 {visibleProgresses.length - 2}건 더 보기</div>}
        </div>
      ) : issue.progresses.length > 0 && (
        <div className="issue-card-progress-hint">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="8" cy="8" r="6" /><line x1="8" y1="5" x2="8" y2="8" /><line x1="8" y1="8" x2="10" y2="10" />
          </svg>
          진행내역 보기
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="8" x2="12" y2="8" /><polyline points="9 5 12 8 9 11" />
          </svg>
        </div>
      )}
    </div>
  )
}

function IssueDetailModal({
  issue,
  canEdit,
  today,
  onClose,
  onEdit,
  onDelete,
  onAddProgress,
  onEditProgress,
  onDeleteProgress,
}: {
  issue: ProjectIssue
  canEdit: boolean
  today: string
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  onAddProgress: () => void
  onEditProgress: (progress: any) => void
  onDeleteProgress: (progressId: number) => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const priority = PRIORITY_OPTIONS.find((o) => o.value === issue.priority) ?? PRIORITY_OPTIONS[0]
  const statusChip = ISSUE_STATUS_META[issue.status]?.chip ?? 'chip-draft'
  const isClosed = issue.status === '완료' || issue.status === '취소'

  // Sort progresses newest-first
  const sortedProgresses = [...issue.progresses].sort((a, b) => b.start_date.localeCompare(a.start_date))

  // Duration helper
  function daysBetween(a: string, b: string) {
    const diff = (new Date(b).getTime() - new Date(a).getTime()) / 86400000
    return Math.round(diff)
  }

  const durationLabel = issue.end_date
    ? `${daysBetween(issue.start_date, issue.end_date)}일`
    : '종료일 미정'

  const isOverdue = !isClosed && issue.end_date && issue.end_date < today

  return createPortal(
    <div className="issue-detail-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="issue-detail-panel">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="issue-detail-header">
          <div className="issue-detail-header-top">
            <div className="issue-detail-badges">
              <span className={`chip ${statusChip}`}>{issue.status}</span>
              <span className={`chip ${priority.chip}`}>{priority.label}</span>
              {isOverdue && <span className="chip chip-risk" style={{ fontSize: 10 }}>기한 초과</span>}
            </div>
            <button className="issue-detail-close" onClick={onClose} aria-label="닫기">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <h2 className="issue-detail-title">{issue.title}</h2>

          {/* Meta grid — consistent icon+label style */}
          <div className="issue-detail-meta">
            <span className="issue-detail-meta-item">
              {/* calendar icon */}
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="2" y="3" width="12" height="11" rx="2" />
                <line x1="5" y1="1" x2="5" y2="5" /><line x1="11" y1="1" x2="11" y2="5" /><line x1="2" y1="7" x2="14" y2="7" />
              </svg>
              {issue.start_date}
              {issue.end_date ? ` ~ ${issue.end_date}` : ''}
            </span>
            <span className="issue-detail-meta-item" style={{ color: isOverdue ? 'var(--red)' : undefined }}>
              {/* clock icon */}
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="8" cy="8" r="6" />
                <line x1="8" y1="5" x2="8" y2="8" /><line x1="8" y1="8" x2="10.5" y2="10" />
              </svg>
              {durationLabel}
            </span>
            {issue.progresses.length > 0 && (
              <span className="issue-detail-meta-item" style={{ color: 'var(--blue)' }}>
                {/* activity icon */}
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <polyline points="1 8 4 5 7 9 10 4 13 7 15 5" />
                </svg>
                진행내역 {issue.progresses.length}건
              </span>
            )}
          </div>

          {issue.details && (
            <p className="issue-detail-description">{issue.details}</p>
          )}

          {canEdit && (
            <div className="issue-detail-actions">
              <button className="btn btn-primary btn-sm" onClick={onEdit}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}>
                  <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13H3v-2L11.5 2.5z" />
                </svg>
                이슈 편집
              </button>
              {confirmDelete ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--red)' }}>삭제하시겠습니까?</span>
                  <button className="btn btn-danger btn-sm" onClick={onDelete}>확인</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>취소</button>
                </div>
              ) : (
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => setConfirmDelete(true)}>삭제</button>
              )}
            </div>
          )}
        </div>

        {/* ── Progress timeline body ─────────────────────────────── */}
        <div className="issue-detail-body">
          <div className="issue-detail-section-header">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: 'var(--blue)', flexShrink: 0 }}>
              <polyline points="1 8 4 5 7 9 10 4 13 7 15 5" />
            </svg>
            <span className="issue-detail-section-title">진행내역</span>
            {issue.progresses.length > 0 && (
              <span className="chip chip-submitted" style={{ fontSize: 11 }}>{issue.progresses.length}</span>
            )}
            {canEdit && (
              <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={onAddProgress}>+ 추가</button>
            )}
          </div>

          {sortedProgresses.length === 0 ? (
            <div className="issue-detail-empty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ color: 'var(--ink-5)', marginBottom: 8 }}>
                <polyline points="2 15 7 10 11 14 17 8 22 13" /><line x1="2" y1="20" x2="22" y2="20" />
              </svg>
              <span>아직 진행내역이 없습니다.</span>
              {canEdit && (
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={onAddProgress}>첫 진행내역 추가하기</button>
              )}
            </div>
          ) : (
            <div className="issue-detail-progress-list">
              {sortedProgresses.map((progress, idx) => {
                const isLatest = idx === 0
                return (
                  <div key={progress.id} className="issue-detail-progress-item">
                    {/* Spine dot — filled blue for latest, outlined for older */}
                    <div className="idp-spine-dot" style={
                      isLatest
                        ? { background: 'var(--blue)', borderColor: 'var(--blue)', boxShadow: '0 0 0 3px var(--blue-light)' }
                        : {}
                    }>
                      {isLatest && (
                        <svg width="7" height="7" viewBox="0 0 8 8" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round">
                          <polyline points="1 4 3 6 7 2" />
                        </svg>
                      )}
                    </div>
                    <div className="idp-content">
                      <div className="idp-top">
                        <div className="idp-date">
                          {progress.start_date}
                          {progress.end_date && progress.end_date !== progress.start_date
                            ? ` ~ ${progress.end_date}`
                            : ''}
                          {isLatest && (
                            <span style={{
                              marginLeft: 6,
                              fontSize: 10,
                              fontWeight: 600,
                              padding: '1px 6px',
                              borderRadius: 20,
                              background: 'var(--blue-light)',
                              color: 'var(--blue)',
                            }}>최신</span>
                          )}
                        </div>
                        {canEdit && (
                          <div className="idp-btns">
                            <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px' }} onClick={() => onEditProgress(progress)}>편집</button>
                            <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', color: 'var(--red)' }} onClick={() => onDeleteProgress(progress.id)}>삭제</button>
                          </div>
                        )}
                      </div>
                      <div className="idp-title">{progress.title}</div>
                      {progress.details && <div className="idp-details">{progress.details}</div>}
                      {progress.author_name && (
                        <div className="idp-author">
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ marginRight: 3, verticalAlign: 'middle' }}>
                            <circle cx="8" cy="5" r="3" /><path d="M2 13c0-3 2.7-5 6-5s6 2 6 5" />
                          </svg>
                          {progress.author_name}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  , document.body)
}

function IssueTimeline({
  issues,
  today,
  canEdit,
  onOpen,
  onEdit,
}: {
  issues: ProjectIssue[]
  today: string
  canEdit: boolean
  onOpen: (issue: ProjectIssue) => void
  onEdit: (issue: ProjectIssue) => void
}) {
  // Group issues by status order for visual grouping
  const sorted = [...issues].sort((a, b) => {
    const order: Record<string, number> = { 진행중: 0, 초안: 1, 완료: 2, 취소: 3 }
    const oA = order[a.status] ?? 9
    const oB = order[b.status] ?? 9
    if (oA !== oB) return oA - oB
    return a.start_date.localeCompare(b.start_date)
  })

  if (sorted.length === 0) {
    return <div className="kanban-empty" style={{ minHeight: 120 }}>등록된 이슈가 없습니다.</div>
  }

  // Determine date range — include progress dates too
  const allDates = sorted.flatMap(i => [
    i.start_date,
    i.end_date ?? i.start_date,
    ...i.progresses.flatMap(p => [p.start_date, p.end_date ?? p.start_date]),
  ])
  const minDate = new Date(allDates.reduce((a, b) => a < b ? a : b))
  const maxDate = new Date(allDates.reduce((a, b) => a > b ? a : b))

  // Padding
  minDate.setDate(minDate.getDate() - 5)
  maxDate.setDate(maxDate.getDate() + 5)

  const totalDays = Math.max(1, (maxDate.getTime() - minDate.getTime()) / 86400000)

  function pct(dateStr: string) {
    const d = new Date(dateStr)
    return Math.max(0, Math.min(100, ((d.getTime() - minDate.getTime()) / 86400000 / totalDays) * 100))
  }

  // Month + week ruler labels
  const months: { label: string; pct: number }[] = []
  const cur = new Date(minDate)
  cur.setDate(1)
  while (cur <= maxDate) {
    const p = pct(cur.toISOString().slice(0, 10))
    months.push({
      label: `${cur.getFullYear()}.${String(cur.getMonth() + 1).padStart(2, '0')}`,
      pct: p,
    })
    cur.setMonth(cur.getMonth() + 1)
  }

  const todayPct = pct(today)

  // Summary stats
  const statusCounts: Record<string, number> = { 진행중: 0, 초안: 0, 완료: 0, 취소: 0 }
  issues.forEach(i => { statusCounts[i.status] = (statusCounts[i.status] ?? 0) + 1 })
  const totalProgresses = issues.reduce((sum, i) => sum + i.progresses.length, 0)

  // Progress dot colors by recency (newest = solid blue, older = lighter)
  function progressDotStyle(idx: number, total: number) {
    if (total === 0) return {}
    const alpha = 1 - (idx / total) * 0.6
    return { opacity: alpha }
  }

  return (
    <div className="issue-timeline">

      {/* ── Summary strip ────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 10, flexWrap: 'wrap',
        marginBottom: 20, padding: '12px 16px',
        background: 'var(--surface-2)', borderRadius: 10,
        border: '1px solid var(--border-2)',
      }}>
        {([
          { label: '진행중', chip: 'chip-submitted' },
          { label: '초안',   chip: 'chip-draft' },
          { label: '완료',   chip: 'chip-approved' },
          { label: '취소',   chip: 'chip-cancelled' },
        ] as const).map(({ label, chip }) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-3)' }}>
            <span className={`chip ${chip}`} style={{ fontSize: 11 }}>{label}</span>
            <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{statusCounts[label] ?? 0}</strong>
          </span>
        ))}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--ink-4)' }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <polyline points="1 8 4 5 7 9 10 4 13 7 15 5" />
          </svg>
          진행내역 총 {totalProgresses}건
        </span>
      </div>

      {/* ── Ruler ────────────────────────────────────────────────── */}
      <div className="itl-ruler">
        {months.map((m) => (
          <div key={m.label} className="itl-month-label" style={{ left: `${m.pct}%` }}>{m.label}</div>
        ))}
        {todayPct >= 0 && todayPct <= 100 && (
          <div className="itl-today-line" style={{ left: `${todayPct}%` }}>
            <div className="itl-today-badge">오늘</div>
          </div>
        )}
      </div>

      {/* ── Issue rows ───────────────────────────────────────────── */}
      <div className="itl-rows">
        {sorted.map((issue) => {
          const startPct  = pct(issue.start_date)
          const endPct    = pct(issue.end_date ?? issue.start_date)
          const widthPct  = Math.max(endPct - startPct, 1.5)
          const isDone      = issue.status === '완료'
          const isCancelled = issue.status === '취소'
          const isActive    = issue.status === '진행중'
          const isHigh      = issue.priority === 'high'
          const isOverdue   = !isDone && !isCancelled && issue.end_date && issue.end_date < today

          const barClass = isDone      ? 'itl-bar-done'
            : isCancelled ? 'itl-bar-cancelled'
            : isActive    ? 'itl-bar-active'
            : 'itl-bar-draft'

          const statusChip  = ISSUE_STATUS_META[issue.status]?.chip ?? 'chip-draft'
          const progSorted  = [...issue.progresses].sort((a, b) => b.start_date.localeCompare(a.start_date))

          return (
            <div key={issue.id} style={{ marginBottom: issue.progresses.length > 0 ? 4 : 0 }}>
              {/* ── Issue bar row ─────────────────────────────── */}
              <div
                className="itl-row"
                style={{ cursor: 'pointer', minHeight: 44 }}
                onClick={() => onOpen(issue)}
              >
                {/* Label column */}
                <div className="itl-row-label" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%' }}>
                    <span className="itl-row-title" style={{ fontWeight: isActive ? 600 : 500 }}>{issue.title}</span>
                    {isHigh && (
                      <span className="chip chip-on_hold" style={{ fontSize: 9, padding: '1px 5px', flexShrink: 0 }}>중요</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span className={`chip ${statusChip}`} style={{ fontSize: 9, padding: '1px 6px' }}>{issue.status}</span>
                    {issue.progresses.length > 0 && (
                      <span style={{ fontSize: 10, color: 'var(--blue)', fontWeight: 500 }}>
                        진행 {issue.progresses.length}
                      </span>
                    )}
                    {isOverdue && (
                      <span style={{ fontSize: 10, color: 'var(--red)', fontWeight: 500 }}>기한 초과</span>
                    )}
                  </div>
                </div>

                {/* Track */}
                <div className="itl-row-track" style={{ height: 32 }}>
                  {/* Today line extended into track */}
                  {todayPct >= 0 && todayPct <= 100 && (
                    <div style={{
                      position: 'absolute', top: 0, bottom: 0,
                      left: `${todayPct}%`, width: 1.5,
                      background: 'var(--blue)', opacity: 0.25, pointerEvents: 'none',
                    }} />
                  )}
                  {/* Issue bar */}
                  <div
                    className={`itl-bar ${barClass}`}
                    style={{ left: `${startPct}%`, width: `${widthPct}%`, top: 6, height: 20 }}
                    title={`${issue.start_date} ~ ${issue.end_date ?? '미정'} · ${issue.status}`}
                  >
                    <span className="itl-bar-label">{issue.title}</span>
                  </div>
                  {/* Progress dots on the track */}
                  {progSorted.map((p, pi) => {
                    const dp = pct(p.start_date)
                    if (dp < 0 || dp > 100) return null
                    return (
                      <div
                        key={p.id}
                        title={`${p.start_date} · ${p.title}`}
                        style={{
                          position: 'absolute',
                          left: `${dp}%`,
                          top: '50%',
                          transform: 'translate(-50%, -50%)',
                          width: 8, height: 8,
                          borderRadius: '50%',
                          background: pi === 0 ? 'var(--blue)' : 'var(--blue-mid)',
                          border: '1.5px solid white',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                          zIndex: 3,
                          pointerEvents: 'none',
                          opacity: progressDotStyle(pi, progSorted.length).opacity,
                        }}
                      />
                    )
                  })}
                </div>

                {canEdit && (
                  <button
                    className="btn btn-ghost btn-sm itl-edit-btn"
                    style={{ padding: '2px 8px', flexShrink: 0 }}
                    onClick={(e) => { e.stopPropagation(); onEdit(issue) }}
                  >편집</button>
                )}
              </div>

              {/* ── Progress sub-rows (below issue bar) ──────── */}
              {progSorted.length > 0 && (
                <div style={{
                  marginLeft: 200,
                  marginRight: canEdit ? 60 : 8,
                  marginBottom: 8,
                  position: 'relative',
                }}>
                  {/* Left border accent */}
                  <div style={{
                    position: 'absolute', left: -12, top: 4, bottom: 4,
                    width: 2, borderRadius: 2,
                    background: 'linear-gradient(180deg, var(--blue-light), transparent)',
                  }} />
                  {progSorted.map((p, pi) => {
                    const dp   = pct(p.start_date)
                    const dep  = pct(p.end_date ?? p.start_date)
                    const dw   = Math.max(dep - dp, 0.8)
                    const isLatest = pi === 0
                    return (
                      <div
                        key={p.id}
                        style={{
                          position: 'relative',
                          height: 28,
                          marginBottom: 3,
                          borderRadius: 6,
                          background: isLatest ? 'rgba(26,115,232,0.05)' : 'transparent',
                        }}
                      >
                        {/* Date label on left of track */}
                        <div style={{
                          position: 'absolute',
                          right: '100%',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          paddingRight: 8,
                          fontSize: 10,
                          color: 'var(--ink-4)',
                          whiteSpace: 'nowrap',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        }}>
                          {isLatest && (
                            <span style={{
                              width: 5, height: 5, borderRadius: '50%',
                              background: 'var(--blue)', flexShrink: 0,
                            }} />
                          )}
                          {p.start_date}
                        </div>

                        {/* Track background */}
                        <div style={{
                          position: 'absolute', inset: 0,
                          background: 'var(--surface-2)',
                          borderRadius: 6, border: '1px solid var(--border-2)',
                          overflow: 'hidden',
                        }}>
                          {/* Progress fill bar */}
                          <div style={{
                            position: 'absolute',
                            left: `${dp}%`, width: `${dw}%`,
                            top: 5, height: 14,
                            background: isLatest
                              ? 'linear-gradient(90deg, var(--blue-light), var(--blue-mid))'
                              : 'var(--border-2)',
                            borderRadius: 4,
                            display: 'flex', alignItems: 'center',
                            overflow: 'hidden',
                          }}>
                            <span style={{
                              fontSize: 9, fontWeight: 600, paddingLeft: 5,
                              color: isLatest ? 'var(--blue-dark)' : 'var(--ink-3)',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>{p.title}</span>
                          </div>
                        </div>

                        {/* Details tooltip area — title + author on hover */}
                        <div style={{
                          position: 'absolute', right: 8, top: '50%',
                          transform: 'translateY(-50%)',
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                          {p.author_name && (
                            <span style={{ fontSize: 9, color: 'var(--ink-5)', whiteSpace: 'nowrap' }}>
                              {p.author_name}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Legend ───────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        marginTop: 20, paddingTop: 14,
        borderTop: '1px solid var(--border-2)',
        fontSize: 11, color: 'var(--ink-4)', flexWrap: 'wrap',
      }}>
        <span style={{ fontWeight: 600, color: 'var(--ink-3)', marginRight: 4 }}>범례</span>
        {[
          { cls: 'itl-bar-active',    label: '진행중' },
          { cls: 'itl-bar-draft',     label: '초안' },
          { cls: 'itl-bar-done',      label: '완료' },
          { cls: 'itl-bar-cancelled', label: '취소' },
        ].map(({ cls, label }) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span className={`itl-bar ${cls}`} style={{ position: 'static', width: 22, height: 10, borderRadius: 3, flexShrink: 0, display: 'inline-flex' }} />
            {label}
          </span>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)', border: '1.5px solid white', boxShadow: '0 1px 3px rgba(0,0,0,.15)', display: 'inline-block' }} />
          최신 진행내역
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue-mid)', border: '1.5px solid white', display: 'inline-block' }} />
          이전 진행내역
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--blue)' }}>
          <span style={{ width: 1.5, height: 14, background: 'var(--blue)', opacity: 0.5, display: 'inline-block' }} />
          오늘
        </span>
      </div>
    </div>
  )
}
