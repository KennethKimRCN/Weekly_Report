import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { projectsApi } from '../api'
import { useAuthStore } from '../store'
import { ProjectStatusChip, PageSpinner } from '../components/ui'
import type { Project } from '../types'

export default function MyProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const { user } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    async function load() {
      const res = await projectsApi.list()
      // Filter to only projects where current user is an assignee
      const mine = res.data.filter((p) =>
        p.assignees.some((a) => a.id === user?.id)
      )
      setProjects(mine)
      setLoading(false)
    }
    load()
  }, [user?.id])

  if (loading) return <PageSpinner />

  return (
    <div>
      <div className="page-header">
        <div className="page-title">내 프로젝트</div>
        <span className="text-muted text-sm" style={{ alignSelf: 'center' }}>
          배정된 프로젝트 {projects.length}개
        </span>
      </div>

      {projects.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
            </div>
            <div className="empty-title">배정된 프로젝트가 없습니다</div>
            <div className="empty-body">현재 담당자로 지정된 프로젝트가 없습니다.</div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {projects.map((project) => (
            <div
              key={project.id}
              className="card clickable"
              style={{ cursor: 'pointer', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}
              onClick={() => navigate(`/projects/${project.id}`)}
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && navigate(`/projects/${project.id}`)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div className="fw-500" style={{ color: 'var(--blue)', fontSize: 15, lineHeight: 1.4 }}>
                  {project.project_name}
                </div>
                <ProjectStatusChip status={project.status} />
              </div>

              <div style={{ display: 'grid', gap: 6 }}>
                {project.wbs_number && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                    <span className="text-muted" style={{ minWidth: 36 }}>WBS</span>
                    <span>{project.wbs_number}</span>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                  <span className="text-muted" style={{ minWidth: 36 }}>회사</span>
                  <span>{project.company}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                  <span className="text-muted" style={{ minWidth: 36 }}>위치</span>
                  <span>{project.location}</span>
                </div>
                {(project.start_date || project.end_date) && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                    <span className="text-muted" style={{ minWidth: 36 }}>기간</span>
                    <span className="text-sm">
                      {project.start_date ?? ''}{project.end_date ? ` ~ ${project.end_date}` : ''}
                    </span>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                {project.assignees.map((a) => (
                  <span
                    key={a.id}
                    className="assignee-chip"
                    style={a.id === user?.id ? { background: 'var(--blue)', color: '#fff' } : undefined}
                  >
                    {a.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
