import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { projectsApi } from '../api'
import { useAuthStore, useAppStore } from '../store'
import { ProjectStatusChip, PageSpinner } from '../components/ui'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import type { Project, ProjectStatus } from '../types'

const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: '진행중', on_hold: '보류', completed: '완료', cancelled: '취소',
}

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading]   = useState(true)
  const [editing, setEditing]   = useState<Partial<Project> | null>(null)
  const [filterQ, setFilterQ]   = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [assigneeSearch, setAssigneeSearch] = useState('')
  const { user } = useAuthStore()
  const { lookups } = useAppStore()
  const { toast } = useToast()
  const navigate = useNavigate()

  async function load() { const res = await projectsApi.list(); setProjects(res.data); setLoading(false) }
  useEffect(() => { load() }, [])

  const filtered = projects.filter((p) => {
    const matchQ  = !filterQ || p.project_name.toLowerCase().includes(filterQ.toLowerCase())
    const matchSt = !filterStatus || p.status === filterStatus
    return matchQ && matchSt
  })

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
      assignee_ids: (editing.assignees ?? []).map((a) => a.id),
    }
    if (!body.project_name || !body.company || !body.location) {
      toast('필수 항목을 입력해주세요', 'error'); return
    }
    try {
      if (editing.id) await projectsApi.update(editing.id, body)
      else            await projectsApi.create(body)
      toast('저장되었습니다', 'success')
      setEditing(null); load()
    } catch (e: any) { toast(e.response?.data?.detail ?? '오류', 'error') }
  }

  const allUsers = lookups?.users_simple ?? []
  const filteredUsers = allUsers.filter((u) =>
    !assigneeSearch || u.name.toLowerCase().includes(assigneeSearch.toLowerCase())
  )

  function toggleAssignee(userId: number) {
    if (!editing) return
    const current = editing.assignees ?? []
    const exists  = current.find((a) => a.id === userId)
    setEditing({
      ...editing,
      assignees: exists
        ? current.filter((a) => a.id !== userId)
        : [...current, { id: userId, name: allUsers.find((u) => u.id === userId)?.name ?? '', rank_name: '' }],
    })
  }

  if (loading) return <PageSpinner />

  return (
    <div>
      <div className="page-header">
        <div className="page-title">프로젝트</div>
        {user?.is_admin === 1 && (
          <button className="btn btn-primary" onClick={() => { setEditing({ status: 'active', assignees: [] }); setAssigneeSearch('') }}>
            + 프로젝트 추가
          </button>
        )}
      </div>

      {/* Filter toolbar */}
      <div className="filter-bar">
        <div className="filter-search">
          <div className="filter-search-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>
          <input
            value={filterQ}
            onChange={(e) => setFilterQ(e.target.value)}
            placeholder="프로젝트명 검색..."
            aria-label="프로젝트명 검색"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          aria-label="상태 필터"
        >
          <option value="">전체 상태</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
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
                  <td colSpan={8}>
                    <div className="empty-state">
                      <div className="empty-icon">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                          <polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>
                        </svg>
                      </div>
                      <div className="empty-title">프로젝트가 없습니다</div>
                      <div className="empty-body">
                        {filterQ || filterStatus ? '검색 조건을 변경해보세요.' : '프로젝트를 추가해 보세요.'}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : filtered.map((p) => (
                <tr
                  key={p.id}
                  className="clickable"
                  onClick={() => navigate(`/projects/${p.id}`)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/projects/${p.id}`)}
                >
                  <td className="fw-500" style={{ color: 'var(--blue)' }}>{p.project_name}</td>
                  <td className="text-muted text-sm">{p.wbs_number ?? '—'}</td>
                  <td>{p.company}</td>
                  <td>{p.location}</td>
                  <td><ProjectStatusChip status={p.status} /></td>
                  <td>
                    {p.assignees.length > 0
                      ? p.assignees.map((a) => <span key={a.id} className="assignee-chip">{a.name}</span>)
                      : <span className="text-muted text-sm">—</span>}
                  </td>
                  <td className="text-sm text-muted col-date">
                    {p.start_date ?? ''}
                    {p.end_date ? ` ~ ${p.end_date}` : ''}
                  </td>
                  {user?.is_admin === 1 && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(p); setAssigneeSearch('') }}>편집</button>
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
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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
                  <div style={{ padding: '8px', fontSize: 12, color: 'var(--ink-4)', textAlign: 'center' }}>결과 없음</div>
                ) : filteredUsers.map((u) => {
                  const checked = !!(editing.assignees ?? []).find((a) => a.id === u.id)
                  return (
                    <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', cursor: 'pointer', borderRadius: 4 }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleAssignee(u.id)} style={{ width: 'auto' }} />
                      <span style={{ fontSize: 13 }}>{u.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--ink-4)', marginLeft: 'auto' }}>{u.rank_name}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
