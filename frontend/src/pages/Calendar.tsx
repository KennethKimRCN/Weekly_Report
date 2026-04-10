import { useEffect, useState, useMemo } from 'react'
import { scheduleApi } from '../api'
import { useAppStore } from '../store'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { toISO } from '../hooks/useDates'
import type { ScheduleEntry } from '../types'

const TYPE_COLORS = [
  { bg: '#fce8e6', fg: '#c5221f' },
  { bg: '#e6f4ea', fg: '#137333' },
  { bg: '#fef7e0', fg: '#7a5100' },
  { bg: '#e8f0fe', fg: '#1a73e8' },
  { bg: '#f3e8fd', fg: '#681da8' },
]

export default function Calendar() {
  const { lookups } = useAppStore()
  const [year, setYear]   = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [schedules, setSchedules] = useState<ScheduleEntry[]>([])
  const [editing, setEditing] = useState<Partial<ScheduleEntry> | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { toast } = useToast()

  async function load() { const res = await scheduleApi.list({ year, month }); setSchedules(res.data) }
  useEffect(() => { load() }, [year, month])

  const evMap = useMemo(() => {
    const m: Record<string, ScheduleEntry[]> = {}
    schedules.forEach((s) => {
      const start = new Date(s.start_date + 'T00:00:00')
      const end   = new Date(s.end_date   + 'T00:00:00')
      for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = toISO(d);
        (m[key] = m[key] ?? []).push(s)
      }
    })
    return m
  }, [schedules])

  const firstDow    = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const todayISO    = toISO(new Date())

  function shiftMonth(dir: 1 | -1) {
    setMonth((m) => {
      const nm = m + dir
      if (nm > 12) { setYear((y) => y + 1); return 1 }
      if (nm < 1)  { setYear((y) => y - 1); return 12 }
      return nm
    })
  }

  function openNew(dateStr?: string) {
    setEditing({ start_date: dateStr ?? todayISO, end_date: dateStr ?? todayISO })
    setConfirmDelete(false)
    setFormOpen(true)
  }

  function openEdit(s: ScheduleEntry) {
    setEditing(s)
    setConfirmDelete(false)
    setFormOpen(true)
  }

  async function save() {
    if (!editing) return
    const body = {
      type_id: editing.type_id!,
      start_date: editing.start_date!,
      end_date: editing.end_date!,
      location: editing.location ?? null,
      details: editing.details ?? null,
    }
    try {
      if (editing.id) await scheduleApi.update(editing.id, body)
      else            await scheduleApi.create(body)
      toast('저장되었습니다', 'success')
      setFormOpen(false); load()
    } catch (e: any) { toast(e.response?.data?.detail ?? '오류', 'error') }
  }

  async function del() {
    if (!editing?.id) return
    await scheduleApi.delete(editing.id)
    toast('삭제되었습니다')
    setFormOpen(false); load()
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-title">일정 관리</div>
        <button className="btn btn-primary" onClick={() => openNew()}>+ 일정 추가</button>
      </div>

      <div className="flex items-center gap-8 mb-20">
        <button className="btn btn-secondary btn-sm" onClick={() => shiftMonth(-1)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span style={{ fontFamily: "'Google Sans', sans-serif", fontSize: 16, fontWeight: 500, minWidth: 100, textAlign: 'center' }}>
          {year}년 {month}월
        </span>
        <button className="btn btn-secondary btn-sm" onClick={() => shiftMonth(1)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => { setYear(new Date().getFullYear()); setMonth(new Date().getMonth() + 1) }}>
          오늘
        </button>
      </div>

      <div className="card mb-24" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="cal-grid">
          {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
            <div key={d} className="cal-dow">{d}</div>
          ))}
          {Array.from({ length: firstDow }, (_, i) => (
            <div key={`e-${i}`} className="cal-cell other-month" />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1
            const iso = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
            const evs = evMap[iso] ?? []
            return (
              <div
                key={iso}
                className={`cal-cell${iso === todayISO ? ' today' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => openNew(iso)}
              >
                <div className="cal-day">{day}</div>
                {evs.slice(0, 3).map((s) => {
                  const c = TYPE_COLORS[(s.type_id - 1) % TYPE_COLORS.length]
                  return (
                    <div
                      key={s.id}
                      className="cal-event"
                      style={{ background: c.bg, color: c.fg }}
                      onClick={(e) => { e.stopPropagation(); openEdit(s) }}
                      title={s.details ?? s.type_name}
                    >
                      {s.type_name}
                    </div>
                  )
                })}
                {evs.length > 3 && <div className="text-xs text-muted">+{evs.length - 3}</div>}
              </div>
            )
          })}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">이번 달 일정 목록</span></div>
        {schedules.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: 'var(--ink-4)' }}>
            등록된 일정이 없습니다
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>유형</th><th>시작</th><th>종료</th><th>위치</th><th>내용</th><th>작업</th></tr>
              </thead>
              <tbody>
                {schedules.map((s) => {
                  const c = TYPE_COLORS[(s.type_id - 1) % TYPE_COLORS.length]
                  return (
                    <tr key={s.id}>
                      <td><span className="chip" style={{ background: c.bg, color: c.fg }}>{s.type_name}</span></td>
                      <td className="text-sm">{s.start_date}</td>
                      <td className="text-sm">{s.end_date}</td>
                      <td>{s.location ?? '—'}</td>
                      <td className="text-sm">{s.details ?? '—'}</td>
                      <td><button className="btn btn-ghost btn-sm" onClick={() => openEdit(s)}>편집</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formOpen && editing && (
        <Modal
          title={editing.id ? '일정 편집' : '일정 추가'}
          onClose={() => setFormOpen(false)}
          footer={
            <div className="flex gap-6">
              {editing.id && !confirmDelete && (
                <button className="btn btn-danger btn-sm" style={{ marginRight: 'auto' }} onClick={() => setConfirmDelete(true)}>삭제</button>
              )}
              {confirmDelete && (
                <>
                  <span style={{ fontSize: 12, color: 'var(--red)', marginRight: 'auto', alignSelf: 'center' }}>삭제하시겠습니까?</span>
                  <button className="btn btn-danger btn-sm" onClick={del}>확인</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>취소</button>
                </>
              )}
              {!confirmDelete && (
                <>
                  <button className="btn btn-primary" onClick={save}>저장</button>
                  <button className="btn btn-ghost" onClick={() => setFormOpen(false)}>취소</button>
                </>
              )}
            </div>
          }
        >
          <div className="form-group">
            <label>일정 유형 *</label>
            <select value={editing.type_id ?? ''} onChange={(e) => setEditing({ ...editing, type_id: Number(e.target.value) })}>
              <option value="">선택...</option>
              {(lookups?.schedule_types ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>시작일 *</label>
              <input type="date" value={editing.start_date ?? ''} onChange={(e) => setEditing({ ...editing, start_date: e.target.value })} />
            </div>
            <div className="form-group">
              <label>종료일 *</label>
              <input type="date" value={editing.end_date ?? ''} onChange={(e) => setEditing({ ...editing, end_date: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label>위치</label>
            <input value={editing.location ?? ''} onChange={(e) => setEditing({ ...editing, location: e.target.value })} />
          </div>
          <div className="form-group">
            <label>내용</label>
            <textarea rows={3} value={editing.details ?? ''} onChange={(e) => setEditing({ ...editing, details: e.target.value })} />
          </div>
        </Modal>
      )}
    </div>
  )
}
