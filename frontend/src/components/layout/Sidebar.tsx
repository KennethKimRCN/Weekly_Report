import { useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore, useAppStore } from '../../store'
import { avatarColor, avatarInitials } from '../../utils/avatar'

const NAV = [
  {
    section: '메인',
    items: [
      { path: '/',             label: '대시보드', icon: DashIcon },
      { path: '/my-report',    label: '내 보고서', icon: ReportIcon },
      { path: '/team-reports', label: '팀 보고서', icon: TeamIcon },
      { path: '/calendar',     label: '일정',     icon: CalIcon },
    ],
  },
  {
    section: '관리',
    items: [
      { path: '/projects',  label: '프로젝트', icon: LayersIcon },
      { path: '/analytics', label: '분석',     icon: BarIcon },
      { path: '/members',   label: '팀원',     icon: UsersIcon },
    ],
  },
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
          <span className="sidebar-logo">WeeklyReport</span>
        </div>

        <nav className="sidebar-nav" aria-label="주요 메뉴">
          {NAV.map(({ section, items }) => (
            <div key={section}>
              <div className="nav-section-label">{section}</div>
              {items.map(({ path, label, icon: Icon }) => (
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
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className={`avatar avatar-sm ${colorClass}`}>{initials}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user?.name}</div>
            <div className="sidebar-user-rank">{user?.rank_name}</div>
          </div>
        </div>
      </div>
    </>
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
