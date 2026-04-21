import { useEffect, useMemo, useState } from 'react'
import { reportsApi, teamsApi } from '../api'
import { useAuthStore, useAppStore } from '../store'
import { StatusChip, ProgressBar, PageSpinner } from '../components/ui'
import { useReportModal } from '../hooks/useReportModal'
import { weekLabel } from '../hooks/useDates'
import type { ReportSummary, TeamsData } from '../types'

// ── Types ─────────────────────────────────────────────────────────────────
interface TreeNode {
  type: 'dept' | 'team'
  id: number
  name: string
  teamId?: number   // only for type==='team'
  children: TreeNode[]
  depth: number
}

interface TeamMember {
  id: number
  name: string
  rank_name: string
}

// ── Build tree from TeamsData ─────────────────────────────────────────────
function buildTree(data: TeamsData): TreeNode[] {
  const deptNodes: TreeNode[] = data.departments.map((d) => ({
    type: 'dept', id: d.id, name: d.name, children: [], depth: 0,
  }))

  // top-level teams per dept
  const teamsByDept: Record<number, typeof data.teams> = {}
  const teamById: Record<number, typeof data.teams[0]> = {}
  for (const t of data.teams) {
    teamById[t.id] = t
    if (!t.parent_team_id) {
      if (!teamsByDept[t.department_id]) teamsByDept[t.department_id] = []
      teamsByDept[t.department_id].push(t)
    }
  }

  function buildTeamNode(team: typeof data.teams[0], depth: number): TreeNode {
    const children = data.teams
      .filter((t) => t.parent_team_id === team.id)
      .map((t) => buildTeamNode(t, depth + 1))
    return { type: 'team', id: team.id, teamId: team.id, name: team.name, children, depth }
  }

  for (const dNode of deptNodes) {
    dNode.children = (teamsByDept[dNode.id] ?? []).map((t) => buildTeamNode(t, 1))
  }

  return deptNodes.filter((d) => d.children.length > 0)
}

// Flatten tree for rendering
function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = []
  function walk(node: TreeNode) {
    result.push(node)
    node.children.forEach(walk)
  }
  nodes.forEach(walk)
  return result
}

// Collect all teamIds under a node (including itself if team)
function collectTeamIds(node: TreeNode, allNodes: TreeNode[]): number[] {
  const ids: number[] = []
  function walk(n: TreeNode) {
    if (n.type === 'team' && n.teamId) ids.push(n.teamId)
    n.children.forEach(walk)
  }
  walk(node)
  return ids
}

// ── Status constants ──────────────────────────────────────────────────────
const STATUS = { DRAFT: 1, SUBMITTED: 2, APPROVED: 3, REJECTED: 4 }

export default function TeamReports() {
  const [teamsData, setTeamsData]   = useState<TeamsData | null>(null)
  const [reports, setReports]       = useState<ReportSummary[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loading, setLoading]       = useState(true)
  const [activeWeek, setActiveWeek] = useState('')
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null)
  const [statusFilter, setStatusFilter] = useState<number | null>(null)

  const { user } = useAuthStore()
  const { lookups } = useAppStore()

  const { openReport, modals, setApproveId } = useReportModal({ onApproved: reload })

  async function reload() {
    if (!selectedNode) return
    const teamIds = collectTeamIds(selectedNode, [])
    // If it's a dept node or a team with sub-teams, use the first team's id
    // The backend handles recursion; use the top-level team if dept selected
    if (teamIds.length === 0) return

    // For dept nodes: fetch reports for each top-level team (backend handles sub-teams per team)
    // Simplest: fetch by each teamId and merge (since backend does recursion per team_id)
    // But since dept has multiple teams, fetch without team_id and filter client-side by memberIds
    const [rRes, mRes] = await Promise.all([
      reportsApi.list({ week_start: activeWeek || undefined }),
      selectedNode.type === 'team'
        ? teamsApi.getMembersRecursive(selectedNode.id)
        : Promise.resolve({ data: [] as TeamMember[] }),
    ])

    setReports(rRes.data)
    setTeamMembers(mRes.data)
  }

  async function init() {
    setLoading(true)
    const [tdRes, rRes] = await Promise.all([
      teamsApi.list(),
      reportsApi.list(),
    ])
    setTeamsData(tdRes.data)
    setReports(rRes.data)

    // Pick the first week
    const weeks = [...new Set(rRes.data.map((r) => r.week_start))].sort().reverse()
    if (weeks.length) setActiveWeek(weeks[0])
    setLoading(false)
  }

  useEffect(() => { init() }, [])

  // Auto-select current user's primary team when tree loads
  useEffect(() => {
    if (!teamsData || !user) return
    // find the team where the current user is a member
    const myTeam = teamsData.teams.find((t) =>
      t.members.some((m) => m.user_id === user.id)
    )
    if (myTeam) {
      const flat = flattenTree(buildTree(teamsData))
      const node = flat.find((n) => n.type === 'team' && n.teamId === myTeam.id)
      if (node) {
        setSelectedNode(node)
        teamsApi.getMembersRecursive(myTeam.id).then((r) => setTeamMembers(r.data))
      }
    }
  }, [teamsData, user])

  // Reload reports when week or selected node changes
  useEffect(() => {
    if (!activeWeek || !teamsData) return
    reportsApi.list({ week_start: activeWeek }).then((r) => setReports(r.data))
  }, [activeWeek])

  useEffect(() => {
    if (!selectedNode) return
    if (selectedNode.type === 'team') {
      teamsApi.getMembersRecursive(selectedNode.id).then((r) => setTeamMembers(r.data))
    } else {
      // dept: collect all member ids from all teams in dept
      const deptTeams = teamsData?.teams.filter((t) => t.department_id === selectedNode.id) ?? []
      const memberMap = new Map<number, TeamMember>()
      for (const t of deptTeams) {
        for (const m of t.members) {
          if (!memberMap.has(m.user_id)) {
            memberMap.set(m.user_id, { id: m.user_id, name: m.name, rank_name: m.rank_name })
          }
        }
      }
      setTeamMembers(Array.from(memberMap.values()))
    }
  }, [selectedNode])

  if (loading) return <PageSpinner />

  const tree = teamsData ? buildTree(teamsData) : []
  const flatTree = flattenTree(tree)
  const weeks = [...new Set(reports.map((r) => r.week_start))].sort().reverse().slice(0, 8)

  // Determine which user IDs are in scope
  const scopedMemberIds = new Set(teamMembers.map((m) => m.id))

  // Filter reports to scope + week
  const weekReports = reports.filter(
    (r) => r.week_start === activeWeek && (scopedMemberIds.size === 0 || scopedMemberIds.has(r.owner_id))
  )

  // Apply status filter
  const filteredReports = statusFilter
    ? weekReports.filter((r) => r.status_id === statusFilter)
    : weekReports

  // Who hasn't submitted (any report at all for the week)
  const submittedIds = new Set(weekReports.map((r) => r.owner_id))
  const missingMembers = teamMembers.filter((m) => !submittedIds.has(m.id))

  // Stats
  const submitted  = weekReports.filter((r) => r.status_id === STATUS.SUBMITTED).length
  const approved   = weekReports.filter((r) => r.status_id === STATUS.APPROVED).length
  const rejected   = weekReports.filter((r) => r.status_id === STATUS.REJECTED).length
  const missing    = missingMembers.length
  const total      = teamMembers.length || weekReports.length

  const scopeLabel = selectedNode?.name ?? '전체'

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

      {/* ── Team Tree Sidebar ── */}
      <div className="card" style={{ width: 220, flexShrink: 0, padding: '12px 0', position: 'sticky', top: 20 }}>
        <div style={{ padding: '0 14px 10px', fontWeight: 600, fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          팀 선택
        </div>
        {flatTree.map((node) => {
          const isSelected = selectedNode?.type === node.type && selectedNode?.id === node.id
          const isDept = node.type === 'dept'
          return (
            <button
              key={`${node.type}-${node.id}`}
              onClick={() => setSelectedNode(node)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: `6px ${14 + node.depth * 14}px`,
                background: isSelected ? 'var(--accent-subtle, #eff6ff)' : 'none',
                border: 'none', cursor: 'pointer',
                borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
                fontWeight: isDept ? 600 : isSelected ? 500 : 400,
                fontSize: isDept ? 11 : 13,
                color: isDept ? 'var(--text-muted)' : isSelected ? 'var(--accent)' : 'var(--text)',
                textTransform: isDept ? 'uppercase' : 'none',
                letterSpacing: isDept ? '0.04em' : 'normal',
              }}
            >
              {!isDept && <span style={{ marginRight: 6, opacity: 0.4 }}>{'└'.repeat(Math.max(0, node.depth - 1))}{'─'}</span>}
              {node.name}
            </button>
          )
        })}
        {flatTree.length === 0 && (
          <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text-muted)' }}>팀 없음</div>
        )}
      </div>

      {/* ── Main Content ── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="page-header">
          <div>
            <div className="page-title">팀 보고서</div>
            {selectedNode && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{scopeLabel}</div>
            )}
          </div>
        </div>

        {/* ── Stats bar ── */}
        {selectedNode && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <StatChip label="전체" value={total} color="var(--text-muted)" />
            <StatChip label="제출" value={submitted} color="#3b82f6" />
            <StatChip label="승인" value={approved} color="#22c55e" />
            {rejected > 0 && <StatChip label="반려" value={rejected} color="#f97316" />}
            {missing > 0 && <StatChip label="미제출" value={missing} color="#e53e3e" />}
          </div>
        )}

        {/* ── Week tabs ── */}
        <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
          {weeks.map((w) => (
            <button
              key={w}
              className={`tab ${activeWeek === w ? 'active' : ''}`}
              onClick={() => setActiveWeek(w)}
              role="tab"
              aria-selected={activeWeek === w}
            >
              {weekLabel(w)}
            </button>
          ))}
        </div>

        {/* ── Status filter pills ── */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {[null, STATUS.SUBMITTED, STATUS.APPROVED, STATUS.REJECTED].map((s) => (
            <button
              key={s ?? 'all'}
              onClick={() => setStatusFilter(s)}
              style={{
                padding: '3px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                border: '1px solid var(--border)',
                background: statusFilter === s ? 'var(--accent)' : 'var(--bg-card)',
                color: statusFilter === s ? '#fff' : 'var(--text)',
                fontWeight: statusFilter === s ? 600 : 400,
              }}
            >
              {s === null ? '전체' : s === STATUS.SUBMITTED ? '제출' : s === STATUS.APPROVED ? '승인' : '반려'}
            </button>
          ))}
        </div>

        {/* ── Table ── */}
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap" style={{ border: 'none', borderRadius: 'var(--radius)' }}>
            <table>
              <thead>
                <tr>
                  <th className="col-name">팀원</th>
                  <th className="col-status">상태</th>
                  <th>프로젝트</th>
                  <th>완료율</th>
                  <th>위험</th>
                  <th>차단</th>
                  <th className="col-action">작업</th>
                </tr>
              </thead>
              <tbody>
                {/* Submitted reports */}
                {filteredReports.length === 0 && missingMembers.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty-state">
                        <div className="empty-icon">
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                            <circle cx="9" cy="7" r="4"/>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                          </svg>
                        </div>
                        <div className="empty-title">이번 주 보고서가 없습니다</div>
                        <div className="empty-body">
                          {selectedNode ? `${scopeLabel} 팀원들이 보고서를 제출하면 여기에 표시됩니다.` : '팀을 선택하거나 팀원들이 보고서를 제출하면 여기에 표시됩니다.'}
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <>
                    {filteredReports.map((r) => (
                      <tr
                        key={r.id}
                        className="clickable"
                        onClick={() => openReport(r.id)}
                        tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && openReport(r.id)}
                      >
                        <td className="fw-500">{r.owner_name}</td>
                        <td><StatusChip statusId={r.status_id} /></td>
                        <td>{r.total_projects}</td>
                        <td><ProgressBar value={r.avg_completion ?? 0} /></td>
                        <td>{(r.risk_count ?? 0) > 0 ? <span className="chip chip-risk">{r.risk_count}</span> : '—'}</td>
                        <td>{(r.blocker_count ?? 0) > 0 ? <span className="chip chip-blocker">{r.blocker_count}</span> : '—'}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {(r.status_id === STATUS.SUBMITTED || r.status_id === STATUS.REJECTED) && user?.is_admin === 1 && (
                            <button className="btn btn-primary btn-sm" onClick={() => setApproveId(r.id)}>검토</button>
                          )}
                        </td>
                      </tr>
                    ))}

                    {/* Missing members — only shown when no status filter or filter is clear */}
                    {!statusFilter && missingMembers.map((m) => (
                      <tr key={`missing-${m.id}`} style={{ opacity: 0.45 }}>
                        <td className="fw-500">
                          <span style={{ marginRight: 8 }}>{m.name}</span>
                          <span style={{ fontSize: 11, color: '#e53e3e', fontWeight: 500 }}>미제출</span>
                        </td>
                        <td><span className="chip chip-draft">초안</span></td>
                        <td>—</td>
                        <td><ProgressBar value={0} /></td>
                        <td>—</td>
                        <td>—</td>
                        <td />
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {modals}
    </div>
  )
}

// ── StatChip ─────────────────────────────────────────────────────────────────
function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '6px 14px', borderRadius: 20,
      background: 'var(--bg-card)', border: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 18, fontWeight: 700, color }}>{value}</span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
    </div>
  )
}
