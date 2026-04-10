import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi, lookupsApi, notificationsApi } from '../api'
import { useAuthStore, useAppStore } from '../store'

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const { setAuth } = useAuthStore()
  const { setLookups, setNotifications } = useAppStore()
  const navigate = useNavigate()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await authApi.login(email, password)
      setAuth(res.data.access_token, res.data.user as any)
      const [meRes, lkRes, notifRes] = await Promise.all([
        authApi.me(), lookupsApi.get(), notificationsApi.list(),
      ])
      setAuth(res.data.access_token, meRes.data)
      setLookups(lkRes.data)
      setNotifications(notifRes.data)
      navigate('/')
    } catch (e: any) {
      setError(e.response?.data?.detail ?? '이메일 또는 비밀번호가 올바르지 않습니다')
    } finally { setLoading(false) }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo-wrap">
          {/* Brand icon */}
          <div className="login-logo-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
              <line x1="8" y1="14" x2="16" y2="14"/>
              <line x1="8" y1="18" x2="13" y2="18"/>
            </svg>
          </div>
          <div className="login-logo">WeeklyReport</div>
        </div>
        <div className="login-subtitle">주간 보고서 시스템에 로그인하세요</div>

        <form onSubmit={submit} noValidate>
          {error && <div className="login-error" role="alert">{error}</div>}
          <div className="form-group">
            <label htmlFor="login-email">이메일</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              required
              autoFocus
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label htmlFor="login-password">비밀번호</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호를 입력하세요"
              required
              autoComplete="current-password"
            />
          </div>
          <button type="button" className="login-forgot">비밀번호를 잊으셨나요?</button>
          <button
            type="submit"
            className="btn btn-primary w-full"
            style={{ justifyContent: 'center', padding: '11px 16px', borderRadius: 'var(--radius-sm)', fontSize: 14, marginTop: 8 }}
            disabled={loading}
          >
            {loading ? (
              <span className="flex items-center gap-8">
                <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2, borderColor: 'rgba(255,255,255,.4)', borderTopColor: '#fff' }} />
                로그인 중…
              </span>
            ) : '로그인'}
          </button>
        </form>
      </div>
    </div>
  )
}
