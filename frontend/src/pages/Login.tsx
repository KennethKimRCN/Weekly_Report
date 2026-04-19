import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi, lookupsApi, notificationsApi } from '../api'
import { useAuthStore, useAppStore } from '../store'

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [success, setSuccess]   = useState(false)
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
      // show success state briefly before navigating
      setSuccess(true)
      setTimeout(() => {
        if ('startViewTransition' in document) {
          (document as any).startViewTransition(() => navigate('/'))
        } else {
          navigate('/')
        }
      }, 420)
    } catch (e: any) {
      setError(e.response?.data?.detail ?? '이메일 또는 비밀번호가 올바르지 않습니다')
      setLoading(false)
    }
  }

  const submitClass = [
    'login-submit',
    loading && !success ? 'login-submit--loading' : '',
    success ? 'login-submit--success' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className="login-wrap">

      {/* ── left branding panel ── */}
      <div className="login-panel" style={{ viewTransitionName: 'login-panel' }}>
        <div className="login-panel-inner">
          <img
            src="/Yokogawa Logo.png"
            alt="Yokogawa"
            style={{ height: 28, objectFit: 'contain', marginBottom: 40, opacity: 0.9 }}
          />
          <div className="login-panel-logo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
              <line x1="8" y1="14" x2="16" y2="14"/>
              <line x1="8" y1="18" x2="13" y2="18"/>
            </svg>
            <span style={{ viewTransitionName: 'brand-logo' }}>WeeklyReport</span>
          </div>

          <div className="login-panel-headline">
            팀의 진행 상황을<br />한눈에 파악하세요
          </div>
          <div className="login-panel-sub">
            주간 보고서 작성부터 승인, 분석까지<br />하나의 플랫폼에서 관리합니다
          </div>

          <div className="login-panel-features">
            {[
              { icon: '📋', text: '주간 보고서 작성 및 승인' },
              { icon: '📊', text: '프로젝트 이슈 및 일정 추적' },
              { icon: '🔍', text: '주간 변경 분석 및 리포트' },
            ].map(({ icon, text }) => (
              <div className="login-panel-feature" key={text}>
                <span className="login-panel-feature-icon">{icon}</span>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="login-panel-deco-1" aria-hidden="true" />
        <div className="login-panel-deco-2" aria-hidden="true" />
      </div>

      {/* ── right form panel ── */}
      <div className="login-form-side" style={{ viewTransitionName: 'login-form-side' }}>
        <div className="login-form-wrap">
          <div className="login-form-heading">로그인</div>
          <div className="login-form-sub">계정 정보를 입력해 주세요</div>

          <form onSubmit={submit} noValidate>
            <div className="login-field">
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="이메일"
                required
                autoFocus
                autoComplete="email"
                className={error ? 'login-input login-input--error' : 'login-input'}
                disabled={loading || success}
              />
            </div>
            <div className="login-field">
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호"
                required
                autoComplete="current-password"
                className={error ? 'login-input login-input--error' : 'login-input'}
                disabled={loading || success}
              />
            </div>

            <div className="login-error-slot">
              {error && (
                <div className="login-error" role="alert">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  {error}
                </div>
              )}
            </div>

            <button type="submit" className={submitClass} disabled={loading || success}>
              {success ? (
                <span className="login-submit-loading">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  로그인 성공
                </span>
              ) : loading ? (
                <span className="login-submit-loading">
                  <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2, borderColor: 'rgba(255,255,255,.35)', borderTopColor: '#fff' }} />
                  로그인 중…
                </span>
              ) : '로그인'}
            </button>
          </form>
        </div>
      </div>

    </div>
  )
}
