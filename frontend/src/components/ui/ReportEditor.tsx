import { useMemo, useRef, useState, useCallback, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { reportsApi, projectsApi } from '../../api'
import { useToast } from './Toast'
import { Modal } from './Modal'
import { CarryForwardModal } from './CarryForwardModal'
import { fmtTime, shortDate } from '../../hooks/useDates'
import { useAuthStore } from '../../store'
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
  const { user } = useAuthStore()
  const locked = report.is_locked === 1 && !isAdmin
  const canEdit = !locked && !readOnly
  const [submitConfirm, setSubmitConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [exporting, setExporting] = useState(false)

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
  const reportMetrics = [
    { num: report.projects.length, lbl: '프로젝트' },
    { num: totalSchedules, lbl: '마일스톤' },
    { num: totalIssues, lbl: '이슈' },
    { num: totalProgress, lbl: '진행내역' },
  ]

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

  async function handleExportWord() {
    setExporting(true)
    try {
      const projectsRes = await projectsApi.list()
      const projectMap = new Map(projectsRes.data.map((project) => [project.id, project]))
      const blob = await buildWeeklyReportWordDocument({
        report,
        groupedProjects,
        projectMap,
        ownerName: report.owner_name,
        ownerRank: user?.rank_name ?? '',
      }) as Blob
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `weekly-report-week-${report.week_number}.docx`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      console.error('Word export error:', e)
      toast(e?.message ?? e.response?.data?.detail ?? 'Word 내보내기에 실패했습니다.', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="report-editor">
      <div className="report-hero">
        <div className="report-hero-top">
          <div className="report-hero-copy">
            <div className="report-hero-kicker">Weekly overview</div>
            <h2 className="report-owner">
              {report.owner_name}님 보고서
              <span className={`chip ${REPORT_STATUS_CHIP[report.status_id]}`}>
                {REPORT_STATUS_LABEL[report.status_id]}
              </span>
            </h2>
            <div className="report-week">주간: {report.week_start}</div>
            <p className="report-hero-description">
              이번 주 프로젝트 진행상황, 일정, 협업 메모를 한 화면에서 정리했습니다.
            </p>
          </div>

          <div className="report-stats">
            {reportMetrics.map(({ num, lbl }) => (
              <div key={lbl} className="report-stat">
                <span className="report-stat-num">{num}</span>
                <span className="report-stat-lbl">{lbl}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="report-actions">
          <button className="btn btn-secondary" onClick={handleExportWord} disabled={exporting}>
            {exporting ? 'Word 생성 중...' : 'Export to Word'}
          </button>
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
            <div className="report-manager-note">
              <span className="report-manager-note-label">관리자 코멘트</span>
              <span className="report-manager-note-body">{report.manager_comment}</span>
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-eyebrow">핵심 업무</div>
            <div className="panel-title">업무 현황</div>
          </div>
          {canEdit && (
            <div className="panel-actions">
              <CarryButton reportId={report.id} onDone={onRefresh} />
              <AddProjectButton reportId={report.id} onAdded={onRefresh} isAdmin={isAdmin} />
            </div>
          )}
        </div>

        {groupedProjects.length === 0 ? (
          <div className="panel-empty">프로젝트를 추가하면 해당 주차의 마일스톤과 이슈 진행내역을 자동으로 가져옵니다.</div>
        ) : (
          <div className="panel-body report-panel-body">
            {groupedProjects.map((group) => (
              <section key={group.solution} className="report-solution-group">
                <button
                  type="button"
                  className="report-collapse-header report-solution-header"
                  onClick={() => toggleSolution(group.solution)}
                >
                  <span className="report-collapse-icon">{collapsedSolutions[group.solution] ? '▸' : '▾'}</span>
                  <span className="report-solution-title">{group.solution}</span>
                  <span className="report-solution-count">{group.projects.length}개 프로젝트</span>
                </button>
                <div className={`report-collapse-panel ${collapsedSolutions[group.solution] ? '' : 'is-expanded'}`}>
                  <div className="report-collapse-panel-inner report-collapse-panel-spacing">
                    <div className="report-solution-list">
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
                  </div>
                </div>
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
          <div className="panel-body panel-body-compact">
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
            className="modal-search-input"
          />
          <div className="project-picker-list">
            {filtered.length === 0 ? (
              <div className="project-picker-empty">추가 가능한 프로젝트가 없습니다.</div>
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
    <article className="project-card report-project-card">
      <div className="project-card-header">
        <div className="project-card-main">
          <button
            className="report-collapse-header project-card-toggle"
            type="button"
            onClick={() => setProjectExpanded((value) => !value)}
            title={projectExpanded ? '프로젝트 접기' : '프로젝트 펼치기'}
          >
            <span className="report-collapse-icon">{projectExpanded ? '▾' : '▸'}</span>
            <div className="project-card-copy">
              <div className="project-name">
                <span>{rp.project_name}</span>
                <span className={`chip ${projectStatus === 'active' ? 'chip-active' : projectStatus === 'on_hold' ? 'chip-on_hold' : projectStatus === 'completed' ? 'chip-completed' : 'chip-cancelled'}`}>
                  {PROJECT_STATUS_OPTIONS.find((option) => option.value === projectStatus)?.label}
                </span>
                {isDirty && <span className="chip chip-submitted">변경 있음</span>}
              </div>
              <div className="project-meta">
                {(rp.solution_product || '기타')} · {rp.company} · {rp.location}
                {rp.wbs_number ? <> · <span className="project-wbs">WBS {rp.wbs_number}</span></> : ''}
              </div>
            </div>
          </button>
        </div>

        <div className="project-toolbar">
          <div className="project-toolbar-group">
            <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/projects/${rp.project_id}`)}>프로젝트 열기</button>
            <button className="btn btn-ghost btn-sm" disabled={refreshing} onClick={refreshProject}>
              {refreshing ? '새로고침 중...' : '새로고침'}
            </button>
          </div>
          {!readOnly && (
            <div className="project-toolbar-group project-toolbar-group--edit">
              <select className="status-select" value={projectStatus} onChange={(e) => { setProjectStatus(e.target.value as ProjectStatus); markDirty() }}>
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
            </div>
          )}
        </div>
      </div>

      <div className={`report-collapse-panel ${projectExpanded ? 'is-expanded' : ''}`}>
        <div className="report-collapse-panel-inner">
          <div className="project-detail-table">
            <section className="project-detail-row">
              <button
                type="button"
                className="project-detail-label project-detail-label-button"
                onClick={() => setMilestoneExpanded((value) => !value)}
              >
                <span className="project-detail-label-inner">
                  <span className="project-detail-label-title-row">
                    <span className="report-collapse-icon">{milestoneExpanded ? '▾' : '▸'}</span>
                    <span>마일스톤</span>
                  </span>
                </span>
              </button>
              <div className="project-detail-value">
                <div className={`report-collapse-panel report-collapse-panel--nested ${milestoneExpanded ? 'is-expanded' : ''}`}>
                  <div className="report-collapse-panel-inner">
                    {rp.project_schedules.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--ink-5)' }}>집계된 마일스톤이 없습니다.</div>
                    ) : (
                      <div className="table-wrap report-milestone-table report-surface-table">
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
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="project-detail-row">
              <button
                type="button"
                className="project-detail-label project-detail-label-button"
                onClick={() => setIssueExpanded((value) => !value)}
              >
                <span className="project-detail-label-inner">
                  <span className="project-detail-label-title-row">
                    <span className="report-collapse-icon">{issueExpanded ? '▾' : '▸'}</span>
                    <span>이슈 트래커</span>
                  </span>
                </span>
              </button>
              <div className="project-detail-value">
                <div className={`report-collapse-panel report-collapse-panel--nested ${issueExpanded ? 'is-expanded' : ''}`}>
                  <div className="report-collapse-panel-inner">
                    {rp.issue_items.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--ink-5)' }}>이번 주에 반영된 이슈 진행내역이 없습니다.</div>
                    ) : (
                      <div className="report-issue-list">
                        {rp.issue_items.map((issue) => (
                          <ReportIssueCard key={issue.id} issue={issue} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="project-detail-row">
              <div className="project-detail-label">
                <span className="project-detail-label-inner">
                  <span className="project-detail-label-title-row">
                    <span>Remarks</span>
                  </span>
                </span>
              </div>
              <div className="project-detail-value">
                {readOnly ? (
                  <div className="project-remarks-block">{remarks || '메모가 없습니다.'}</div>
                ) : (
                  <textarea
                    className="project-remarks-input"
                    rows={2}
                    value={remarks}
                    onChange={(e) => { setRemarks(e.target.value); markDirty() }}
                    placeholder="이번 주 보고서에 남길 메모를 적어 주세요."
                  />
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
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
          <div className="comments-empty">아직 코멘트가 없습니다.</div>
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
        <div className="comment-input comment-composer">
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) post() }}
            placeholder="코멘트를 입력하세요."
          />
          <div className="comment-composer-actions">
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

async function buildWeeklyReportWordDocument({
  report,
  groupedProjects,
  projectMap,
  ownerName,
  ownerRank,
}: {
  report: ReportFull
  groupedProjects: { solution: string; projects: ReportProject[] }[]
  projectMap: Map<number, Project>
  ownerName: string
  ownerRank: string
}): Promise<unknown> {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
    ShadingType, VerticalAlign, PageNumber, Header, Footer,
  } = await import('docx')

  // ── Colour palette ──────────────────────────────────────────────────
  const BLUE       = '0054A6'
  const BLUE_LIGHT = 'EBF2FA'
  const DARK       = '0F172A'
  const MID        = '334155'
  const MUTED      = '64748B'
  const BORDER_C   = 'CBD5E1'
  const WHITE      = 'FFFFFF'
  const HEADER_BG  = '1E3A5F'
  const ROW_ALT    = 'F8FAFC'

  // ── Border helpers ───────────────────────────────────────────────────
  const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: BORDER_C }
  const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder }
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }

  // ── Text helpers ─────────────────────────────────────────────────────
  const t = (text: string, opts: Record<string, unknown> = {}) =>
    new TextRun({ text, font: 'Malgun Gothic', ...opts })

  const emptyPara = (spacingAfter = 0) =>
    new Paragraph({ children: [], spacing: { after: spacingAfter } })

  // ── Section heading (A. / B.) ────────────────────────────────────────
  const sectionHeading = (text: string) =>
    new Paragraph({
      children: [t(text, { bold: true, size: 26, color: WHITE })],
      spacing: { before: 0, after: 0 },
      shading: { fill: HEADER_BG, type: ShadingType.CLEAR },
      indent: { left: 160 },
    })

  // ── Solution group title ─────────────────────────────────────────────
  const groupTitle = (text: string) =>
    new Paragraph({
      children: [t(text, { bold: true, size: 22, color: BLUE })],
      spacing: { before: 240, after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BLUE, space: 4 } },
    })

  // ── Sub-label (1. 특이사항 etc.) ────────────────────────────────────
  const subLabel = (text: string) =>
    new Paragraph({
      children: [t(text, { bold: true, size: 20, color: DARK })],
      spacing: { before: 160, after: 80 },
    })

  // ── Project header bar ───────────────────────────────────────────────
  const projectHeaderBar = (text: string) =>
    new Paragraph({
      children: [t(text, { bold: true, size: 18, color: DARK })],
      spacing: { before: 120, after: 60 },
      shading: { fill: BLUE_LIGHT, type: ShadingType.CLEAR },
      indent: { left: 120, right: 120 },
    })

  // ── Body paragraph ───────────────────────────────────────────────────
  const bodyPara = (text: string, opts: Record<string, unknown> = {}) =>
    new Paragraph({
      children: [t(text, { size: 18, color: MID, ...opts })],
      spacing: { before: 40, after: 40 },
    })

  // ── Bullet item ──────────────────────────────────────────────────────
  const bulletItem = (children: InstanceType<typeof TextRun>[]) =>
    new Paragraph({
      numbering: { reference: 'bullets', level: 0 },
      children,
      spacing: { before: 40, after: 40 },
    })

  // ── Schedule table ───────────────────────────────────────────────────
  const scheduleTable = (items: ReportProject['project_schedules']) => {
    const PAGE_W = 9360
    const colW = [3600, 1500, 1500, 1400] as const // sums to 8000 — leave some indent room

    const headerCell = (text: string, width: number) =>
      new TableCell({
        width: { size: width, type: WidthType.DXA },
        shading: { fill: HEADER_BG, type: ShadingType.CLEAR },
        borders: cellBorders,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({
          children: [t(text, { bold: true, size: 18, color: WHITE })],
          alignment: AlignmentType.CENTER,
        })],
        verticalAlign: VerticalAlign.CENTER,
      })

    const dataCell = (text: string, width: number, shade = false, align: string = AlignmentType.LEFT) =>
      new TableCell({
        width: { size: width, type: WidthType.DXA },
        shading: { fill: shade ? ROW_ALT : WHITE, type: ShadingType.CLEAR },
        borders: cellBorders,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        children: [new Paragraph({ children: [t(text, { size: 18, color: MID })], alignment: align as any })],
        verticalAlign: VerticalAlign.CENTER,
      })

    const headerRow = new TableRow({
      tableHeader: true,
      children: [
        headerCell('항목', colW[0]),
        headerCell('예정일', colW[1]),
        headerCell('실행일', colW[2]),
        headerCell('상태', colW[3]),
      ],
    })

    const dataRows = items.map((item, idx) => {
      const shade = idx % 2 === 1
      const statusLabel = MILESTONE_STATUS_LABEL[item.status ?? 'planned'] ?? (item.status ?? '예정')
      return new TableRow({
        children: [
          dataCell(item.title, colW[0], shade),
          dataCell(item.start_date, colW[1], shade, AlignmentType.CENTER),
          dataCell(item.end_date ?? 'N/A', colW[2], shade, AlignmentType.CENTER),
          dataCell(statusLabel, colW[3], shade, AlignmentType.CENTER),
        ],
      })
    })

    return new Table({
      width: { size: PAGE_W, type: WidthType.DXA },
      columnWidths: [...colW],
      rows: [headerRow, ...dataRows],
    })
  }

  // ── Schedule section table (인원 일정) ───────────────────────────────
  const schedulePersonTable = (entries: typeof report.week_schedule, ownerDisplay: string) => {
    const colW = [2000, 2000, 2500, 2860] as const

    const headerCell = (text: string, w: number) =>
      new TableCell({
        width: { size: w, type: WidthType.DXA },
        shading: { fill: HEADER_BG, type: ShadingType.CLEAR },
        borders: cellBorders,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: [t(text, { bold: true, size: 18, color: WHITE })], alignment: AlignmentType.CENTER })],
        verticalAlign: VerticalAlign.CENTER,
      })

    const dataCell = (text: string, w: number, shade: boolean, align: string = AlignmentType.LEFT) =>
      new TableCell({
        width: { size: w, type: WidthType.DXA },
        shading: { fill: shade ? ROW_ALT : WHITE, type: ShadingType.CLEAR },
        borders: cellBorders,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        children: [new Paragraph({ children: [t(text, { size: 18, color: MID })], alignment: align as any })],
        verticalAlign: VerticalAlign.CENTER,
      })

    const headerRow = new TableRow({
      tableHeader: true,
      children: [
        headerCell('이름', colW[0]),
        headerCell('구분', colW[1]),
        headerCell('기간', colW[2]),
        headerCell('내용', colW[3]),
      ],
    })

    const dataRows = entries.map((item, idx) => {
      const shade = idx % 2 === 1
      return new TableRow({
        children: [
          dataCell(ownerDisplay, colW[0], shade),
          dataCell(item.type_name ?? '', colW[1], shade, AlignmentType.CENTER),
          dataCell(formatExportDateRange(item.start_date, item.end_date), colW[2], shade, AlignmentType.CENTER),
          dataCell(item.details || 'N/A', colW[3], shade),
        ],
      })
    })

    return new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [...colW],
      rows: [headerRow, ...dataRows],
    })
  }

  // ── Build document body ──────────────────────────────────────────────
  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = []

  // Title
  children.push(
    new Paragraph({
      children: [t(`[주간보고 Week-${report.week_number}: 주요 Issue]`, { bold: true, size: 32, color: BLUE })],
      spacing: { before: 0, after: 80 },
      alignment: AlignmentType.LEFT,
    }),
    new Paragraph({
      children: [
        t(`담당자: `, { size: 18, color: MUTED }),
        t(`${ownerName} ${ownerRank}`, { bold: true, size: 18, color: MID }),
        t(`   |   주간: `, { size: 18, color: MUTED }),
        t(report.week_start ?? '', { size: 18, color: MID }),
      ],
      spacing: { before: 0, after: 240 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BLUE, space: 4 } },
    }),
  )

  // ── A. Project 특이사항 ──────────────────────────────────────────────
  children.push(sectionHeading('A. Project 특이사항'))

  for (const group of groupedProjects) {
    const groupAssignees = uniqueAssignees(
      group.projects.flatMap((p) => projectMap.get(p.project_id)?.assignees ?? []),
    )
    children.push(groupTitle(`[${group.solution}]  ${formatAssignees(groupAssignees)}`))
    children.push(subLabel('1. 특이사항'))

    const hasRemarks = group.projects.some((p) => p.remarks?.trim())
    if (!hasRemarks) {
      children.push(bodyPara('N/A', { color: MUTED }))
    } else {
      for (const project of group.projects) {
        const remark = project.remarks?.trim()
        if (!remark) continue
        if (group.projects.length > 1) {
          children.push(new Paragraph({
            children: [
              t(`${project.project_name}: `, { bold: true, size: 18, color: DARK }),
              t(remark, { size: 18, color: MID }),
            ],
            spacing: { before: 40, after: 40 },
          }))
        } else {
          children.push(bodyPara(remark))
        }
      }
    }

    children.push(subLabel('2. Solution Name / Location / Company / Project / WBS / Assignees'))

    for (const project of group.projects) {
      const sourceProject = projectMap.get(project.project_id)
      const assignees = formatAssignees(sourceProject?.assignees ?? [])

      // Project header
      children.push(projectHeaderBar(
        [project.solution_product, project.location, project.company, project.project_name, project.wbs_number, assignees]
          .map((v) => v || 'N/A').join('  /  ')
      ))

      // Schedules
      children.push(new Paragraph({
        children: [t('스케줄', { bold: true, size: 18, color: DARK })],
        spacing: { before: 100, after: 60 },
        indent: { left: 120 },
      }))
      if (project.project_schedules.length > 0) {
        children.push(scheduleTable(project.project_schedules))
      } else {
        children.push(new Paragraph({
          children: [t('N/A', { size: 18, color: MUTED })],
          spacing: { before: 40, after: 40 },
          indent: { left: 120 },
        }))
      }

      // Progress
      children.push(new Paragraph({
        children: [t('진행 상황', { bold: true, size: 18, color: DARK })],
        spacing: { before: 120, after: 60 },
        indent: { left: 120 },
      }))

      const progressItems = project.issue_items.flatMap((issue) =>
        issue.issue_progresses.map((p) => ({
          issueTitle: issue.title,
          progressTitle: p.title,
          details: p.details,
          dateRange: formatExportDateRange(p.start_date, p.end_date),
        })),
      )

      if (progressItems.length === 0) {
        children.push(new Paragraph({
          children: [t('N/A', { size: 18, color: MUTED })],
          spacing: { before: 40, after: 40 },
          indent: { left: 240 },
        }))
      } else {
        for (const item of progressItems) {
          children.push(bulletItem([
            t(`${item.issueTitle}: `, { bold: true, size: 18, color: DARK }),
            t(item.progressTitle, { size: 18, color: MID }),
            ...(item.details ? [t(` / ${item.details}`, { size: 18, color: MID })] : []),
            t(`  (${item.dateRange})`, { size: 18, color: MUTED }),
          ]))
        }
      }
      children.push(emptyPara(60))
    }
  }

  children.push(emptyPara(120))

  // ── B. 인원 일정 ─────────────────────────────────────────────────────
  children.push(sectionHeading('B. 인원 일정'))

  const scheduleTypes = ['출장', '외근', '휴가', '휴일근무']
  const ownerDisplay = [ownerName, ownerRank].filter(Boolean).join(' ')

  for (let i = 0; i < scheduleTypes.length; i++) {
    const type = scheduleTypes[i]
    const entries = report.week_schedule.filter((item) => item.type_name === type)
    children.push(subLabel(`${i + 1}) ${type}`))
    if (entries.length > 0) {
      children.push(schedulePersonTable(entries, ownerDisplay))
    } else {
      children.push(bodyPara('N/A', { color: MUTED }))
    }
    children.push(emptyPara(80))
  }

  // ── Assemble document ────────────────────────────────────────────────
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [{
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 480, hanging: 240 } } },
          }],
        },
      ],
    },
    styles: {
      default: {
        document: { run: { font: 'Malgun Gothic', size: 20, color: DARK } },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [
              t(`주간보고  Week-${report.week_number}`, { size: 16, color: MUTED }),
              t('   |   ', { size: 16, color: BORDER_C }),
              t(`${ownerName} ${ownerRank}`, { size: 16, color: MUTED }),
            ],
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_C, space: 4 } },
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              t('WeeklyReport  ', { size: 16, color: MUTED }),
              t('   |   Page ', { size: 16, color: BORDER_C }),
              new TextRun({ children: [PageNumber.CURRENT], font: 'Malgun Gothic', size: 16, color: MUTED }),
              t(' / ', { size: 16, color: BORDER_C }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Malgun Gothic', size: 16, color: MUTED }),
            ],
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_C, space: 4 } },
          })],
        }),
      },
      children,
    }],
  })

  return Packer.toBlob(doc)
}

function uniqueAssignees(assignees: { id: number; name: string; rank_name: string }[]) {
  const seen = new Set<number>()
  return assignees.filter((assignee) => {
    if (seen.has(assignee.id)) return false
    seen.add(assignee.id)
    return true
  })
}

function formatAssignees(assignees: { name: string; rank_name: string }[]) {
  if (!assignees.length) return 'N/A'
  return assignees.map((assignee) => `${assignee.name} ${assignee.rank_name}`).join(', ')
}

function formatExportDateRange(start: string, end?: string | null) {
  if (!end || end === start) return start
  return `${start} ~ ${end}`
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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
      <div className="report-issue-card">
      <div className="report-issue-row">
        <button
          className="report-issue-toggle"
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
        >
            <div className="report-issue-title-row">
            <span className="report-issue-title">{issue.title}</span>
            <span className={`chip ${PRIORITY_CHIP[priorityKey] ?? 'chip-on_hold'}`} style={{ fontSize: 10 }}>
              {PRIORITY_LABEL[priorityKey] ?? '중요'}
            </span>
            <span className={`chip ${statusChip}`} style={{ fontSize: 10 }}>{issue.status}</span>
            </div>
            {issue.details && <div className="report-issue-summary">{issue.details}</div>}
            <div className="report-issue-meta">
              {issue.start_date}
              {issue.end_date ? ` ~ ${issue.end_date}` : ''}
            </div>
        </button>
      </div>

      <div className={`report-issue-progress-collapse ${expanded ? 'is-expanded' : ''}`}>
        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          className="report-issue-hitarea report-issue-progress-hitarea"
          style={{ cursor: 'pointer', textAlign: 'left' }}
        >
          {issue.issue_progresses.length === 0 ? (
            <div className="report-issue-progress-empty">진행내역이 없습니다.</div>
          ) : issue.issue_progresses.map((progress) => (
            <div key={progress.id} className="report-issue-progress-row">
              <div className="report-issue-progress-date">
                {progress.start_date}{progress.end_date && progress.end_date !== progress.start_date ? ` ~ ${progress.end_date}` : ''}
              </div>
              <div className="report-issue-progress-copy">
                <div className="report-issue-progress-title">{progress.title}</div>
                {progress.details && <div className="report-issue-progress-detail">{progress.details}</div>}
                {progress.author_name && <div className="report-issue-progress-author">{progress.author_name}</div>}
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
