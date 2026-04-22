import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi, lookupsApi, notificationsApi } from '../api'
import { useAuthStore, useAppStore } from '../store'

const HEADLINE = '함께 만들어가는 팀 이야기'
const SUBLINE  = '기록하고, 공유하고, 함께 이해하는\n더 나은 업무의 시작'

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [success, setSuccess]   = useState(false)

  const [headlineIdx, setHeadlineIdx] = useState(0)
  const [subIdx, setSubIdx]           = useState(0)
  const [subStarted, setSubStarted]   = useState(false)

  const { setAuth } = useAuthStore()
  const { setLookups, setNotifications } = useAppStore()
  const navigate = useNavigate()

  // Type headline first, then subline after a short pause
  useEffect(() => {
    if (headlineIdx < HEADLINE.length) {
      const t = setTimeout(() => setHeadlineIdx(i => i + 1), 60)
      return () => clearTimeout(t)
    } else if (!subStarted) {
      const t = setTimeout(() => setSubStarted(true), 200)
      return () => clearTimeout(t)
    }
  }, [headlineIdx, subStarted])

  useEffect(() => {
    if (!subStarted) return
    if (subIdx < SUBLINE.length) {
      const t = setTimeout(() => setSubIdx(i => i + 1), 38)
      return () => clearTimeout(t)
    }
  }, [subStarted, subIdx])

  // Render headline with 팀 in yellow
  function renderHeadline(text: string) {
    const parts = text.split('팀')
    return parts.map((part, i) => (
      <span key={i}>
        {part}
        {i < parts.length - 1 && (
          <span className="login-panel-headline-accent">팀</span>
        )}
      </span>
    ))
  }

  // Render subline preserving \n as <br>
  function renderSub(text: string) {
    return text.split('\n').map((line, i, arr) => (
      <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
    ))
  }

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

      {/* ── top-left logo overlay ── */}
      <div className="login-page-logo-wrap">
        <img src="/Yokogawa Logo.png" alt="Yokogawa" className="login-page-logo" />
        <img src="/Yokogawa Logo.png" alt="" className="login-page-logo-yellow" aria-hidden="true" />
      </div>

      {/* ── left branding panel ── */}
      <div className="login-panel" style={{ viewTransitionName: 'login-panel' }}>
        <div className="login-panel-inner">

          <div className="login-panel-headline">
            {renderHeadline(HEADLINE.slice(0, headlineIdx))}
            {headlineIdx < HEADLINE.length && (
              <span className="login-typing-cursor" />
            )}
          </div>

          <div className="login-panel-sub">
            {subStarted && renderSub(SUBLINE.slice(0, subIdx))}
            {subStarted && subIdx < SUBLINE.length && (
              <span className="login-typing-cursor" />
            )}
          </div>

        </div>

        {/* ── animated background text ── */}
        <div className="login-panel-bg-text" aria-hidden="true">
          <div className="login-bg-track login-bg-track--1">
            <span>주간 보고서 작성 및 승인</span>
            <span>주간 보고서 작성 및 승인</span>
            <span>주간 보고서 작성 및 승인</span>
          </div>
          <div className="login-bg-track login-bg-track--2">
            <span>프로젝트 이슈 및 일정 추적</span>
            <span>프로젝트 이슈 및 일정 추적</span>
            <span>프로젝트 이슈 및 일정 추적</span>
          </div>
          <div className="login-bg-track login-bg-track--3">
            <span>주간 변경 분석 및 리포트</span>
            <span>주간 변경 분석 및 리포트</span>
            <span>주간 변경 분석 및 리포트</span>
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
