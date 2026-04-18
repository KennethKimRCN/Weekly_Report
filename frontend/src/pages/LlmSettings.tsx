import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { llmApi } from '../api'
import { useAuthStore } from '../store'
import { PageSpinner } from '../components/ui'
import { useToast } from '../components/ui/Toast'

export default function LlmSettings() {
  const { user } = useAuthStore()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [form, setForm] = useState({
    base_url: '',
    model: '',
    timeout_seconds: 90,
    system_prompt: '',
  })
  const [status, setStatus] = useState<{ available: boolean; error: string | null } | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [settingsRes, statusRes] = await Promise.all([
        llmApi.getSettings(),
        llmApi.status(),
      ])
      const settings = settingsRes.data
      setForm({
        base_url: settings.base_url,
        model: settings.model,
        timeout_seconds: settings.timeout_seconds,
        system_prompt: settings.system_prompt,
      })
      setStatus({
        available: statusRes.data.available,
        error: statusRes.data.error,
      })
      await loadModelsFor(settings.base_url, settings.timeout_seconds, settings.model)
    } catch (e: any) {
      toast(e.response?.data?.detail ?? 'LLM 설정을 불러오지 못했습니다.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user?.is_admin === 1) load()
  }, [user?.is_admin])

  async function loadModelsFor(base_url: string, timeout_seconds: number, currentModel?: string) {
    setLoadingModels(true)
    try {
      const res = await llmApi.getModels({ base_url, timeout_seconds })
      setModels(res.data.models)
      if (res.data.models.length > 0 && currentModel && !res.data.models.includes(currentModel)) {
        setForm((current) => ({ ...current, model: res.data.models[0] }))
      }
    } catch (e: any) {
      setModels(currentModel ? [currentModel] : [])
      throw e
    } finally {
      setLoadingModels(false)
    }
  }

  async function refreshModels() {
    try {
      await loadModelsFor(form.base_url.trim(), Number(form.timeout_seconds), form.model)
      toast('모델 목록을 불러왔습니다.', 'success')
    } catch (e: any) {
      toast(e.response?.data?.detail ?? '모델 목록을 불러오지 못했습니다.', 'error')
    }
  }

  async function save() {
    setSaving(true)
    try {
      const res = await llmApi.updateSettings({
        base_url: form.base_url.trim(),
        model: form.model.trim(),
        timeout_seconds: Number(form.timeout_seconds),
        system_prompt: form.system_prompt,
      })
      setForm({
        base_url: res.data.base_url,
        model: res.data.model,
        timeout_seconds: res.data.timeout_seconds,
        system_prompt: res.data.system_prompt,
      })
      toast('LLM 설정을 저장했습니다.', 'success')
      await checkStatus()
    } catch (e: any) {
      toast(e.response?.data?.detail ?? 'LLM 설정 저장에 실패했습니다.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function checkStatus() {
    setChecking(true)
    try {
      const res = await llmApi.status()
      setStatus({
        available: res.data.available,
        error: res.data.error,
      })
      toast(res.data.available ? 'LLM 연결이 정상입니다.' : 'LLM 오프라인 상태입니다.', res.data.available ? 'success' : 'error')
    } catch (e: any) {
      setStatus({ available: false, error: e.response?.data?.detail ?? 'offline' })
      toast(e.response?.data?.detail ?? '상태 확인에 실패했습니다.', 'error')
    } finally {
      setChecking(false)
    }
  }

  if (user?.is_admin !== 1) return <Navigate to="/" replace />
  if (loading) return <PageSpinner />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="panel-eyebrow">Admin</div>
          <div className="page-title">LLM Settings</div>
          <div className="page-subtitle">LM Studio 연결, 모델 선택, 시스템 프롬프트를 관리자 전용으로 관리합니다.</div>
        </div>
      </div>

      <div className="card" style={{ display: 'grid', gap: 18, maxWidth: 860 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="fw-500" style={{ fontSize: 15 }}>연결 상태</div>
            <div className="text-sm text-muted" style={{ marginTop: 4 }}>
              {status?.available ? 'LLM Live' : 'LLM 오프라인'}
              {status?.error ? ` · ${status.error}` : ''}
            </div>
          </div>
          <button className="btn btn-secondary" onClick={checkStatus} disabled={checking}>
            {checking ? '확인 중...' : '연결 확인'}
          </button>
        </div>

        <div className="form-group">
          <label>Base URL</label>
          <input
            value={form.base_url}
            onChange={(e) => setForm((current) => ({ ...current, base_url: e.target.value }))}
            placeholder="http://127.0.0.1:1234/v1"
          />
        </div>

        <div className="form-group">
          <label>Model</label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <select
              value={form.model}
              onChange={(e) => setForm((current) => ({ ...current, model: e.target.value }))}
              style={{ flex: 1, minWidth: 280 }}
            >
              {!models.includes(form.model) && form.model && (
                <option value={form.model}>{form.model}</option>
              )}
              {models.length === 0 ? (
                <option value={form.model || ''}>{form.model || '모델 목록 없음'}</option>
              ) : (
                models.map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))
              )}
            </select>
            <button className="btn btn-secondary" type="button" onClick={refreshModels} disabled={loadingModels}>
              {loadingModels ? '불러오는 중...' : '모델 새로고침'}
            </button>
          </div>
        </div>

        <div className="form-group">
          <label>Timeout Seconds</label>
          <input
            type="number"
            min={1}
            step={1}
            value={form.timeout_seconds}
            onChange={(e) => setForm((current) => ({ ...current, timeout_seconds: Number(e.target.value) }))}
          />
        </div>

        <div className="form-group">
          <label>System Prompt</label>
          <textarea
            value={form.system_prompt}
            onChange={(e) => setForm((current) => ({ ...current, system_prompt: e.target.value }))}
            rows={10}
            style={{ resize: 'vertical', minHeight: 220 }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={load} disabled={loading || saving}>다시 불러오기</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
