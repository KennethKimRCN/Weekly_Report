import { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { projectRecordApi, type Milestone, type ProjectIssue } from '../api'
import type { ProjectRecord as PR } from '../api'
import { useAuthStore } from '../store'
import { useToast } from '../components/ui/Toast'
import { Modal } from '../components/ui/Modal'
import { PageSpinner } from '../components/ui'

const MILESTONE_STATUS = ['planned', 'done', 'delayed', 'cancelled'] as const

function Highlight({ text, query }: { text: string | null | undefined; query: string }) {
  const t = text ?? ''
  if (!query || !t) return <>{t}</>
  const idx = t.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{t}</>
  return (
    <>
      {t.slice(0, idx)}
      <mark className="search-highlight">{t.slice(idx, idx + query.length)}</mark>
      {t.slice(idx + query.length)}
    </>
  )
}
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
  const [issueSearchMode, setIssueSearchMode] = useState<'issue' | 'progress'>('issue')
  const [issueRangeFrom, setIssueRangeFrom] = useState('')
  const [issueRangeTo, setIssueRangeTo] = useState('')
  const issueSearchRef = useRef<HTMLInputElement>(null)

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

  const q = issueSearch.trim().toLowerCase()

  const filteredIssues = useMemo(() => {
    if (!record) return []
    return record.issues.filter((issue) => {
      // Time range filter: applies to issue dates (always) and also progress dates
      const issueStart = issue.start_date
      const issueEnd = issue.end_date ?? issue.start_date
      const issueInRange =
        (!issueRangeFrom || issueEnd >= issueRangeFrom) &&
        (!issueRangeTo || issueStart <= issueRangeTo)

      if (issueSearchMode === 'issue') {
        if (!issueInRange) return false
        if (!q) return true
        return (
          issue.title.toLowerCase().includes(q) ||
          (issue.details ?? '').toLowerCase().includes(q)
        )
      } else {
        // progress mode: issue is included if any of its progresses match text + date range
        const matchingProgresses = issue.progresses.filter((p) => {
          const pStart = p.start_date
          const pEnd = p.end_date ?? p.start_date
          const progInRange =
            (!issueRangeFrom || pEnd >= issueRangeFrom) &&
            (!issueRangeTo || pStart <= issueRangeTo)
          if (!progInRange) return false
          if (!q) return true
          return (
            p.title.toLowerCase().includes(q) ||
            (p.details ?? '').toLowerCase().includes(q) ||
            (p.author_name ?? '').toLowerCase().includes(q)
          )
        })
        return matchingProgresses.length > 0
      }
    })
  }, [record, q, issueSearchMode, issueRangeFrom, issueRangeTo])

  const isIssueSearchActive = !!(q || issueRangeFrom || issueRangeTo)

  const issueColumns = ISSUE_STATUS_OPTIONS.map((status) => ({
    status,
    issues: filteredIssues.filter((issue) => issue.status === status),
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

          {/* ── Issue Search Bar ── */}
          <div className="issue-search-bar">
            <div className="issue-search-row">
              {/* Search mode toggle */}
              <div className="issue-search-mode-toggle">
                <button
                  className={`ism-btn ${issueSearchMode === 'issue' ? 'active' : ''}`}
                  onClick={() => setIssueSearchMode('issue')}
                >
                  이슈
                </button>
                <button
                  className={`ism-btn ${issueSearchMode === 'progress' ? 'active' : ''}`}
                  onClick={() => setIssueSearchMode('progress')}
                >
                  진행내역
                </button>
              </div>

              {/* Text search */}
              <div className="issue-search-input-wrap">
                <svg className="issue-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  ref={issueSearchRef}
                  value={issueSearch}
                  onChange={(e) => setIssueSearch(e.target.value)}
                  placeholder={issueSearchMode === 'issue' ? '이슈 제목, 내용 검색...' : '진행내역 제목, 내용, 작성자 검색...'}
                  className="issue-search-input"
                />
                {issueSearch && (
                  <button className="issue-search-clear" onClick={() => { setIssueSearch(''); issueSearchRef.current?.focus() }}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Date range */}
              <div className="issue-search-range">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: 'var(--ink-4)', flexShrink: 0 }}>
                  <rect x="2" y="2" width="12" height="12" rx="2" /><line x1="5" y1="1" x2="5" y2="4" /><line x1="11" y1="1" x2="11" y2="4" /><line x1="2" y1="6" x2="14" y2="6" />
                </svg>
                <input
                  type="date"
                  value={issueRangeFrom}
                  onChange={(e) => setIssueRangeFrom(e.target.value)}
                  className="issue-date-input"
                  title="시작 날짜"
                />
                <span className="issue-range-sep">~</span>
                <input
                  type="date"
                  value={issueRangeTo}
                  onChange={(e) => setIssueRangeTo(e.target.value)}
                  className="issue-date-input"
                  title="종료 날짜"
                />
              </div>

              {/* Clear all */}
              {isIssueSearchActive && (
                <button
                  className="issue-search-reset"
                  onClick={() => { setIssueSearch(''); setIssueRangeFrom(''); setIssueRangeTo('') }}
                >
                  초기화
                </button>
              )}
            </div>

            {/* Result summary */}
            {isIssueSearchActive && (
              <div className="issue-search-summary">
                <span className="iss-mode-badge">{issueSearchMode === 'issue' ? '이슈' : '진행내역'} 검색</span>
                <span>
                  {filteredIssues.length === record.issues.length
                    ? `전체 ${record.issues.length}개`
                    : <><strong>{filteredIssues.length}</strong>개 / 전체 {record.issues.length}개</>}
                </span>
                {issueRangeFrom || issueRangeTo ? (
                  <span className="iss-range-chip">
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <rect x="2" y="2" width="12" height="12" rx="2" /><line x1="5" y1="1" x2="5" y2="4" /><line x1="11" y1="1" x2="11" y2="4" /><line x1="2" y1="6" x2="14" y2="6" />
                    </svg>
                    {issueRangeFrom || '…'} ~ {issueRangeTo || '…'}
                    <button onClick={() => { setIssueRangeFrom(''); setIssueRangeTo('') }}>
                      <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                        <line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" />
                      </svg>
                    </button>
                  </span>
                ) : null}
              </div>
            )}
          </div>

          <div className="panel-body">
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
                        <div className="kanban-empty">{isIssueSearchActive ? '검색 결과 없음' : '이 상태의 이슈가 없습니다.'}</div>
                      ) : column.issues.map((issue) => (
                        <IssueCard
                          key={issue.id}
                          issue={issue}
                          canEdit={canEdit}
                          closed={column.status === '완료' || column.status === '취소'}
                          searchQuery={q}
                          searchMode={issueSearchMode}
                          rangeFrom={issueRangeFrom}
                          rangeTo={issueRangeTo}
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
                issues={filteredIssues}
                today={today}
                canEdit={canEdit}
                searchQuery={q}
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

function IssueCard({
  issue,
  canEdit,
  closed = false,
  searchQuery = '',
  searchMode = 'issue',
  rangeFrom = '',
  rangeTo = '',
  onOpen,
  onEdit,
  onDelete,
}: {
  issue: ProjectIssue
  canEdit: boolean
  closed?: boolean
  searchQuery?: string
  searchMode?: 'issue' | 'progress'
  rangeFrom?: string
  rangeTo?: string
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const priority = PRIORITY_OPTIONS.find((option) => option.value === issue.priority) ?? PRIORITY_OPTIONS[0]
  const statusChip = issue.status === '완료' ? 'chip-approved' : issue.status === '취소' ? 'chip-cancelled' : issue.status === '진행중' ? 'chip-submitted' : 'chip-draft'

  // When in progress search mode, show matching progress snippets inline on the card
  const matchingProgresses = searchMode === 'progress' && (searchQuery || rangeFrom || rangeTo)
    ? issue.progresses.filter((p) => {
        const pStart = p.start_date
        const pEnd = p.end_date ?? p.start_date
        const inRange = (!rangeFrom || pEnd >= rangeFrom) && (!rangeTo || pStart <= rangeTo)
        if (!inRange) return false
        if (!searchQuery) return true
        return (
          p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (p.details ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          (p.author_name ?? '').toLowerCase().includes(searchQuery.toLowerCase())
        )
      })
    : []

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
            <span style={{ fontWeight: 500, fontSize: 14, color: 'var(--ink)' }}>
              {searchMode === 'issue' && searchQuery
                ? <Highlight text={issue.title} query={searchQuery} />
                : issue.title}
            </span>
            <span className={`chip ${priority.chip}`} style={{ fontSize: 10 }}>{priority.label}</span>
            <span className={`chip ${statusChip}`} style={{ fontSize: 10 }}>{issue.status}</span>
          </div>
          {issue.details && (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>
              {searchMode === 'issue' && searchQuery
                ? <Highlight text={issue.details} query={searchQuery} />
                : issue.details}
            </div>
          )}
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

      {/* Matching progress snippets shown inline when in progress search mode */}
      {matchingProgresses.length > 0 && (
        <div className="issue-card-prog-snippets">
          {matchingProgresses.slice(0, 3).map((p) => (
            <div key={p.id} className="issue-card-prog-snippet">
              <span className="icps-date">{p.start_date}{p.end_date && p.end_date !== p.start_date ? ` ~ ${p.end_date}` : ''}</span>
              <span className="icps-title"><Highlight text={p.title} query={searchQuery} /></span>
              {p.details && <span className="icps-details"><Highlight text={p.details} query={searchQuery} /></span>}
            </div>
          ))}
          {matchingProgresses.length > 3 && (
            <div className="icps-more">+{matchingProgresses.length - 3}개 더 보기</div>
          )}
        </div>
      )}

      {/* Progress count hint (when not in search mode) */}
      {matchingProgresses.length === 0 && issue.progresses.length > 0 && (
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

  return (
    <div className="issue-detail-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="issue-detail-panel">
        {/* Header */}
        <div className="issue-detail-header">
          <div className="issue-detail-header-top">
            <div className="issue-detail-badges">
              <span className={`chip ${statusChip}`}>{issue.status}</span>
              <span className={`chip ${priority.chip}`}>{priority.label}</span>
            </div>
            <button className="issue-detail-close" onClick={onClose} aria-label="닫기">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <h2 className="issue-detail-title">{issue.title}</h2>
          <div className="issue-detail-meta">
            <span className="issue-detail-meta-item">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="2" y="3" width="12" height="11" rx="2" /><line x1="5" y1="1" x2="5" y2="5" /><line x1="11" y1="1" x2="11" y2="5" /><line x1="2" y1="7" x2="14" y2="7" />
              </svg>
              {issue.start_date}{issue.end_date ? ` ~ ${issue.end_date}` : ''}
            </span>
            {issue.progresses.length > 0 && (
              <span className="issue-detail-meta-item">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="8" cy="8" r="6" /><line x1="8" y1="5" x2="8" y2="8" /><line x1="8" y1="8" x2="10" y2="10" />
                </svg>
                진행내역 {issue.progresses.length}개
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

        {/* Progress section */}
        <div className="issue-detail-body">
          <div className="issue-detail-section-header">
            <span className="issue-detail-section-title">진행내역</span>
            <span className="chip chip-draft" style={{ fontSize: 11 }}>{issue.progresses.length}</span>
            {canEdit && (
              <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={onAddProgress}>+ 추가</button>
            )}
          </div>

          {issue.progresses.length === 0 ? (
            <div className="issue-detail-empty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ color: 'var(--ink-5)', marginBottom: 8 }}>
                <circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="12" /><circle cx="12" cy="16" r="0.5" fill="currentColor" />
              </svg>
              <span>아직 진행내역이 없습니다.</span>
              {canEdit && (
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={onAddProgress}>첫 진행내역 추가하기</button>
              )}
            </div>
          ) : (
            <div className="issue-detail-progress-list">
              {[...issue.progresses]
                .sort((a, b) => b.start_date.localeCompare(a.start_date))
                .map((progress, idx) => (
                <div key={progress.id} className="issue-detail-progress-item">
                  <div className="idp-spine-dot" />
                  <div className="idp-content">
                    <div className="idp-top">
                      <div className="idp-date">
                        {progress.start_date}
                        {progress.end_date && progress.end_date !== progress.start_date ? ` ~ ${progress.end_date}` : ''}
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
                    {progress.author_name && <div className="idp-author">{progress.author_name}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
function IssueTimeline({
  issues,
  today,
  canEdit,
  searchQuery = '',
  onOpen,
  onEdit,
}: {
  issues: ProjectIssue[]
  today: string
  canEdit: boolean
  searchQuery?: string
  onOpen: (issue: ProjectIssue) => void
  onEdit: (issue: ProjectIssue) => void
}) {
  const sorted = [...issues].sort((a, b) => a.start_date.localeCompare(b.start_date))

  if (sorted.length === 0) {
    return <div className="kanban-empty" style={{ minHeight: 120 }}>등록된 이슈가 없습니다.</div>
  }

  // Determine date range
  const allDates = sorted.flatMap(i => [i.start_date, i.end_date ?? i.start_date])
  const minDate = new Date(allDates.reduce((a, b) => a < b ? a : b))
  const maxDate = new Date(allDates.reduce((a, b) => a > b ? a : b))

  // Expand range by a bit for padding
  minDate.setDate(minDate.getDate() - 3)
  maxDate.setDate(maxDate.getDate() + 3)

  const totalDays = Math.max(1, (maxDate.getTime() - minDate.getTime()) / 86400000)

  function pct(dateStr: string) {
    const d = new Date(dateStr)
    return Math.max(0, Math.min(100, ((d.getTime() - minDate.getTime()) / 86400000 / totalDays) * 100))
  }

  // Month labels
  const months: { label: string; pct: number }[] = []
  const cur = new Date(minDate)
  cur.setDate(1)
  while (cur <= maxDate) {
    const p = pct(cur.toISOString().slice(0, 10))
    months.push({ label: `${cur.getFullYear()}.${String(cur.getMonth() + 1).padStart(2, '0')}`, pct: p })
    cur.setMonth(cur.getMonth() + 1)
  }

  const todayPct = pct(today)

  return (
    <div className="issue-timeline">
      {/* Header ruler */}
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

      {/* Issue rows */}
      <div className="itl-rows">
        {sorted.map((issue) => {
          const startPct = pct(issue.start_date)
          const endPct = pct(issue.end_date ?? issue.start_date)
          const widthPct = Math.max(endPct - startPct, 1.5)
          const isActive = issue.status === '진행중'
          const isDone = issue.status === '완료'
          const isCancelled = issue.status === '취소'
          const isDraft = issue.status === '초안'
          const isHigh = issue.priority === 'high'

          const barClass = isDone
            ? 'itl-bar-done'
            : isCancelled
            ? 'itl-bar-cancelled'
            : isActive
            ? 'itl-bar-active'
            : 'itl-bar-draft'

          return (
            <div key={issue.id} className="itl-row" onClick={() => onOpen(issue)} style={{ cursor: 'pointer' }}>
              <div className="itl-row-label">
                <span className="itl-row-title">
                  {searchQuery ? <Highlight text={issue.title} query={searchQuery} /> : issue.title}
                </span>
                {isHigh && <span className="chip chip-on_hold" style={{ fontSize: 9, padding: '1px 5px' }}>중요</span>}
              </div>
              <div className="itl-row-track">
                <div
                  className={`itl-bar ${barClass}`}
                  style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                  title={`${issue.start_date} ~ ${issue.end_date ?? '미정'}`}
                >
                  <span className="itl-bar-label">{issue.title}</span>
                </div>
              </div>
              {canEdit && (
                <button className="btn btn-ghost btn-sm itl-edit-btn" style={{ padding: '2px 8px' }} onClick={(e) => { e.stopPropagation(); onEdit(issue) }}>편집</button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
