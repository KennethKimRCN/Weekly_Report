import { useEffect, useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { useAuthStore, useAppStore } from '../../store'
import { authApi, lookupsApi, notificationsApi, registerNavigate } from '../../api'
import { useReportModal } from '../../hooks/useReportModal'
import { PAGE_TITLES } from '../../utils/avatar'

export function AppShell() {
  const { token, setAuth, clearAuth } = useAuthStore()
  const { setLookups, setNotifications } = useAppStore()
  const [booting, setBooting] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  // Update document title on route change
  useEffect(() => {
    const base = 'WeeklyReport'
    const path = location.pathname
    const projectMatch = path.match(/^\/projects\/\d+/)
    let title = base
    if (projectMatch) {
      title = `프로젝트 상세 — ${base}`
    } else if (PAGE_TITLES[path]) {
      title = `${PAGE_TITLES[path]} — ${base}`
    }
    document.title = title
  }, [location.pathname])

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => { registerNavigate(navigate) }, [navigate])

  useEffect(() => {
    if (!token) { navigate('/login'); setBooting(false); return }
    ;(async () => {
      try {
        const [meRes, lkRes, notifRes] = await Promise.all([
          authApi.me(),
          lookupsApi.get(),
          notificationsApi.list(),
        ])
        setAuth(token, meRes.data)
        setLookups(lkRes.data)
        setNotifications(notifRes.data)
      } catch {
        clearAuth()
        navigate('/login')
      } finally {
        setBooting(false)
      }
    })()
  }, [])

  useEffect(() => {
    if (!token) return
    const id = setInterval(async () => {
      try { const res = await notificationsApi.list(); setNotifications(res.data) } catch {}
    }, 30_000)
    return () => clearInterval(id)
  }, [token])

  const { openReport, modals } = useReportModal()

  if (booting) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="spinner" style={{ width: 40, height: 40 }} />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <Sidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className="main-area">
        <Topbar
          onReportClick={openReport}
          onMobileMenuClick={() => setMobileOpen(true)}
        />
        <main className="page-content">
          <div className="page-enter">
            <Outlet />
          </div>
        </main>
      </div>
      {modals}
    </div>
  )
}
