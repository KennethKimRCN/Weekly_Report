import { useMemo, useRef, useState, useCallback, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { reportsApi, projectsApi } from '../../api'
import { useToast } from './Toast'
import { Modal } from './Modal'
import { CarryForwardModal } from './CarryForwardModal'
import { fmtTime, shortDate } from '../../hooks/useDates'
import type { ReportFull, ReportProject, Project, ProjectStatus } from '../../types'

interface Props {
  report: ReportFull
  readOnly?: boolean
  isAdmin?: boolean
  onRefresh: () => void
}

const PROJECT_STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: 'active', label: '진행중' },
  { value: 'on_hold', label: '보류' },
  { value: 'completed', label: '완료' },
  { value: 'cancelled', label: '취소' },
]

const REPORT_STATUS_CHIP: Record<number, string> = {
  1: 'chip-draft',
  2: 'chip-submitted',
  3: 'chip-approved',
  4: 'chip-rejected',
}

const REPORT_STATUS_LABEL: Record<number, string> = {
  1: '초안',
  2: '제출',
  3: '확인',
  4: '반려',
}

const ISSUE_STATUS_CHIP: Record<string, string> = {
  '초안': 'chip-draft',
  '진행중': 'chip-submitted',
  '완료': 'chip-approved',
  '취소': 'chip-cancelled',
}

const PRIORITY_LABEL: Record<string, string> = {
  normal: '일반',
  high: '중요',
}

const PRIORITY_CHIP: Record<string, string> = {
  normal: 'chip-draft',
  high: 'chip-on_hold',
}

const MILESTONE_STATUS_LABEL: Record<string, string> = {
  planned: '예정',
  done: '완료',
  delayed: '지연',
  cancelled: '취소',
}

const MILESTONE_STATUS_CHIP: Record<string, string> = {
  planned: 'chip-submitted',
  done: 'chip-approved',
  delayed: 'chip-risk',
  cancelled: 'chip-cancelled',
}

export function ReportEditor({ report, readOnly = false, isAdmin = false, onRefresh }: Props) {
  const { toast } = useToast()
  const locked = report.is_locked === 1 && !isAdmin
  const canEdit = !locked && !readOnly
  const [submitConfirm, setSubmitConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const dirtyRef = useRef<Set<number>>(new Set())
  const setDirty = useCallback((pid: number) => { dirtyRef.current.add(pid) }, [])
  const clearDirty = useCallback((pid: number) => { dirtyRef.current.delete(pid) }, [])

  const totalIssues = report.projects.reduce((sum, project) => sum + project.issue_items.length, 0)
  const totalSchedules = report.projects.reduce((sum, project) => sum + project.project_schedules.length, 0)
  const totalProgress = report.projects.reduce(
    (sum, project) => sum + project.issue_items.reduce((issueSum, issue) => issueSum + issue.issue_progresses.length, 0),
    0,
  )

  const groupedProjects = useMemo(() => {
    const groups = new Map<string, ReportProject[]>()
    for (const project of report.projects) {
      const key = project.solution_product?.trim() || '기타'
      const current = groups.get(key) ?? []
      current.push(project)
      groups.set(key, current)
    }
    return Array.from(groups.entries())
      .map(([solution, projects]) => ({
        solution,
        projects: [...projects].sort((a, b) => a.project_name.localeCompare(b.project_name)),
      }))
      .sort((a, b) => a.solution.localeCompare(b.solution))
  }, [report.projects])
  const [collapsedSolutions, setCollapsedSolutions] = useState<Record<string, boolean>>({})

  function toggleSolution(solution: string) {
    setCollapsedSolutions((current) => ({ ...current, [solution]: !current[solution] }))
  }

  async function handleSubmit() {
    if (dirtyRef.current.size > 0) {
      toast('저장되지 않은 변경사항이 있습니다. 먼저 저장해 주세요.', 'error')
      return
    }
    setSubmitting(true)
    try {
      await reportsApi.submit(report.id)
      toast('보고서를 제출했습니다.', 'success')
      onRefresh()
    } catch (e: any) {
      toast(e.response?.data?.detail ?? '오류가 발생했습니다.', 'error')
    } finally {
      setSubmitting(false)
      setSubmitConfirm(false)
    }
  }

  return (
    <div className="report-editor">
      <div className="report-hero">
        <div className="report-hero-top">
          <div>
            <h2 className="report-owner">
              {report.owner_name}님 보고서
              <span className={`chip ${REPORT_STATUS_CHIP[report.status_id]}`}>
                {REPORT_STATUS_LABEL[report.status_id]}
              </span>
            </h2>
            <div className="report-week">주간: {report.week_start}</div>
          </div>
        </div>

        <div className="report-stats">
          {[
            { num: report.projects.length, lbl: '프로젝트' },
            { num: totalSchedules, lbl: '마일스톤' },
            { num: totalIssues, lbl: '이슈' },
            { num: totalProgress, lbl: '진행내역' },
          ].map(({ num, lbl }) => (
            <div key={lbl} className="report-stat">
              <span className="report-stat-num">{num}</span>
              <span className="report-stat-lbl">{lbl}</span>
            </div>
          ))}
        </div>

        <div className="report-actions">
          {canEdit && (report.status_id === 1 || report.status_id === 4) && (
            submitConfirm ? (
              <div className="submit-confirm">
                <span className="submit-confirm-text">
                  {report.status_id === 4 ? '수정된 보고서를 다시 제출할까요?' : '제출하면 수정 권한이 잠깁니다. 계속할까요?'}
                </span>
                <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? '제출 중...' : '확인'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setSubmitConfirm(false)}>취소</button>
              </div>
            ) : (
              <button className="btn btn-primary" onClick={() => setSubmitConfirm(true)}>
                {report.status_id === 4 ? '다시 제출' : '보고서 제출'}
              </button>
            )
          )}
          {report.manager_comment && (
            <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>관리자 코멘트: {report.manager_comment}</span>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">업무 현황</div>
          </div>
          {canEdit && (
            <div style={{ display: 'flex', gap: 8 }}>
              <CarryButton reportId={report.id} onDone={onRefresh} />
              <AddProjectButton reportId={report.id} onAdded={onRefresh} isAdmin={isAdmin} />
            </div>
          )}
        </div>

        {groupedProjects.length === 0 ? (
          <div className="panel-empty">프로젝트를 추가하면 해당 주차의 마일스톤과 이슈 진행내역을 자동으로 가져옵니다.</div>
        ) : (
          <div className="panel-body" style={{ display: 'grid', gap: 20 }}>
            {groupedProjects.map((group) => (
              <section key={group.solution} className="report-solution-group" style={{ display: 'grid', gap: 12 }}>
                <button
                  type="button"
                  className="report-collapse-header"
                  onClick={() => toggleSolution(group.solution)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', textAlign: 'left' }}
                >
                  <span className="report-collapse-icon">{collapsedSolutions[group.solution] ? '▸' : '▾'}</span>
                  <span className="chip chip-active">{group.solution}</span>
                  <span className="text-sm text-muted">{group.projects.length}개 프로젝트</span>
                </button>
                {!collapsedSolutions[group.solution] && (
                  <div style={{ display: 'grid', gap: 16 }}>
                    {group.projects.map((project) => (
                      <ProjectCard
                        key={project.project_id}
                        rp={project}
                        reportId={report.id}
                        readOnly={!canEdit}
                        onRefresh={onRefresh}
                        onDirtyChange={(dirty) => (dirty ? setDirty(project.project_id) : clearDirty(project.project_id))}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-eyebrow">개인 일정</div>
            <div className="panel-title">이번 주 일정</div>
          </div>
        </div>

        {report.week_schedule.length === 0 ? (
          <div className="panel-empty">이번 주 개인 일정이 없습니다.</div>
        ) : (
          <div className="panel-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
            <div className="week-list">
              {report.week_schedule.map((item) => (
                <div key={item.id} className="week-row">
                  <span className="week-badge">{item.type_name}</span>
                  <span className="week-date">
                    {shortDate(item.start_date)}
                    {item.start_date !== item.end_date && ` ~ ${shortDate(item.end_date)}`}
                  </span>
                  {item.location && <span className="week-loc">@ {item.location}</span>}
                  {item.details && <span className="week-detail">{item.details}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <CommentsSection reportId={report.id} comments={report.comments} onAdded={onRefresh} />
    </div>
  )
}

function CarryButton({ reportId, onDone }: { reportId: number; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        지난 주 가져오기
      </button>
      {open && <CarryForwardModal reportId={reportId} onDone={onDone} onClose={() => setOpen(false)} />}
    </>
  )
}

function AddProjectButton({ reportId, onAdded, isAdmin }: { reportId: number; onAdded: () => void; isAdmin: boolean | undefined }) {
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [filter, setFilter] = useState('')
  const { toast } = useToast()

  async function openPicker() {
    try {
      const res = await projectsApi.list({ mine: !isAdmin, status: 'active' })
      setProjects(res.data)
      setOpen(true)
    } catch (e: any) {
      toast(e.response?.data?.detail ?? '프로젝트를 불러오지 못했습니다.', 'error')
    }
  }

  async function add(projectId: number) {
    try {
      await reportsApi.upsertProject(reportId, { project_id: projectId, project_status: 'active' })
      toast('프로젝트를 추가했습니다.', 'success')
      setOpen(false)
      onAdded()
    } catch (e: any) {
      toast(e.response?.data?.detail ?? '오류가 발생했습니다.', 'error')
    }
  }

  const filtered = projects.filter((project) => {
    const keyword = filter.toLowerCase()
    return (
      project.project_name.toLowerCase().includes(keyword)
      || (project.solution_product ?? '').toLowerCase().includes(keyword)
    )
  })

  return (
    <>
      <button className="btn btn-secondary btn-sm" onClick={openPicker}>+ 프로젝트 추가</button>
      {open && (
        <Modal title="프로젝트 추가" onClose={() => setOpen(false)} footer={<button className="btn btn-ghost" onClick={() => setOpen(false)}>닫기</button>}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="프로젝트 또는 솔루션 검색"
            autoFocus
            style={{ marginBottom: 10 }}
          />
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '28px 0', fontSize: 13, color: 'var(--ink-4)' }}>추가 가능한 프로젝트가 없습니다.</div>
            ) : filtered.map((project) => (
              <div key={project.id} className="pick-item" onClick={() => add(project.id)}>
                <div className="fw-500" style={{ fontSize: 13 }}>{project.project_name}</div>
                <div className="text-sm text-muted">{project.solution_product || '기타'} · {project.company} · {project.location}</div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  )
}

function ProjectCard({
  rp,
  reportId,
  readOnly,
  onRefresh,
  onDirtyChange,
}: {
  rp: ReportProject
  reportId: number
  readOnly: boolean
  onRefresh: () => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [remarks, setRemarks] = useState(rp.remarks ?? '')
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>(rp.project_status)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [projectExpanded, setProjectExpanded] = useState(false)
  const [milestoneExpanded, setMilestoneExpanded] = useState(true)
  const [issueExpanded, setIssueExpanded] = useState(true)

  const progressCount = rp.issue_items.reduce((sum, issue) => sum + issue.issue_progresses.length, 0)

  function markDirty() {
    if (!isDirty) {
      setIsDirty(true)
      onDirtyChange(true)
    }
  }

  function markClean() {
    setIsDirty(false)
    onDirtyChange(false)
  }

  async function save() {
    setSaving(true)
    try {
      await reportsApi.upsertProject(reportId, {
        project_id: rp.project_id,
        project_status: projectStatus,
        remarks: remarks.trim() || undefined,
      })
      toast('프로젝트 메모를 저장했습니다.', 'success')
      markClean()
      onRefresh()
    } catch (e: any) {
      toast(e.response?.data?.detail ?? '저장하지 못했습니다.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    try {
      await reportsApi.removeProject(reportId, rp.project_id)
      toast('프로젝트를 보고서에서 제거했습니다.', 'success')
      markClean()
      onRefresh()
    } catch (e: any) {
      toast(e.response?.data?.detail ?? '제거하지 못했습니다.', 'error')
    }
  }

  async function refreshProject() {
    setRefreshing(true)
    try {
      await onRefresh()
      toast('최신 프로젝트 정보를 불러왔습니다.', 'success')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <article className="project-card report-project-card" style={{ display: 'grid', gap: 16, padding: 20, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--panel)', boxShadow: 'var(--shadow-sm)' }}>
      <div className="project-card-header" style={{ alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
          <button
            className="report-collapse-header"
            type="button"
            onClick={() => setProjectExpanded((value) => !value)}
            style={{ padding: 0, minWidth: 0, flex: 1, textAlign: 'left', display: 'flex', gap: 10, alignItems: 'flex-start' }}
            title={projectExpanded ? '프로젝트 접기' : '프로젝트 펼치기'}
          >
            <span className="report-collapse-icon">{projectExpanded ? '▾' : '▸'}</span>
            <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
              <div className="project-name" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>{rp.project_name}</span>
                <span className={`chip ${projectStatus === 'active' ? 'chip-active' : projectStatus === 'on_hold' ? 'chip-on_hold' : projectStatus === 'completed' ? 'chip-completed' : 'chip-cancelled'}`}>
                  {PROJECT_STATUS_OPTIONS.find((option) => option.value === projectStatus)?.label}
                </span>
                {isDirty && <span className="chip chip-submitted">변경 있음</span>}
              </div>
              <div className="project-meta">
                {(rp.solution_product || '기타')} · {rp.company} · {rp.location}
                {rp.wbs_number ? ` · WBS ${rp.wbs_number}` : ''}
              </div>
            </div>
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/projects/${rp.project_id}`)}>프로젝트 열기</button>
          <button className="btn btn-ghost btn-sm" disabled={refreshing} onClick={refreshProject}>
            {refreshing ? '새로고침 중...' : '새로고침'}
          </button>
          {!readOnly && (
            <>
              <select value={projectStatus} onChange={(e) => { setProjectStatus(e.target.value as ProjectStatus); markDirty() }} style={{ width: 120 }}>
                {PROJECT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {confirmRemove ? (
                <>
                  <button className="btn btn-danger btn-sm" onClick={remove}>제거</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirmRemove(false)}>취소</button>
                </>
              ) : (
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => setConfirmRemove(true)}>보고서에서 제외</button>
              )}
              <button className="btn btn-primary btn-sm" disabled={!isDirty || saving} onClick={save}>
                {saving ? '저장 중...' : '저장'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="project-mini-stats">
        <div className="mini-stat"><span className="mini-stat-num">{rp.project_schedules.length}</span>&nbsp;마일스톤</div>
        <div className="mini-stat"><span className="mini-stat-num">{rp.issue_items.length}</span>&nbsp;이슈</div>
        <div className="mini-stat"><span className="mini-stat-num">{progressCount}</span>&nbsp;주간 진행내역</div>
      </div>
      {projectExpanded && (
        <>
          <div className="subsection">
            <div className="subsection-header report-subsection-header">
              <span className="subsection-title">보고서 메모</span>
            </div>
            {readOnly ? (
              <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>{remarks || '메모가 없습니다.'}</div>
            ) : (
              <textarea
                rows={2}
                value={remarks}
                onChange={(e) => { setRemarks(e.target.value); markDirty() }}
                placeholder="이번 주 보고서에 남길 메모를 적어 주세요."
              />
            )}
          </div>

          <div className="subsection">
            <button
              type="button"
              className="subsection-header report-subsection-header report-collapse-header"
              onClick={() => setMilestoneExpanded((value) => !value)}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="report-collapse-icon">{milestoneExpanded ? '▾' : '▸'}</span>
                <span className="subsection-title">마일스톤</span>
              </span>
              <span className="text-sm text-muted">프로젝트 전체 마일스톤 자동 집계</span>
            </button>
            {milestoneExpanded && (
              rp.project_schedules.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink-5)' }}>집계된 마일스톤이 없습니다.</div>
              ) : (
                <div className="table-wrap report-milestone-table" style={{ border: 'none', borderRadius: 'var(--radius)' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>항목</th>
                        <th>예정일</th>
                        <th>실행일</th>
                        <th>상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rp.project_schedules.map((item) => (
                        <tr key={item.id}>
                          <td className="fw-500">{item.title}</td>
                          <td>{item.start_date}</td>
                          <td>{item.end_date ?? <span className="text-muted">-</span>}</td>
                          <td>
                            <span className={`chip ${MILESTONE_STATUS_CHIP[item.status ?? 'planned'] ?? 'chip-draft'}`}>
                              {MILESTONE_STATUS_LABEL[item.status ?? 'planned'] ?? (item.status ?? '예정')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>

          <div className="subsection">
            <button
              type="button"
              className="subsection-header report-subsection-header report-collapse-header"
              onClick={() => setIssueExpanded((value) => !value)}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="report-collapse-icon">{issueExpanded ? '▾' : '▸'}</span>
                <span className="subsection-title">이슈 트래커</span>
              </span>
              <span className="text-sm text-muted">이번 주에 작성한 진행내역만 표시</span>
            </button>
            {issueExpanded && (
              rp.issue_items.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink-5)' }}>이번 주에 반영된 이슈 진행내역이 없습니다.</div>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {rp.issue_items.map((issue) => (
                    <ReportIssueCard key={issue.id} issue={issue} />
                  ))}
                </div>
              )
            )}
          </div>
        </>
      )}
    </article>
  )
}

function CommentsSection({ reportId, comments, onAdded }: { reportId: number; comments: ReportFull['comments']; onAdded: () => void }) {
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)
  const { toast } = useToast()

  async function post() {
    if (!text.trim()) return
    setPosting(true)
    try {
      await reportsApi.addComment(reportId, text.trim())
      setText('')
      onAdded()
    } catch (e: any) {
      toast(e.response?.data?.detail ?? '오류가 발생했습니다.', 'error')
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <div className="panel-eyebrow">협업</div>
          <div className="panel-title">코멘트</div>
        </div>
      </div>
      <div className="panel-body">
        {comments.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--ink-4)', textAlign: 'center', padding: '16px 0' }}>아직 코멘트가 없습니다.</div>
        ) : (
          <div className="comment-list">
            {comments.map((comment) => (
              <div key={comment.id} className="comment-row">
                <div className="avatar avatar-sm">{comment.user_name?.slice(0, 1)}</div>
                <div className="comment-body">
                  <div className="comment-meta">
                    <span className="comment-author">{comment.user_name}</span>
                    <span className="comment-time">{fmtTime(comment.created_at)}</span>
                  </div>
                  <div className="comment-text">{comment.comment}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="comment-input">
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) post() }}
            placeholder="코멘트를 입력하세요."
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="comment-hint">Ctrl+Enter로 빠르게 등록</span>
            <button className="btn btn-primary btn-sm" disabled={!text.trim() || posting} onClick={post}>
              {posting ? '등록 중...' : '코멘트 등록'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatRange(start: string, end?: string | null) {
  return end && end !== start ? `${shortDate(start)} ~ ${shortDate(end)}` : shortDate(start)
}

function ReportIssueCard({ issue }: { issue: ReportProject['issue_items'][number] }) {
  const [expanded, setExpanded] = useState(true)
  const [detailOpen, setDetailOpen] = useState(false)
  const priorityKey = issue.priority ?? 'high'
  const statusChip = ISSUE_STATUS_CHIP[issue.status] ?? 'chip-draft'
  const fullHistory = issue.full_issue_progresses ?? issue.issue_progresses

  return (
    <>
      <div style={{ borderBottom: '1px solid var(--border-2)', padding: '14px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <button
          style={{ background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer', color: 'var(--ink-4)', flexShrink: 0, marginTop: 1 }}
          onClick={() => setExpanded((value) => !value)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s' }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="report-issue-hitarea"
          style={{
            flex: 1,
            minWidth: 0,
            display: 'block',
            width: '100%',
            textAlign: 'left',
            background: 'none',
            border: 'none',
            padding: '10px 12px',
            cursor: 'pointer',
            borderRadius: 'var(--radius-sm)',
          }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 500, fontSize: 14, color: 'var(--ink)' }}>{issue.title}</span>
            <span className={`chip ${PRIORITY_CHIP[priorityKey] ?? 'chip-on_hold'}`} style={{ fontSize: 10 }}>
              {PRIORITY_LABEL[priorityKey] ?? '중요'}
            </span>
            <span className={`chip ${statusChip}`} style={{ fontSize: 10 }}>{issue.status}</span>
            </div>
            {issue.details && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>{issue.details}</div>}
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>
              {issue.start_date}
              {issue.end_date ? ` ~ ${issue.end_date}` : ''}
              {issue.issue_progresses.length > 0 && ` · ${issue.issue_progresses.length}개 진행내역`}
            </div>
        </button>
      </div>

      <div className={`report-issue-progress-collapse ${expanded ? 'is-expanded' : ''}`}>
        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          className="report-issue-hitarea report-issue-progress-hitarea"
          style={{
            marginTop: 10,
            marginLeft: 24,
            borderLeft: '2px solid var(--border-2)',
            padding: '4px 0 4px 14px',
            width: 'calc(100% - 24px)',
            background: 'none',
            borderTop: 'none',
            borderRight: 'none',
            borderBottom: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
          }}
        >
          {issue.issue_progresses.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-5)', padding: '4px 0' }}>진행내역이 없습니다.</div>
          ) : issue.issue_progresses.map((progress) => (
            <div key={progress.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid var(--border-2)' }}>
              <div style={{ width: 108, fontSize: 11, color: 'var(--ink-4)', flexShrink: 0, paddingTop: 2 }}>
                {progress.start_date}{progress.end_date && progress.end_date !== progress.start_date ? ` ~ ${progress.end_date}` : ''}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{progress.title}</div>
                {progress.details && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{progress.details}</div>}
                {progress.author_name && <div style={{ fontSize: 11, color: 'var(--ink-5)', marginTop: 2 }}>{progress.author_name}</div>}
              </div>
            </div>
          ))}
        </button>
      </div>
      </div>

      {detailOpen && (
        <Modal
          title={issue.title}
          onClose={() => setDetailOpen(false)}
          size="lg"
          className="report-history-modal"
          footer={<button className="btn btn-ghost" onClick={() => setDetailOpen(false)}>닫기</button>}
        >
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className={`chip ${PRIORITY_CHIP[priorityKey] ?? 'chip-on_hold'}`}>{PRIORITY_LABEL[priorityKey] ?? '중요'}</span>
              <span className={`chip ${statusChip}`}>{issue.status}</span>
              <span className="text-sm text-muted">{issue.start_date}{issue.end_date ? ` ~ ${issue.end_date}` : ''}</span>
            </div>

            <div>
              <div className="subsection-title" style={{ marginBottom: 6 }}>이슈 상세</div>
              <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>
                {issue.details || '등록된 상세 내용이 없습니다.'}
              </div>
            </div>

            <div>
              <div className="subsection-title" style={{ marginBottom: 8 }}>전체 히스토리</div>
              {fullHistory.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink-5)' }}>등록된 진행 히스토리가 없습니다.</div>
              ) : (
                <div className="report-history-timeline">
                  {fullHistory.map((progress) => (
                    <div key={progress.id} className="report-history-item">
                      <div className="report-history-rail">
                        <span className="report-history-dot" />
                      </div>
                      <div className="report-history-content">
                        <div className="report-history-date">
                          {progress.start_date}
                          {progress.end_date && progress.end_date !== progress.start_date ? ` ~ ${progress.end_date}` : ''}
                        </div>
                        <div className="report-history-card">
                          <strong className="report-history-title">{progress.title}</strong>
                          {progress.details && <div className="report-history-detail">{progress.details}</div>}
                          {progress.author_name && <div className="report-history-author">{progress.author_name}</div>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
