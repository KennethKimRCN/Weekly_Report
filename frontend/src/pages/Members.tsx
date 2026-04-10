import { useEffect, useState } from 'react'
import { usersApi } from '../api'
import { useAuthStore, useAppStore } from '../store'
import { PageSpinner } from '../components/ui'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { fmtTime } from '../hooks/useDates'
import { avatarColor, avatarInitials } from '../utils/avatar'
import type { User } from '../types'

export default function Members() {
  const [users, setUsers]     = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<User | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const { user: me } = useAuthStore()
  const { lookups } = useAppStore()
  const { toast } = useToast()

  async function load() { const res = await usersApi.list(); setUsers(res.data); setLoading(false) }
  useEffect(() => { load() }, [])

  async function save() {
    if (!editing) return
    try {
      await usersApi.update(editing.id, {
        name: editing.name, email: editing.email, employee_id: editing.employee_id,
        rank_id: editing.rank_id, manager_id: editing.manager_id ?? null,
        phone: editing.phone ?? null, locale: editing.locale,
        is_admin: editing.is_admin, new_password: newPassword || null,
      })
      toast('저장되었습니다', 'success')
      setEditing(null); setNewPassword(''); load()
    } catch (e: any) { toast(e.response?.data?.detail ?? '오류', 'error') }
  }

  if (loading) return <PageSpinner />

  const ranks    = lookups?.ranks ?? []
  const managers = users.filter((u) => editing ? u.id !== editing.id : true)

  return (
    <div>
      <div className="page-header">
        <div className="page-title">팀원</div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap" style={{ border: 'none', borderRadius: 'var(--radius)' }}>
          <table>
            <thead>
              <tr>
                <th className="col-name">이름</th>
                <th>직급</th>
                <th>이메일</th>
                <th>부서</th>
                <th>관리자</th>
                <th className="col-date">최근 로그인</th>
                {me?.is_admin === 1 && <th className="col-action">작업</th>}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="flex items-center gap-8">
                      <div className={`avatar avatar-sm ${avatarColor(u.id)}`} style={{ flexShrink: 0 }}>
                        {avatarInitials(u.name)}
                      </div>
                      <div>
                        <div className="fw-500" style={{ fontSize: 13 }}>{u.name}</div>
                        {u.is_admin === 1 && <span className="chip chip-submitted" style={{ fontSize: 10, padding: '1px 6px', marginTop: 2 }}>관리자</span>}
                      </div>
                    </div>
                  </td>
                  <td>{u.rank_name}</td>
                  <td className="text-sm text-muted">{u.email}</td>
                  <td>{u.department_name ?? '—'}</td>
                  <td>{u.manager_name ?? '—'}</td>
                  <td className="text-sm text-muted col-date">{fmtTime(u.last_login_at)}</td>
                  {me?.is_admin === 1 && (
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(u); setNewPassword('') }}>편집</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <Modal
          title={`${editing.name} 편집`}
          onClose={() => { setEditing(null); setNewPassword('') }}
          footer={
            <div className="flex gap-6">
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>취소</button>
              <button className="btn btn-primary" onClick={save}>저장</button>
            </div>
          }
        >
          <div className="form-row">
            <div className="form-group">
              <label>이름 *</label>
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>사번</label>
              <input value={editing.employee_id} onChange={(e) => setEditing({ ...editing, employee_id: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label>이메일 *</label>
            <input type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>직급</label>
              <select value={editing.rank_id} onChange={(e) => setEditing({ ...editing, rank_id: Number(e.target.value) })}>
                {ranks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>직속 상관</label>
              <select value={editing.manager_id ?? ''} onChange={(e) => setEditing({ ...editing, manager_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">없음</option>
                {managers.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.rank_name})</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>전화번호</label>
              <input value={editing.phone ?? ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
            </div>
            <div className="form-group">
              <label>언어</label>
              <select value={editing.locale} onChange={(e) => setEditing({ ...editing, locale: e.target.value as 'ko' | 'en' })}>
                <option value="ko">한국어</option><option value="en">English</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>관리자 권한</label>
            <select value={editing.is_admin} onChange={(e) => setEditing({ ...editing, is_admin: Number(e.target.value) })}>
              <option value={0}>일반 사용자</option><option value={1}>관리자</option>
            </select>
          </div>
          <div className="divider" />
          <div className="form-group">
            <label>새 비밀번호 <span className="field-hint">(변경 시에만 입력)</span></label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="변경하지 않으면 빈칸" />
          </div>
        </Modal>
      )}
    </div>
  )
}
