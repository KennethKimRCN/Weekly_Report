import { useEffect, useState } from 'react'
import { carryApi } from '../../api'
import type { CarryPreview, CarryPreviewProject } from '../../api'
import { Modal } from './Modal'
import { useToast } from './Toast'

interface Props {
  reportId: number
  onDone: () => void
  onClose: () => void
}

export function CarryForwardModal({ reportId, onDone, onClose }: Props) {
  const [preview, setPreview]   = useState<CarryPreview | null>(null)
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [carrying, setCarrying] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    carryApi.preview(reportId).then((res) => {
      setPreview(res.data)
      // Auto-select projects that were on last week but not yet on this week
      const autoSel = new Set<number>()
      res.data.projects.forEach((p) => { if (!p.already_added) autoSel.add(p.project_id) })
      setSelected(autoSel)
    }).catch(() => {
      toast('지난 주 데이터를 불러올 수 없습니다', 'error')
      onClose()
    }).finally(() => setLoading(false))
  }, [reportId])

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function carry() {
    if (selected.size === 0) { toast('프로젝트를 선택해주세요', 'error'); return }
    setCarrying(true)
    try {
      await carryApi.forward(reportId, {
        project_ids: Array.from(selected),
        carry_open_issues: true,
      })
      toast(`${selected.size}개 프로젝트가 추가되었습니다`, 'success')
      onDone()
      onClose()
    } catch (e: any) {
      toast(e.response?.data?.detail ?? '오류', 'error')
    } finally { setCarrying(false) }
  }

  const availableProjects = preview?.projects.filter((p) => !p.already_added) ?? []
  const alreadyAdded      = preview?.projects.filter((p) =>  p.already_added) ?? []
  const selectableIds     = availableProjects.map((p) => p.project_id)
  const allSelected       = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(selectableIds))
  }

  return (
    <Modal
      title="지난 주에서 가져오기"
      onClose={onClose}
      footer={
        <div className="flex gap-6" style={{ alignItems: 'center', width: '100%' }}>
          {preview && (
            <span style={{ fontSize: 12, color: 'var(--ink-4)', marginRight: 'auto' }}>
              {preview.prev_week} 보고서 기준
            </span>
          )}
          <button className="btn btn-primary" onClick={carry} disabled={carrying || selected.size === 0}>
            {carrying ? '추가 중…' : `${selected.size}개 추가`}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>취소</button>
        </div>
      }
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
          <div className="spinner" />
        </div>
      ) : !preview?.prev_week ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ink-4)', fontSize: 13 }}>
          이전 주 보고서가 없습니다.
        </div>
      ) : (
        <div>
          {availableProjects.length === 0 && alreadyAdded.length > 0 && (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--ink-4)', fontSize: 13 }}>
              지난 주 프로젝트가 모두 이번 주에 이미 추가되어 있습니다.
            </div>
          )}

          {availableProjects.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-3)' }}>
                  추가할 프로젝트 선택
                </span>
                <button className="btn btn-ghost btn-sm" onClick={toggleAll}>
                  {allSelected ? '전체 해제' : '전체 선택'}
                </button>
              </div>

              {availableProjects.map((p) => (
                <ProjectPickRow
                  key={p.project_id}
                  project={p}
                  checked={selected.has(p.project_id)}
                  onToggle={() => toggle(p.project_id)}
                />
              ))}
            </>
          )}

          {alreadyAdded.length > 0 && (
            <div style={{ marginTop: 16, borderTop: '1px solid var(--border-2)', paddingTop: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-4)', marginBottom: 8 }}>이미 추가됨</div>
              {alreadyAdded.map((p) => (
                <div key={p.project_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', opacity: .5 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span style={{ fontSize: 13, color: 'var(--ink)' }}>{p.project_name}</span>
                  <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>{p.company}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function ProjectPickRow({
  project, checked, onToggle,
}: {
  project: CarryPreviewProject
  checked: boolean
  onToggle: () => void
}) {
  const openCount = project.open_issues.length

  return (
    <label
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 12px',
        borderRadius: 'var(--radius-sm)', cursor: 'pointer', marginBottom: 4,
        background: checked ? 'var(--blue-light)' : 'transparent',
        border: `1px solid ${checked ? 'var(--blue-mid)' : 'transparent'}`,
        transition: 'background .12s, border-color .12s',
      }}
    >
      <input
        type="checkbox" checked={checked} onChange={onToggle}
        style={{ width: 'auto', marginTop: 2, accentColor: 'var(--blue)' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{project.project_name}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1 }}>
          {project.company} · {project.location}
        </div>
        {openCount > 0 && (
          <div style={{ fontSize: 11, color: 'var(--blue)', marginTop: 3 }}>
            열린 이슈 {openCount}개 포함
          </div>
        )}
      </div>
    </label>
  )
}
