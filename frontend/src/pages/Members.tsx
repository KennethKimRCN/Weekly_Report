import { useEffect, useState } from 'react'
import { usersApi, teamsApi, departmentsApi } from '../api'
import { useAuthStore, useAppStore } from '../store'
import { PageSpinner } from '../components/ui'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { fmtTime } from '../hooks/useDates'
import { avatarColor, avatarInitials } from '../utils/avatar'
import type { User, Team, TeamsData } from '../types'

const blankUser = () => ({
  name: '', email: '', employee_id: '', rank_id: 0,
  manager_id: null as number | null, phone: null as string | null,
  locale: 'ko', is_admin: 0, password: '',
})

const blankTeam = () => ({
  name: '', department_id: 0,
  parent_team_id: null as number | null,
  manager_id: null as number | null,
})

type Tab = 'members' | 'orgchart' | 'teams'

const ROLE_LABEL: Record<string, string> = { lead: '파트리더', member: '팀원', observer: '옵저버' }

export default function Members() {
  const [tab, setTab] = useState<Tab>('members')

  const [users, setUsers]               = useState<User[]>([])
  const [loading, setLoading]           = useState(true)
  const [editing, setEditing]           = useState<User | null>(null)
  const [newPassword, setNewPassword]   = useState('')
  const [adding, setAdding]             = useState(false)
  const [newUser, setNewUser]           = useState(blankUser())
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)

  const [teamsData, setTeamsData]               = useState<TeamsData | null>(null)
  const [teamsLoading, setTeamsLoading]         = useState(true)
  const [editingTeam, setEditingTeam]           = useState<Team | null>(null)
  const [addingTeam, setAddingTeam]             = useState(false)
  const [newTeam, setNewTeam]                   = useState(blankTeam())
  const [deleteTeamTarget, setDeleteTeamTarget] = useState<Team | null>(null)

  // Role-aware member editor: Map<user_id, role>
  const [memberTeam, setMemberTeam]   = useState<Team | null>(null)
  const [memberRoles, setMemberRoles] = useState<Map<number, string>>(new Map())

  const [editingDept, setEditingDept]           = useState<{ id: number; name: string; code: string | null; parent_id: number | null } | null>(null)
  const [addingDept, setAddingDept]             = useState(false)
  const [newDept, setNewDept]                   = useState({ name: '', code: '', parent_id: null as number | null })
  const [deleteDeptTarget, setDeleteDeptTarget] = useState<{ id: number; name: string } | null>(null)

  const { user: me } = useAuthStore()
  const { lookups }  = useAppStore()
  const { toast }    = useToast()

  async function loadUsers() {
    setLoading(true)
    const res = await usersApi.list()
    setUsers(res.data)
    setLoading(false)
  }

  async function loadTeams(silent = false) {
    if (!silent) setTeamsLoading(true)
    const res = await teamsApi.list()
    setTeamsData(res.data)
    setTeamsLoading(false)
  }

  useEffect(() => { loadUsers(); loadTeams() }, [])
  useEffect(() => { if (tab === 'teams' || tab === 'orgchart') loadTeams(true) }, [tab])

  const ranks    = lookups?.ranks ?? []
  const managers = users.filter((u) => editing ? u.id !== editing.id : true)

  // ── user actions ──────────────────────────────────────────────────────────
  async function saveUser() {
    if (!editing) return
    try {
      await usersApi.update(editing.id, {
        name: editing.name, email: editing.email, employee_id: editing.employee_id,
        rank_id: editing.rank_id, manager_id: editing.manager_id ?? null,
        phone: editing.phone ?? null, locale: editing.locale,
        is_admin: editing.is_admin, new_password: newPassword || null,
      })
      toast('저장되었습니다', 'success')
      setEditing(null); setNewPassword(''); loadUsers()
    } catch (e: any) { toast(e.response?.data?.detail ?? '오류', 'error') }
  }

  async function createUser() {
    if (!newUser.name || !newUser.email || !newUser.password) {
      toast('이름, 이메일, 비밀번호는 필수입니다', 'error'); return
    }
    if (!newUser.rank_id) { toast('직급을 선택해 주세요', 'error'); return }
    try {
      await usersApi.create(newUser)
      toast('사용자가 추가되었습니다', 'success')
      setAdding(false); setNewUser(blankUser()); loadUsers()
    } catch (e: any) { toast(e.response?.data?.detail ?? '오류', 'error') }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    try {
      await usersApi.delete(deleteTarget.id)
      toast('사용자가 삭제되었습니다', 'success')
      setDeleteTarget(null); loadUsers()
    } catch (e: any) { toast(e.response?.data?.detail ?? '오류', 'error') }
  }

  // ── team actions ──────────────────────────────────────────────────────────
  async function createTeam() {
    if (!newTeam.name || !newTeam.department_id) {
      toast('팀 이름과 부서는 필수입니다', 'error'); return
    }
    try {
      await teamsApi.create(newTeam)
      toast('팀이 생성되었습니다', 'success')
      setAddingTeam(false); setNewTeam(blankTeam()); loadTeams()
    } catch (e: any) { toast(e.response?.data?.detail ?? '오류', 'error') }
  }

  async function saveTeam() {
    if (!editingTeam) return
    try {
      await teamsApi.update(editingTeam.id, {
        name: editingTeam.name,
        department_id: editingTeam.department_id,
        parent_team_id: editingTeam.parent_team_id,
        manager_id: editingTeam.manager_id,
      })
      toast('저장되었습니다', 'success')
      setEditingTeam(null); loadTeams()
    } catch (e: any) { toast(e.response?.data?.detail ?? '오류', 'error') }
  }

  async function confirmDeleteTeam() {
    if (!deleteTeamTarget) return
    try {
      await teamsApi.delete(deleteTeamTarget.id)
      toast('팀이 삭제되었습니다', 'success')
      setDeleteTeamTarget(null); loadTeams()
    } catch (e: any) { toast(e.response?.data?.detail ?? '오류', 'error') }
  }

  function openMemberEditor(team: Team) {
    setMemberTeam(team)
    const map = new Map<number, string>()
    team.members.forEach((m) => map.set(m.user_id, m.role || 'member'))
    setMemberRoles(map)
  }

  function toggleMember(userId: number) {
    setMemberRoles((prev) => {
      const next = new Map(prev)
      if (next.has(userId)) { next.delete(userId) } else { next.set(userId, 'member') }
      return next
    })
  }

  function setRole(userId: number, role: string) {
    setMemberRoles((prev) => { const next = new Map(prev); next.set(userId, role); return next })
  }

  async function saveTeamMembers() {
    if (!memberTeam) return
    try {
      const members = Array.from(memberRoles.entries()).map(([user_id, role]) => ({
        user_id, role, primary_team: 1,
      }))
      await teamsApi.updateMembers(memberTeam.id, members as any)
      toast('팀원이 업데이트되었습니다', 'success')
      setMemberTeam(null); loadTeams()
    } catch (e: any) { toast(e.response?.data?.detail ?? '오류', 'error') }
  }

  // ── dept actions ──────────────────────────────────────────────────────────
  async function createDept() {
    if (!newDept.name.trim()) { toast('부서 이름은 필수입니다', 'error'); return }
    try {
      await departmentsApi.create({ name: newDept.name.trim(), code: newDept.code || null, parent_id: newDept.parent_id })
      toast('부서가 추가되었습니다', 'success')
      setAddingDept(false); setNewDept({ name: '', code: '', parent_id: null }); loadTeams()
    } catch (e: any) { toast(e.response?.data?.detail ?? '오류', 'error') }
  }

  async function saveDept() {
    if (!editingDept?.name.trim()) { toast('부서 이름은 필수입니다', 'error'); return }
    try {
      await departmentsApi.update(editingDept.id, { name: editingDept.name.trim(), code: editingDept.code, parent_id: editingDept.parent_id })
      toast('저장되었습니다', 'success')
      setEditingDept(null); loadTeams()
    } catch (e: any) { toast(e.response?.data?.detail ?? '오류', 'error') }
  }

  async function confirmDeleteDept() {
    if (!deleteDeptTarget) return
    try {
      await departmentsApi.delete(deleteDeptTarget.id)
      toast('부서가 삭제되었습니다', 'success')
      setDeleteDeptTarget(null); loadTeams()
    } catch (e: any) { toast(e.response?.data?.detail ?? '오류', 'error') }
  }

  if (loading || teamsLoading) return <PageSpinner />

  const depts    = teamsData?.departments ?? lookups?.departments ?? []
  const allTeams = teamsData?.teams ?? []

  const rootTeams   = allTeams.filter((t) => !t.parent_team_id)
  const childrenOf  = (parentId: number) => allTeams.filter((t) => t.parent_team_id === parentId)

  const leadCount = Array.from(memberRoles.values()).filter((r) => r === 'lead').length

  return (
    <div>
      {/* ── Page header ── */}
      <div className="page-header" style={{ alignItems: 'flex-end' }}>
        <div className="page-title">팀 관리</div>
        {me?.is_admin === 1 && (
          <div className="flex gap-6">
            {tab === 'members' && (
              <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>+ 사용자 추가</button>
            )}
            {tab === 'teams' && (
              <>
                <button className="btn btn-primary btn-sm" onClick={() => setAddingTeam(true)}>+ 팀 추가</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setAddingDept(true)}>+ 부서 추가</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-0" style={{ borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        {([['members', '팀원 목록'], ['orgchart', '조직도'], ['teams', '팀 편집']] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 20px', border: 'none', background: 'none', cursor: 'pointer',
            fontWeight: tab === t ? 600 : 400,
            color: tab === t ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: -1, fontSize: 14,
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* ══ TAB: MEMBERS ══ */}
      {tab === 'members' && (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap" style={{ border: 'none', borderRadius: 'var(--radius)' }}>
            <table>
              <thead>
                <tr>
                  <th className="col-name">이름</th>
                  <th>직급</th>
                  <th>이메일</th>
                  <th>소속 PT</th>
                  <th>직속 상관</th>
                  <th className="col-date">최근 로그인</th>
                  {me?.is_admin === 1 && <th className="col-action">작업</th>}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const primaryTeam = allTeams.find((t) =>
                    t.members.some((m) => m.user_id === u.id && m.primary_team)
                  )
                  const membership = primaryTeam?.members.find((m) => m.user_id === u.id)
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="flex items-center gap-8">
                          <div className={`avatar avatar-sm ${avatarColor(u.id)}`} style={{ flexShrink: 0 }}>{avatarInitials(u.name)}</div>
                          <div>
                            <div className="fw-500" style={{ fontSize: 13 }}>{u.name}</div>
                            {u.is_admin === 1 && <span className="chip chip-submitted" style={{ fontSize: 10, padding: '1px 6px', marginTop: 2 }}>관리자</span>}
                          </div>
                        </div>
                      </td>
                      <td>{u.rank_name}</td>
                      <td className="text-sm text-muted">{u.email}</td>
                      <td>
                        {primaryTeam ? (
                          <div className="flex items-center gap-6">
                            <span style={{ fontSize: 13 }}>{primaryTeam.name}</span>
                            {membership?.role && (
                              <span style={{
                                fontSize: 10, padding: '1px 6px', borderRadius: 10, border: '1px solid',
                                ...(membership.role === 'lead'
                                  ? { background: '#ebf4ff', color: '#2b6cb0', borderColor: '#bee3f8' }
                                  : { background: 'var(--bg-subtle,#f5f5f5)', color: 'var(--text-muted)', borderColor: 'var(--border)' }),
                              }}>
                                {ROLE_LABEL[membership.role] ?? membership.role}
                              </span>
                            )}
                          </div>
                        ) : <span className="text-muted">—</span>}
                      </td>
                      <td>{u.manager_name ?? '—'}</td>
                      <td className="text-sm text-muted col-date">{fmtTime(u.last_login_at)}</td>
                      {me?.is_admin === 1 && (
                        <td>
                          <div className="flex gap-4">
                            <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(u); setNewPassword('') }}>편집</button>
                            {u.id !== me?.id && (
                              <button className="btn btn-ghost btn-sm" style={{ color: '#e53e3e' }} onClick={() => setDeleteTarget(u)}>삭제</button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ TAB: ORG CHART ══ */}
      {tab === 'orgchart' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {depts.map((dept) => {
              const deptRoots = rootTeams.filter((t) => t.department_id === dept.id)
              return (
                <div key={dept.id} className="card" style={{ padding: '20px 24px' }}>
                  {/* Dept header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
                    <span className="fw-700" style={{ fontSize: 15 }}>{dept.name}</span>
                    {dept.code && <span className="text-sm text-muted">({dept.code})</span>}
                  </div>
                  {deptRoots.length === 0 && (
                    <span className="text-sm text-muted" style={{ paddingLeft: 18 }}>팀 없음</span>
                  )}
                  {deptRoots.map((rootTeam) => (
                    <OrgTeamNode key={rootTeam.id} team={rootTeam} allTeams={allTeams} depth={0} childrenOf={childrenOf} />
                  ))}
                </div>
              )
            })}
            {allTeams.length === 0 && (
              <div className="text-muted text-sm" style={{ textAlign: 'center', padding: 40 }}>팀이 없습니다.</div>
            )}
          </div>
      )}

      {/* ══ TAB: TEAMS (edit) ══ */}
      {tab === 'teams' && (
          <>
            <div className="card" style={{ padding: '16px 20px', marginBottom: 12 }}>
              <div className="fw-600" style={{ fontSize: 14, marginBottom: 12 }}>부서 목록</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {depts.map((d) => (
                  <div key={d.id} className="flex items-center" style={{ justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <span className="fw-500" style={{ fontSize: 13 }}>{d.name}</span>
                      {d.code && <span className="text-sm text-muted" style={{ marginLeft: 8 }}>({d.code})</span>}
                    </div>
                    {me?.is_admin === 1 && (
                      <div className="flex gap-4">
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditingDept({ id: d.id, name: d.name, code: d.code, parent_id: d.parent_id ?? null })}>편집</button>
                        <button className="btn btn-ghost btn-sm" style={{ color: '#e53e3e' }} onClick={() => setDeleteDeptTarget({ id: d.id, name: d.name })}>삭제</button>
                      </div>
                    )}
                  </div>
                ))}
                {depts.length === 0 && <span className="text-sm text-muted">부서가 없습니다.</span>}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {allTeams.map((team) => (
                <div key={team.id} className="card" style={{ padding: '16px 20px' }}>
                  <div className="flex items-center" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div className="flex items-center gap-8">
                        {team.parent_team_id && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>└</span>}
                        <div className="fw-600" style={{ fontSize: 15 }}>{team.name}</div>
                      </div>
                      <div className="text-sm text-muted" style={{ marginTop: 2 }}>
                        {team.department_name}
                        {team.parent_team_name && <> · 상위: {team.parent_team_name}</>}
                        {team.manager_name && <> · 리더: {team.manager_name}</>}
                      </div>
                      <div className="flex gap-4" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                        {team.members.length === 0
                          ? <span className="text-sm text-muted">팀원 없음</span>
                          : team.members.map((m) => (
                            <span key={m.user_id} style={{
                              fontSize: 11, padding: '2px 8px', borderRadius: 12, border: '1px solid',
                              ...(m.role === 'lead'
                                ? { background: '#ebf4ff', color: '#2b6cb0', borderColor: '#bee3f8', fontWeight: 600 }
                                : { background: 'var(--bg-subtle,#f5f5f5)', color: 'var(--text-muted)', borderColor: 'var(--border)' }),
                            }}>
                              {m.name}
                              <span style={{ opacity: 0.65, marginLeft: 3 }}>
                                {m.role === 'lead' ? '(리더)' : `(${m.rank_name})`}
                              </span>
                            </span>
                          ))
                        }
                      </div>
                    </div>
                    {me?.is_admin === 1 && (
                      <div className="flex gap-4" style={{ flexShrink: 0 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => openMemberEditor(team)}>팀원 편집</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditingTeam({ ...team })}>팀 편집</button>
                        <button className="btn btn-ghost btn-sm" style={{ color: '#e53e3e' }} onClick={() => setDeleteTeamTarget(team)}>삭제</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {allTeams.length === 0 && (
                <div className="text-muted text-sm" style={{ textAlign: 'center', padding: 40 }}>
                  팀이 없습니다. 팀 추가 버튼을 눌러 첫 번째 팀을 만들어 보세요.
                </div>
              )}
            </div>
          </>
      )}

      {/* ══ MODALS ══ */}

      {editing && (
        <Modal title={`${editing.name} 편집`} onClose={() => { setEditing(null); setNewPassword('') }}
          footer={<div className="flex gap-6"><button className="btn btn-ghost" onClick={() => setEditing(null)}>취소</button><button className="btn btn-primary" onClick={saveUser}>저장</button></div>}>
          <UserForm user={editing} onChange={setEditing} ranks={ranks} managers={managers} newPassword={newPassword} onPasswordChange={setNewPassword} />
        </Modal>
      )}

      {adding && (
        <Modal title="사용자 추가" onClose={() => { setAdding(false); setNewUser(blankUser()) }}
          footer={<div className="flex gap-6"><button className="btn btn-ghost" onClick={() => { setAdding(false); setNewUser(blankUser()) }}>취소</button><button className="btn btn-primary" onClick={createUser}>추가</button></div>}>
          <UserForm user={newUser as any} onChange={setNewUser as any} ranks={ranks} managers={users}
            newPassword={newUser.password} onPasswordChange={(v) => setNewUser({ ...newUser, password: v })} isNew />
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="사용자 삭제" onClose={() => setDeleteTarget(null)}
          footer={<div className="flex gap-6"><button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>취소</button><button className="btn btn-primary" style={{ background: '#e53e3e' }} onClick={confirmDelete}>삭제</button></div>}>
          <p style={{ margin: 0 }}><strong>{deleteTarget.name}</strong> ({deleteTarget.email}) 사용자를 삭제하시겠습니까?<br /><span className="text-sm text-muted">이 작업은 되돌릴 수 없습니다.</span></p>
        </Modal>
      )}

      {addingTeam && (
        <Modal title="팀 추가" onClose={() => { setAddingTeam(false); setNewTeam(blankTeam()) }}
          footer={<div className="flex gap-6"><button className="btn btn-ghost" onClick={() => { setAddingTeam(false); setNewTeam(blankTeam()) }}>취소</button><button className="btn btn-primary" onClick={createTeam}>추가</button></div>}>
          <TeamForm team={newTeam} onChange={setNewTeam} departments={depts} teams={allTeams} users={users} />
        </Modal>
      )}

      {editingTeam && (
        <Modal title={`${editingTeam.name} 편집`} onClose={() => setEditingTeam(null)}
          footer={<div className="flex gap-6"><button className="btn btn-ghost" onClick={() => setEditingTeam(null)}>취소</button><button className="btn btn-primary" onClick={saveTeam}>저장</button></div>}>
          <TeamForm team={editingTeam} onChange={setEditingTeam as any}
            departments={depts} teams={allTeams.filter((t) => t.id !== editingTeam.id)} users={users} />
        </Modal>
      )}

      {deleteTeamTarget && (
        <Modal title="팀 삭제" onClose={() => setDeleteTeamTarget(null)}
          footer={<div className="flex gap-6"><button className="btn btn-ghost" onClick={() => setDeleteTeamTarget(null)}>취소</button><button className="btn btn-primary" style={{ background: '#e53e3e' }} onClick={confirmDeleteTeam}>삭제</button></div>}>
          <p style={{ margin: 0 }}><strong>{deleteTeamTarget.name}</strong> 팀을 삭제하시겠습니까?<br /><span className="text-sm text-muted">팀원 배정 정보도 함께 삭제됩니다.</span></p>
        </Modal>
      )}

      {/* Role-aware member editor */}
      {memberTeam && (
        <Modal title={`${memberTeam.name} · 팀원 편집`} onClose={() => setMemberTeam(null)}
          footer={
            <div className="flex gap-6">
              <button className="btn btn-ghost" onClick={() => setMemberTeam(null)}>취소</button>
              <button className="btn btn-primary" onClick={saveTeamMembers}>저장</button>
            </div>
          }>
          <p className="text-sm text-muted" style={{ marginTop: 0, marginBottom: 12 }}>
            체크박스로 팀원을 추가/제거하고 역할을 지정하세요. 리더는 팀당 1명을 권장합니다.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 400, overflowY: 'auto' }}>
            {users.map((u) => {
              const inTeam = memberRoles.has(u.id)
              const role   = memberRoles.get(u.id) ?? 'member'
              return (
                <div key={u.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 8px', borderRadius: 6,
                  background: inTeam ? 'var(--bg-subtle,#f9f9f9)' : 'transparent',
                  border: inTeam ? '1px solid var(--border)' : '1px solid transparent',
                  transition: 'background 0.15s',
                }}>
                  <input type="checkbox" checked={inTeam} onChange={() => toggleMember(u.id)} style={{ flexShrink: 0 }} />
                  <div className={`avatar avatar-sm ${avatarColor(u.id)}`} style={{ flexShrink: 0 }}>{avatarInitials(u.name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{u.name}</div>
                    <div className="text-sm text-muted">{u.rank_name}</div>
                  </div>
                  {inTeam && (
                    <select value={role} onChange={(e) => setRole(u.id, e.target.value)} style={{
                      fontSize: 12, padding: '3px 6px', borderRadius: 6,
                      border: '1px solid var(--border)', background: 'var(--bg)',
                      color: role === 'lead' ? '#2b6cb0' : 'inherit',
                      fontWeight: role === 'lead' ? 600 : 400,
                      cursor: 'pointer',
                    }}>
                      <option value="lead">파트리더</option>
                      <option value="member">팀원</option>
                      <option value="observer">옵저버</option>
                    </select>
                  )}
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: 'var(--bg-subtle,#f5f5f5)', fontSize: 12, color: 'var(--text-muted)' }}>
            선택된 팀원 {memberRoles.size}명
            {leadCount > 1 && <span style={{ color: '#e53e3e', marginLeft: 8 }}>⚠ 리더가 {leadCount}명입니다</span>}
            {leadCount === 0 && memberRoles.size > 0 && <span style={{ color: '#d97706', marginLeft: 8 }}>리더가 지정되지 않았습니다</span>}
          </div>
        </Modal>
      )}

      {addingDept && (
        <Modal title="부서 추가" onClose={() => { setAddingDept(false); setNewDept({ name: '', code: '', parent_id: null }) }}
          footer={<div className="flex gap-6"><button className="btn btn-ghost" onClick={() => { setAddingDept(false); setNewDept({ name: '', code: '', parent_id: null }) }}>취소</button><button className="btn btn-primary" onClick={createDept}>추가</button></div>}>
          <DeptForm dept={newDept} onChange={setNewDept} departments={depts} />
        </Modal>
      )}

      {editingDept && (
        <Modal title={`${editingDept.name} 편집`} onClose={() => setEditingDept(null)}
          footer={<div className="flex gap-6"><button className="btn btn-ghost" onClick={() => setEditingDept(null)}>취소</button><button className="btn btn-primary" onClick={saveDept}>저장</button></div>}>
          <DeptForm
            dept={{ name: editingDept.name, code: editingDept.code ?? '', parent_id: editingDept.parent_id }}
            onChange={(v) => setEditingDept({ ...editingDept, ...v })}
            departments={depts.filter((d) => d.id !== editingDept.id)}
          />
        </Modal>
      )}

      {deleteDeptTarget && (
        <Modal title="부서 삭제" onClose={() => setDeleteDeptTarget(null)}
          footer={<div className="flex gap-6"><button className="btn btn-ghost" onClick={() => setDeleteDeptTarget(null)}>취소</button><button className="btn btn-primary" style={{ background: '#e53e3e' }} onClick={confirmDeleteDept}>삭제</button></div>}>
          <p style={{ margin: 0 }}><strong>{deleteDeptTarget.name}</strong> 부서를 삭제하시겠습니까?<br /><span className="text-sm text-muted">소속 팀이 없을 때만 삭제 가능합니다.</span></p>
        </Modal>
      )}
    </div>
  )
}

// ─── OrgTeamNode ──────────────────────────────────────────────────────────────
interface OrgTeamNodeProps {
  team: Team
  allTeams: Team[]
  depth: number
  childrenOf: (id: number) => Team[]
}
function OrgTeamNode({ team, allTeams, depth, childrenOf }: OrgTeamNodeProps) {
  const leads  = team.members.filter((m) => m.role === 'lead')
  const others = team.members.filter((m) => m.role !== 'lead')
  const children = childrenOf(team.id)

  return (
    <div style={{ marginLeft: depth === 0 ? 0 : 20 }}>
      <div style={{ display: 'flex', gap: 0, alignItems: 'flex-start' }}>
        {depth > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', paddingTop: 16, marginRight: 0, width: 16, flexShrink: 0 }}>
            <div style={{ width: 1, height: 16, background: 'var(--border)', marginLeft: 7 }} />
            <div style={{ width: 16, height: 1, background: 'var(--border)' }} />
          </div>
        )}
        <div style={{
          flex: 1,
          border: '1px solid var(--border)',
          borderRadius: 8,
          marginBottom: 8,
          overflow: 'hidden',
        }}>
          {/* Team header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px',
            background: depth === 0 ? 'var(--bg-subtle,#f5f5f5)' : 'transparent',
            borderBottom: team.members.length > 0 ? '1px solid var(--border)' : 'none',
          }}>
            <div>
              <span className="fw-600" style={{ fontSize: 13 }}>{team.name}</span>
              {leads.length > 0 && (
                <span className="text-sm text-muted" style={{ marginLeft: 8 }}>
                  리더: {leads.map((l) => l.name).join(', ')}
                </span>
              )}
            </div>
            <span className="text-sm text-muted">{team.members.length}명</span>
          </div>
          {/* Members */}
          {team.members.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 14px' }}>
              {[...leads, ...others].map((m) => {
                const isLead = m.role === 'lead'
                return (
                  <div key={m.user_id} style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: isLead ? '5px 10px' : '4px 8px',
                    borderRadius: 20, border: '1px solid', fontSize: 12,
                    ...(isLead
                      ? { background: '#2b6cb0', color: '#fff', borderColor: '#2b6cb0', fontWeight: 600, boxShadow: '0 1px 4px rgba(43,108,176,0.35)' }
                      : { background: 'var(--bg-subtle,#f5f5f5)', color: 'var(--text)', borderColor: 'var(--border)' }),
                  }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%',
                      background: isLead ? 'rgba(255,255,255,0.25)' : '#a0aec0',
                      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 700, flexShrink: 0,
                    }}>
                      {m.name.slice(0, 1)}
                    </div>
                    <span>{m.name}</span>
                    {isLead
                      ? <span style={{ fontSize: 10, background: 'rgba(255,255,255,0.2)', borderRadius: 8, padding: '1px 5px' }}>파트리더</span>
                      : <span style={{ opacity: 0.55, fontSize: 11 }}>{m.rank_name}</span>
                    }
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recurse */}
      {children.map((child) => (
        <OrgTeamNode key={child.id} team={child} allTeams={allTeams} depth={depth + 1} childrenOf={childrenOf} />
      ))}
    </div>
  )
}

// ─── UserForm ─────────────────────────────────────────────────────────────────
interface UserFormProps {
  user: User & { password?: string }
  onChange: (u: any) => void
  ranks: { id: number; name: string }[]
  managers: User[]
  newPassword: string
  onPasswordChange: (v: string) => void
  isNew?: boolean
}
function UserForm({ user, onChange, ranks, managers, newPassword, onPasswordChange, isNew }: UserFormProps) {
  return (
    <>
      <div className="form-row">
        <div className="form-group">
          <label>이름 *</label>
          <input value={user.name} onChange={(e) => onChange({ ...user, name: e.target.value })} />
        </div>
        <div className="form-group">
          <label>사번</label>
          <input value={user.employee_id} onChange={(e) => onChange({ ...user, employee_id: e.target.value })} />
        </div>
      </div>
      <div className="form-group">
        <label>이메일 *</label>
        <input type="email" value={user.email} onChange={(e) => onChange({ ...user, email: e.target.value })} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>직급 *</label>
          <select value={user.rank_id} onChange={(e) => onChange({ ...user, rank_id: Number(e.target.value) })}>
            <option value={0}>{isNew ? '직급 선택' : '선택'}</option>
            {ranks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>직속 상관</label>
          <select value={user.manager_id ?? ''} onChange={(e) => onChange({ ...user, manager_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">없음</option>
            {managers.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.rank_name})</option>)}
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>전화번호</label>
          <input value={user.phone ?? ''} onChange={(e) => onChange({ ...user, phone: e.target.value })} />
        </div>
        <div className="form-group">
          <label>언어</label>
          <select value={user.locale} onChange={(e) => onChange({ ...user, locale: e.target.value })}>
            <option value="ko">한국어</option><option value="en">English</option>
          </select>
        </div>
      </div>
      <div className="form-group">
        <label>관리자 권한</label>
        <select value={user.is_admin} onChange={(e) => onChange({ ...user, is_admin: Number(e.target.value) })}>
          <option value={0}>일반 사용자</option><option value={1}>관리자</option>
        </select>
      </div>
      <div className="divider" />
      <div className="form-group">
        <label>{isNew ? '비밀번호 *' : '새 비밀번호'}{!isNew && <span className="field-hint"> (변경 시에만 입력)</span>}</label>
        <input type="password" value={newPassword} onChange={(e) => onPasswordChange(e.target.value)}
          placeholder={isNew ? '비밀번호 입력' : '변경하지 않으면 빈칸'} />
      </div>
    </>
  )
}

// ─── TeamForm ─────────────────────────────────────────────────────────────────
interface TeamFormProps {
  team: { name: string; department_id: number; parent_team_id: number | null; manager_id: number | null }
  onChange: (t: any) => void
  departments: { id: number; name: string }[]
  teams: Team[]
  users: User[]
}
function TeamForm({ team, onChange, departments, teams, users }: TeamFormProps) {
  return (
    <>
      <div className="form-group">
        <label>팀 이름 *</label>
        <input value={team.name} onChange={(e) => onChange({ ...team, name: e.target.value })} placeholder="팀 이름" />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>부서 *</label>
          <select value={team.department_id || ''} onChange={(e) => onChange({ ...team, department_id: Number(e.target.value) })}>
            <option value="">부서 선택</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>상위 팀</label>
          <select value={team.parent_team_id ?? ''} onChange={(e) => onChange({ ...team, parent_team_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">없음 (최상위 팀)</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>
      <div className="form-group">
        <label>팀장</label>
        <select value={team.manager_id ?? ''} onChange={(e) => onChange({ ...team, manager_id: e.target.value ? Number(e.target.value) : null })}>
          <option value="">없음</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.rank_name})</option>)}
        </select>
      </div>
    </>
  )
}

// ─── DeptForm ─────────────────────────────────────────────────────────────────
interface DeptFormProps {
  dept: { name: string; code: string | null; parent_id: number | null }
  onChange: (d: any) => void
  departments: { id: number; name: string }[]
}
function DeptForm({ dept, onChange, departments }: DeptFormProps) {
  return (
    <>
      <div className="form-row">
        <div className="form-group">
          <label>부서 이름 *</label>
          <input value={dept.name} onChange={(e) => onChange({ ...dept, name: e.target.value })} placeholder="부서 이름" />
        </div>
        <div className="form-group">
          <label>코드 <span className="field-hint">(선택)</span></label>
          <input value={dept.code ?? ''} onChange={(e) => onChange({ ...dept, code: e.target.value })} placeholder="예: SCS" />
        </div>
      </div>
      {departments.length > 0 && (
        <div className="form-group">
          <label>상위 부서 <span className="field-hint">(선택)</span></label>
          <select value={dept.parent_id ?? ''} onChange={(e) => onChange({ ...dept, parent_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">없음 (최상위 부서)</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      )}
    </>
  )
}
