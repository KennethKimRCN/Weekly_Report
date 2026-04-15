import { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { projectsApi } from '../api'
import { useAuthStore, useAppStore } from '../store'
import { ProjectStatusChip, PageSpinner } from '../components/ui'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import type { Project, ProjectStatus } from '../types'

const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: '진행중',
  on_hold: '보류',
  completed: '완료',
  cancelled: '취소',
}

/** Highlight matching substrings in a string, returning spans */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-highlight">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
}

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<Project> | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [filterQ, setFilterQ] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [assigneeSearch, setAssigneeSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const { user } = useAuthStore()
  const { lookups } = useAppStore()
  const { toast } = useToast()
  const navigate = useNavigate()

  async function load() {
    const res = await projectsApi.list()
    setProjects(res.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Collect all unique assignees from loaded projects for the filter dropdown
  const allAssigneesInProjects = useMemo(() => {
    const map = new Map<number, string>()
    projects.forEach((p) => p.assignees.forEach((a) => map.set(a.id, a.name)))
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [projects])

  const q = filterQ.trim().toLowerCase()

  const filtered = useMemo(() => projects.filter((project) => {
    if (filterStatus && project.status !== filterStatus) return false
    if (filterAssignee && !project.assignees.some((a) => String(a.id) === filterAssignee)) return false
    if (!q) return true
    return (
      project.project_name.toLowerCase().includes(q) ||
      (project.company ?? '').toLowerCase().includes(q) ||
      (project.location ?? '').toLowerCase().includes(q) ||
      (project.wbs_number ?? '').toLowerCase().includes(q) ||
      (project.solution_product ?? '').toLowerCase().includes(q) ||
      project.assignees.some((a) => a.name.toLowerCase().includes(q))
    )
  }), [projects, q, filterStatus, filterAssignee])

  const activeFilters = [
    filterStatus ? { key: 'status', label: STATUS_LABELS[filterStatus as ProjectStatus] ?? filterStatus, clear: () => setFilterStatus('') } : null,
    filterAssignee ? { key: 'assignee', label: allAssigneesInProjects.find((a) => String(a.id) === filterAssignee)?.name ?? '', clear: () => setFilterAssignee('') } : null,
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[]

  function clearAll() {
    setFilterQ('')
    setFilterStatus('')
    setFilterAssignee('')
  }

  async function save() {
    if (!editing) return

    const body = {
      project_name: editing.project_name ?? '',
      wbs_number: editing.wbs_number ?? null,
      solution_product: editing.solution_product ?? null,
      company: editing.company ?? '',
      location: editing.location ?? '',
      status: (editing.status ?? 'active') as ProjectStatus,
      start_date: editing.start_date ?? null,
      end_date: editing.end_date ?? null,
      assignee_ids: (editing.assignees ?? []).map((assignee) => assignee.id),
    }

    if (!body.project_name || !body.company || !body.location) {
      toast('필수 항목을 입력해 주세요.', 'error')
      return
    }

    try {
      if (editing.id) await projectsApi.update(editing.id, body)
      else await projectsApi.create(body)
      toast('프로젝트를 저장했습니다.', 'success')
      setEditing(null)
      load()
    } catch (e: any) {
      toast(e.response?.data?.detail ?? '저장하지 못했습니다.', 'error')
    }
  }

  const allUsers = lookups?.users_simple ?? []
  const filteredUsers = allUsers.filter((person) => !assigneeSearch || person.name.toLowerCase().includes(assigneeSearch.toLowerCase()))

  function toggleAssignee(userId: number) {
    if (!editing) return

    const current = editing.assignees ?? []
    const exists = current.find((assignee) => assignee.id === userId)
    const selectedUser = allUsers.find((person) => person.id === userId)

    setEditing({
      ...editing,
      assignees: exists
        ? current.filter((assignee) => assignee.id !== userId)
        : [
          ...current,
          {
            id: userId,
            name: selectedUser?.name ?? '',
            rank_name: selectedUser?.rank_name ?? '',
          },
        ],
    })
  }

  async function downloadTemplate() {
    try {
      const res = await projectsApi.downloadImportTemplate()
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'project-import-template.xlsx'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(url)
    } catch (e: any) {
      toast(e.response?.data?.detail ?? '템플릿을 다운로드하지 못했습니다.', 'error')
    }
  }

  async function runImport() {
    if (!importFile) {
      toast('가져올 Excel 파일을 선택해 주세요.', 'error')
      return
    }

    setImporting(true)
    try {
      const res = await projectsApi.importExcel(importFile)
      const summary = res.data
      toast(
        `프로젝트 ${summary.projects_created}개 추가, ${summary.projects_updated}개 업데이트, 마일스톤 ${summary.milestones_created}개, 이슈 ${summary.issues_created}개, 진행내역 ${summary.progress_created}개를 가져왔습니다.`,
        'success',
      )
      summary.warnings.slice(0, 5).forEach((warning) => toast(warning, 'info'))
      setImportOpen(false)
      setImportFile(null)
      load()
    } catch (e: any) {
      toast(e.response?.data?.detail ?? '가져오기에 실패했습니다.', 'error')
    } finally {
      setImporting(false)
    }
  }

  if (loading) return <PageSpinner />

  return (
    <div>
      <div className="page-header">
        <div className="page-title">프로젝트</div>
        {user?.is_admin === 1 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={() => setImportOpen(true)}>
              Excel 가져오기
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setEditing({ status: 'active', assignees: [] })
                setAssigneeSearch('')
              }}
            >
              + 프로젝트 추가
            </button>
          </div>
        )}
      </div>

      <div className="search-bar-wrap">
        <div className="search-bar-row">
          {/* Main search input */}
          <div className="search-main">
            <svg className="search-main-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchRef}
              value={filterQ}
              onChange={(e) => setFilterQ(e.target.value)}
              placeholder="프로젝트명, 회사, 위치, WBS, 담당자 검색..."
              aria-label="통합 검색"
              className="search-main-input"
            />
            {filterQ && (
              <button className="search-clear-btn" onClick={() => { setFilterQ(''); searchRef.current?.focus() }} aria-label="검색어 지우기">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" />
                </svg>
              </button>
            )}
          </div>

          {/* Status filter */}
          <div className="search-filter-select-wrap">
            <svg className="search-filter-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="8" cy="8" r="2.5" /><circle cx="8" cy="8" r="6" strokeDasharray="2 2.5" />
            </svg>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              aria-label="상태 필터"
              className={`search-filter-select ${filterStatus ? 'is-active' : ''}`}
            >
              <option value="">전체 상태</option>
              {Object.entries(STATUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          {/* Assignee filter */}
          <div className="search-filter-select-wrap">
            <svg className="search-filter-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="8" cy="5.5" r="2.5" /><path d="M2 13c0-3 2.7-5 6-5s6 2 6 5" />
            </svg>
            <select
              value={filterAssignee}
              onChange={(e) => setFilterAssignee(e.target.value)}
              aria-label="담당자 필터"
              className={`search-filter-select ${filterAssignee ? 'is-active' : ''}`}
            >
              <option value="">전체 담당자</option>
              {allAssigneesInProjects.map((a) => (
                <option key={a.id} value={String(a.id)}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Active filter chips + result count */}
        {(activeFilters.length > 0 || filterQ || projects.length > 0) && (
          <div className="search-meta-row">
            <span className="search-result-count">
              {filtered.length === projects.length
                ? `전체 ${projects.length}개 프로젝트`
                : <><strong>{filtered.length}</strong>개 검색됨 / 전체 {projects.length}개</>}
            </span>
            <div className="search-chip-row">
              {activeFilters.map((f) => (
                <span key={f.key} className="search-filter-chip">
                  {f.label}
                  <button onClick={f.clear} aria-label={`${f.label} 필터 제거`}>
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" />
                    </svg>
                  </button>
                </span>
              ))}
              {(activeFilters.length > 0 || filterQ) && (
                <button className="search-clear-all" onClick={clearAll}>모두 초기화</button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap" style={{ border: 'none', borderRadius: 'var(--radius)' }}>
          <table>
            <thead>
              <tr>
                <th className="col-name">프로젝트명</th>
                <th>WBS</th>
                <th>회사</th>
                <th>위치</th>
                <th className="col-status">상태</th>
                <th>담당자</th>
                <th className="col-date">기간</th>
                {user?.is_admin === 1 && <th className="col-action">작업</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={user?.is_admin === 1 ? 8 : 7}>
                    <div className="empty-state">
                      <div className="empty-icon">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <polygon points="12 2 2 7 12 12 22 7 12 2" />
                          <polyline points="2 17 12 22 22 17" />
                          <polyline points="2 12 12 17 22 12" />
                        </svg>
                      </div>
                      <div className="empty-title">프로젝트가 없습니다</div>
                      <div className="empty-body">
                        {filterQ || filterStatus ? '검색 조건을 조정해 보세요.' : '프로젝트를 추가하거나 Excel로 가져와 보세요.'}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : filtered.map((project) => (
                <tr
                  key={project.id}
                  className="clickable"
                  onClick={() => navigate(`/projects/${project.id}`)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/projects/${project.id}`)}
                >
                  <td className="fw-500" style={{ color: 'var(--blue)' }}><Highlight text={project.project_name} query={filterQ} /></td>
                  <td className="text-muted text-sm"><Highlight text={project.wbs_number ?? '-'} query={filterQ} /></td>
                  <td><Highlight text={project.company} query={filterQ} /></td>
                  <td><Highlight text={project.location} query={filterQ} /></td>
                  <td><ProjectStatusChip status={project.status} /></td>
                  <td>
                    {project.assignees.length > 0
                      ? project.assignees.map((assignee) => (
                          <span key={assignee.id} className="assignee-chip">
                            <Highlight text={assignee.name} query={filterQ} />
                          </span>
                        ))
                      : <span className="text-muted text-sm">-</span>}
                  </td>
                  <td className="text-sm text-muted col-date">
                    {project.start_date ?? ''}
                    {project.end_date ? ` ~ ${project.end_date}` : ''}
                  </td>
                  {user?.is_admin === 1 && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setEditing(project)
                          setAssigneeSearch('')
                        }}
                      >
                        편집
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <Modal
          title={editing.id ? '프로젝트 편집' : '프로젝트 추가'}
          onClose={() => setEditing(null)}
          footer={
            <div className="flex gap-6">
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>취소</button>
              <button className="btn btn-primary" onClick={save}>{editing.id ? '저장' : '추가'}</button>
            </div>
          }
        >
          <div className="form-group">
            <label>프로젝트명 *</label>
            <input value={editing.project_name ?? ''} onChange={(e) => setEditing({ ...editing, project_name: e.target.value })} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>WBS 번호</label>
              <input value={editing.wbs_number ?? ''} onChange={(e) => setEditing({ ...editing, wbs_number: e.target.value })} />
            </div>
            <div className="form-group">
              <label>솔루션/제품</label>
              <input value={editing.solution_product ?? ''} onChange={(e) => setEditing({ ...editing, solution_product: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>회사 *</label>
              <input value={editing.company ?? ''} onChange={(e) => setEditing({ ...editing, company: e.target.value })} />
            </div>
            <div className="form-group">
              <label>위치 *</label>
              <input value={editing.location ?? ''} onChange={(e) => setEditing({ ...editing, location: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label>상태</label>
            <select value={editing.status ?? 'active'} onChange={(e) => setEditing({ ...editing, status: e.target.value as ProjectStatus })}>
              {Object.entries(STATUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>시작일</label>
              <input type="date" value={editing.start_date ?? ''} onChange={(e) => setEditing({ ...editing, start_date: e.target.value })} />
            </div>
            <div className="form-group">
              <label>종료일</label>
              <input type="date" value={editing.end_date ?? ''} onChange={(e) => setEditing({ ...editing, end_date: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label>담당자 배정</label>
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', maxHeight: 200, overflowY: 'auto' }}>
              <div className="assignee-search">
                <input
                  value={assigneeSearch}
                  onChange={(e) => setAssigneeSearch(e.target.value)}
                  placeholder="이름으로 검색..."
                />
              </div>
              <div style={{ padding: 4 }}>
                {filteredUsers.length === 0 ? (
                  <div style={{ padding: '8px', fontSize: 12, color: 'var(--ink-4)', textAlign: 'center' }}>검색 결과 없음</div>
                ) : filteredUsers.map((person) => {
                  const checked = !!(editing.assignees ?? []).find((assignee) => assignee.id === person.id)
                  return (
                    <label key={person.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', cursor: 'pointer', borderRadius: 4 }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleAssignee(person.id)} style={{ width: 'auto' }} />
                      <span style={{ fontSize: 13 }}>{person.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--ink-4)', marginLeft: 'auto' }}>{person.rank_name ?? ''}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {importOpen && (
        <Modal
          title="프로젝트 Excel 가져오기"
          onClose={() => {
            if (!importing) {
              setImportOpen(false)
              setImportFile(null)
            }
          }}
          footer={
            <div className="flex gap-6">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setImportOpen(false)
                  setImportFile(null)
                }}
                disabled={importing}
              >
                취소
              </button>
              <button className="btn btn-primary" onClick={runImport} disabled={importing || !importFile}>
                {importing ? '가져오는 중...' : '가져오기 실행'}
              </button>
            </div>
          }
        >
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
              관리자 전용 기능입니다. 템플릿을 다운로드해 `Projects`, `Milestones`, `Issues`, `IssueProgress`
              시트를 작성한 뒤 업로드하면 프로젝트와 프로젝트 기록 데이터를 한 번에 가져옵니다.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={downloadTemplate}>템플릿 다운로드</button>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Excel 파일</label>
              <input type="file" accept=".xlsx,.xlsm" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} />
              <div className="field-hint" style={{ marginTop: 6 }}>
                날짜는 `YYYY-MM-DD` 형식으로 입력해 주세요.
              </div>
              {importFile && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-3)' }}>
                  선택된 파일: {importFile.name}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
