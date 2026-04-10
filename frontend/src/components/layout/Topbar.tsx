import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore, useAppStore } from '../../store'
import { notificationsApi, searchApi, authApi } from '../../api'
import { fmtTime } from '../../hooks/useDates'
import { useToast } from '../ui/Toast'
import { Modal } from '../ui/Modal'
import { avatarColor, avatarInitials, PAGE_TITLES } from '../../utils/avatar'
import type { SearchResult } from '../../types'

// SVG notification icons — no emoji
function NotifIconSubmit()  { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> }
function NotifIconApproved() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg> }
function NotifIconRejected() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> }
function NotifIconBlocker()  { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> }
function NotifIconMention()  { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> }
function NotifIconDefault()  { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> }

function NotifIcon({ type }: { type: string }) {
  const map: Record<string, { cls: string; icon: React.ReactNode }> = {
    report_submitted: { cls: 'notif-icon--report',   icon: <NotifIconSubmit /> },
    report_approved:  { cls: 'notif-icon--approved', icon: <NotifIconApproved /> },
    report_rejected:  { cls: 'notif-icon--rejected', icon: <NotifIconRejected /> },
    blocker_reported: { cls: 'notif-icon--blocker',  icon: <NotifIconBlocker /> },
    mention:          { cls: 'notif-icon--mention',  icon: <NotifIconMention /> },
  }
  const cfg = map[type] ?? { cls: 'notif-icon--default', icon: <NotifIconDefault /> }
  return <div className={`notif-icon ${cfg.cls}`}>{cfg.icon}</div>
}

function ChevronIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
}

export function Topbar({
  onReportClick,
  onMobileMenuClick,
}: {
  onReportClick: (id: number) => void
  onMobileMenuClick?: () => void
}) {
  const { user, clearAuth } = useAuthStore()
  const { notifications, unreadCount, setNotifications } = useAppStore()
  const [notifOpen, setNotifOpen]     = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [searchQ, setSearchQ]         = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchOpen, setSearchOpen]   = useState(false)
  const [changePwOpen, setChangePwOpen] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout>>()
  const notifRef    = useRef<HTMLDivElement>(null)
  const accountRef  = useRef<HTMLDivElement>(null)
  const navigate    = useNavigate()
  const location    = useLocation()
  const { toast }   = useToast()

  // Current page title for breadcrumb
  const path = location.pathname
  const projectMatch = path.match(/^\/projects\/(\d+)/)
  const breadcrumb = projectMatch ? '프로젝트 상세' : (PAGE_TITLES[path] ?? '')

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (notifRef.current   && !notifRef.current.contains(e.target as Node))   setNotifOpen(false)
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setAccountOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function handleSearch(v: string) {
    setSearchQ(v)
    clearTimeout(searchTimer.current)
    if (v.length < 2) { setSearchOpen(false); return }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await searchApi.query(v)
        setSearchResults(res.data)
        setSearchOpen(true)
      } catch { setSearchOpen(false) }
    }, 300)
  }

  async function markAllRead() {
    await notificationsApi.readAll()
    const res = await notificationsApi.list()
    setNotifications(res.data)
  }

  async function handleNotifClick(notif: (typeof notifications)[0]) {
    await notificationsApi.readOne(notif.id)
    const res = await notificationsApi.list()
    setNotifications(res.data)
    setNotifOpen(false)
    if (notif.reference_type === 'report' && notif.reference_id) onReportClick(notif.reference_id)
  }

  function handleLogout() {
    setAccountOpen(false)
    clearAuth()
    navigate('/login')
  }

  const colorClass = avatarColor(user?.id ?? 0)
  const initials = avatarInitials(user?.name ?? '?')

  return (
    <div className="topbar" role="banner">
      {/* Mobile hamburger */}
      <button
        className="btn-icon"
        onClick={onMobileMenuClick}
        aria-label="메뉴 열기"
        style={{ display: 'none' }}
        id="mobile-menu-btn"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>

      {/* Breadcrumb */}
      {breadcrumb && (
        <div className="topbar-breadcrumb" aria-label="현재 페이지">
          {breadcrumb}
        </div>
      )}

      {/* Search */}
      <div className="topbar-search">
        <div className="topbar-search-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </div>
        <input
          value={searchQ}
          onChange={(e) => handleSearch(e.target.value)}
          onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
          placeholder="보고서 검색..."
          aria-label="보고서 검색"
          aria-autocomplete="list"
          aria-expanded={searchOpen}
        />
        {searchOpen && (
          <div className="dropdown-panel" style={{ top: 50, left: 0, right: 0, maxHeight: 320, overflowY: 'auto' }} role="listbox">
            {searchResults.length === 0 ? (
              <div className="dropdown-empty">검색 결과가 없습니다</div>
            ) : (
              searchResults.map((r, i) => (
                <div
                  key={i}
                  className="dropdown-item"
                  role="option"
                  onMouseDown={() => { setSearchOpen(false); onReportClick(r.report_id) }}
                >
                  <div>
                    <div className="fw-500 text-sm">{r.owner_name} · {r.week_start}</div>
                    <div className="text-sm text-muted">{r.source_type}: {r.content.slice(0, 70)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="topbar-actions">
        {/* Notifications */}
        <div ref={notifRef} style={{ position: 'relative' }}>
          <button
            className="btn-icon badge-wrap"
            onClick={() => setNotifOpen((o) => !o)}
            aria-label={`알림 ${unreadCount > 0 ? `(${unreadCount}개 읽지 않음)` : ''}`}
            aria-expanded={notifOpen}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {unreadCount > 0 && <span className="notif-badge" aria-hidden="true">{unreadCount}</span>}
          </button>

          {notifOpen && (
            <div className="dropdown-panel" style={{ right: 0, top: 44, width: 360, maxHeight: 480, overflowY: 'auto' }} role="menu">
              <div className="dropdown-header">
                <span>알림</span>
                <button className="btn btn-ghost btn-sm" onClick={markAllRead}>모두 읽음</button>
              </div>
              {notifications.length === 0 ? (
                <div className="dropdown-empty">알림이 없습니다</div>
              ) : (
                notifications.slice(0, 20).map((n) => (
                  <div
                    key={n.id}
                    className={`dropdown-item ${n.is_read ? '' : 'unread'}`}
                    onClick={() => handleNotifClick(n)}
                    role="menuitem"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && handleNotifClick(n)}
                  >
                    <NotifIcon type={n.type} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="fw-500 text-sm" style={{ color: 'var(--ink)' }}>{n.title}</div>
                      {n.message && <div className="text-sm text-muted" style={{ marginTop: 1 }}>{n.message.slice(0, 60)}</div>}
                      <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3 }}>{fmtTime(n.created_at)}</div>
                    </div>
                    {!n.is_read && <div className="unread-dot" aria-hidden="true" />}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Account — with chevron affordance */}
        <div ref={accountRef} style={{ position: 'relative' }}>
          <button
            className="account-btn"
            onClick={() => setAccountOpen((o) => !o)}
            title={user?.name ?? ''}
            aria-label="계정 메뉴"
            aria-expanded={accountOpen}
          >
            <div className={`avatar ${colorClass}`} style={{ fontSize: 13, width: 32, height: 32 }}>{initials}</div>
            <span className="account-chevron"><ChevronIcon /></span>
          </button>

          {accountOpen && (
            <div className="dropdown-panel" style={{ right: 0, top: 46, width: 220 }} role="menu">
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-2)' }}>
                <div className="fw-500" style={{ fontSize: 14, color: 'var(--ink)' }}>{user?.name}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1 }}>{user?.rank_name}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 1 }}>{user?.email}</div>
              </div>
              <button
                className="dropdown-item"
                style={{ gap: 10, fontSize: 13, color: 'var(--ink-2)' }}
                role="menuitem"
                onClick={() => { setAccountOpen(false); setChangePwOpen(true) }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                비밀번호 변경
              </button>
              <button
                className="dropdown-item"
                style={{ gap: 10, fontSize: 13, color: 'var(--red)' }}
                role="menuitem"
                onClick={handleLogout}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                로그아웃
              </button>
            </div>
          )}
        </div>
      </div>

      {changePwOpen && <ChangePasswordModal onClose={() => setChangePwOpen(false)} />}
    </div>
  )
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext]       = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  async function submit() {
    if (!current || !next)    { toast('모든 항목을 입력해주세요', 'error'); return }
    if (next !== confirm)     { toast('새 비밀번호가 일치하지 않습니다', 'error'); return }
    if (next.length < 6)      { toast('비밀번호는 6자 이상이어야 합니다', 'error'); return }
    setLoading(true)
    try {
      await authApi.changePassword(current, next)
      toast('비밀번호가 변경되었습니다', 'success')
      onClose()
    } catch (e: any) {
      toast(e.response?.data?.detail ?? '변경 실패', 'error')
    } finally { setLoading(false) }
  }

  return (
    <Modal
      title="비밀번호 변경"
      onClose={onClose}
      footer={
        <div className="flex gap-6">
          <button className="btn btn-ghost" onClick={onClose}>취소</button>
          <button className="btn btn-primary" onClick={submit} disabled={loading}>
            {loading ? (
              <span className="flex items-center gap-6">
                <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                변경 중…
              </span>
            ) : '변경'}
          </button>
        </div>
      }
    >
      <div className="form-group">
        <label>현재 비밀번호</label>
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
      </div>
      <div className="form-group">
        <label>새 비밀번호 <span className="field-hint">(6자 이상)</span></label>
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
      </div>
      <div className="form-group">
        <label>새 비밀번호 확인</label>
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </div>
    </Modal>
  )
}
