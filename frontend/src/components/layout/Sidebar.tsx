import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore, useAppStore } from '../../store'
import { avatarColor, avatarInitials } from '../../utils/avatar'
import { projectsApi } from '../../api'
import type { Project } from '../../types'

const NAV_MAIN = [
  { path: '/',             label: '대시보드', icon: DashIcon },
  { path: '/my-report',    label: '내 보고서', icon: ReportIcon },
  { path: '/team-reports', label: '팀 보고서', icon: TeamIcon },
  { path: '/calendar',     label: '일정',     icon: CalIcon },
]

const NAV_MANAGE = [
  { path: '/projects',  label: '프로젝트', icon: LayersIcon },
  { path: '/analytics', label: '분석',     icon: BarIcon },
  { path: '/members',   label: '팀원',     icon: UsersIcon },
]

const NAV_ADMIN = [
  { path: '/admin/llm-settings', label: 'LLM Settings', icon: SparkIcon },
]

interface SidebarProps {
  mobileOpen?: boolean
  onMobileClose?: () => void
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const { user } = useAuthStore()
  const { sidebarOpen, toggleSidebar } = useAppStore()
  const location = useLocation()
  const navigate = useNavigate()
  const [myProjects, setMyProjects] = useState<Project[]>([])
  const [myProjectsOpen, setMyProjectsOpen] = useState(true)

  useEffect(() => {
    if (!user?.id) return
    projectsApi.list().then((res) => {
      const mine = res.data.filter((p) => p.assignees.some((a) => a.id === user.id))
      setMyProjects(mine)
    }).catch(() => {})
  }, [user?.id])

  function handleNav(path: string) {
    navigate(path)
    onMobileClose?.()
  }

  const colorClass = avatarColor(user?.id ?? 0)
  const initials = avatarInitials(user?.name ?? '?')

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={`sidebar-backdrop ${mobileOpen ? '' : 'hidden'}`}
        onClick={onMobileClose}
        aria-hidden="true"
      />

      <div className={`sidebar ${sidebarOpen ? '' : 'collapsed'} ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <button
            className="btn-icon"
            onClick={mobileOpen ? onMobileClose : toggleSidebar}
            title="메뉴 접기/펼치기"
            aria-label="메뉴 접기/펼치기"
          >
            <MenuIcon />
          </button>
          <div className="sidebar-brand">
            <span className="sidebar-eyebrow">Digital Innovation Division</span>
            <span className="sidebar-logo">WeeklyReport</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="주요 메뉴">
          {/* 메인 section */}
          <div>
            <div className="nav-section-label">메인</div>
            {NAV_MAIN.map(({ path, label, icon: Icon }) => (
              <button
                key={path}
                className={`nav-item ${location.pathname === path ? 'active' : ''}`}
                onClick={() => handleNav(path)}
                title={sidebarOpen ? undefined : label}
                aria-current={location.pathname === path ? 'page' : undefined}
              >
                <Icon />
                <span className="nav-label">{label}</span>
              </button>
            ))}
          </div>

          {/* 내 프로젝트 section */}
          <div>
            <div className="nav-section-label" style={{ display: 'flex', alignItems: 'center', padding: '0 4px 0 0' }}>
              <button
                className={`nav-item ${location.pathname === '/my-projects' ? 'active' : ''}`}
                onClick={() => handleNav('/my-projects')}
                title={sidebarOpen ? undefined : '내 프로젝트'}
                aria-current={location.pathname === '/my-projects' ? 'page' : undefined}
                style={{ flex: 1, margin: 0 }}
              >
                <FolderIcon />
                <span className="nav-label">내 프로젝트</span>
              </button>
              {sidebarOpen && myProjects.length > 0 && (
                <button
                  onClick={() => setMyProjectsOpen((v) => !v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', padding: '4px', borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center' }}
                  title={myProjectsOpen ? '접기' : '펼치기'}
                >
                  <ChevronIcon open={myProjectsOpen} />
                </button>
              )}
            </div>

            {/* Project sub-items */}
            {sidebarOpen && myProjectsOpen && myProjects.map((project) => {
              const projectPath = `/projects/${project.id}`
              const isActive = location.pathname === projectPath
              return (
                <button
                  key={project.id}
                  className={`nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => handleNav(projectPath)}
                  title={project.project_name}
                  aria-current={isActive ? 'page' : undefined}
                  style={{ paddingLeft: 36 }}
                >
                  <DotIcon />
                  <span className="nav-label" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {project.project_name}
                  </span>
                  {(project.open_issue_count ?? 0) > 0 && (
                    <span style={{
                      flexShrink: 0,
                      marginLeft: 4,
                      height: 16,
                      borderRadius: 4,
                      background: 'var(--ink-2, rgba(0,0,0,0.12))',
                      color: 'var(--ink-5, #888)',
                      fontSize: 10,
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 5px',
                      lineHeight: 1,
                    }}>
                      {project.open_issue_count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* 관리 section */}
          <div>
            <div className="nav-section-label">관리</div>
            {NAV_MANAGE.map(({ path, label, icon: Icon }) => (
              <button
                key={path}
                className={`nav-item ${location.pathname === path ? 'active' : ''}`}
                onClick={() => handleNav(path)}
                title={sidebarOpen ? undefined : label}
                aria-current={location.pathname === path ? 'page' : undefined}
              >
                <Icon />
                <span className="nav-label">{label}</span>
              </button>
            ))}
          </div>

          {user?.is_admin === 1 && (
            <div>
              <div className="nav-section-label">Admin</div>
              {NAV_ADMIN.map(({ path, label, icon: Icon }) => (
                <button
                  key={path}
                  className={`nav-item ${location.pathname === path ? 'active' : ''}`}
                  onClick={() => handleNav(path)}
                  title={sidebarOpen ? undefined : label}
                  aria-current={location.pathname === path ? 'page' : undefined}
                >
                  <Icon />
                  <span className="nav-label">{label}</span>
                </button>
              ))}
            </div>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className={`avatar avatar-sm sidebar-avatar ${colorClass}`}>{initials}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user?.name}</div>
            <div className="sidebar-user-rank">{user?.rank_name}</div>
          </div>
          {sidebarOpen && <span className="sidebar-status">Online</span>}
        </div>
      </div>
    </>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"
      style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}
function DotIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
function FolderIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  )
}
function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  )
}
function DashIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
    </svg>
  )
}
function ReportIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  )
}
function TeamIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )
}
function CalIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}
function LayersIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <polygon points="12 2 2 7 12 12 22 7 12 2"/>
      <polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>
    </svg>
  )
}
function BarIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  )
}
function UsersIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  )
}
function SparkIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/>
      <path d="M19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16z"/>
    </svg>
  )
}
