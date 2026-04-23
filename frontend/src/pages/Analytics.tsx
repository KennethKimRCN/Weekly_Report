import { useEffect, useState } from 'react'
import { analyticsApi } from '../api'
import { PageSpinner } from '../components/ui'
import { shortDate } from '../hooks/useDates'
import type { WeeklyDiff, DiffProject } from '../types'

// ── tiny helpers ─────────────────────────────────────────────────────────────

function Tag({ type }: { type: 'added' | 'removed' | 'changed' }) {
  const map = {
    added:   { label: '추가', bg: 'var(--green-tint,#e6f4ea)', color: 'var(--green,#2d8a4e)' },
    removed: { label: '삭제', bg: 'var(--red-tint,#fdecea)',   color: 'var(--red,#c0392b)'   },
    changed: { label: '변경', bg: 'var(--blue-tint,#e8f0fe)',  color: 'var(--blue,#1a73e8)'  },
  }
  const { label, bg, color } = map[type]
  return (
    <span style={{
      display: 'inline-block', fontSize: 10, fontWeight: 700, lineHeight: 1,
      padding: '2px 6px', borderRadius: 4, background: bg, color,
    }}>
      {label}
    </span>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
      letterSpacing: '0.06em', color: 'var(--ink-4,#999)',
      marginBottom: 8, marginTop: 16,
    }}>
      {children}
    </div>
  )
}

function DiffRow({ label, prev, cur }: { label?: string; prev: string | null; cur: string | null }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
      {label && <span style={{ fontSize: 11, color: 'var(--ink-4,#999)', fontWeight: 600 }}>{label}</span>}
      {prev && (
        <div style={{
          fontSize: 12, padding: '4px 8px', borderRadius: 4,
          background: 'var(--red-tint,#fdecea)', color: 'var(--red,#c0392b)',
          textDecoration: 'line-through', opacity: 0.8,
        }}>
          {prev}
        </div>
      )}
      {cur && (
        <div style={{
          fontSize: 12, padding: '4px 8px', borderRadius: 4,
          background: 'var(--green-tint,#e6f4ea)', color: 'var(--green,#2d8a4e)',
        }}>
          {cur}
        </div>
      )}
    </div>
  )
}

function DateRange({ start, end }: { start: string | null; end?: string | null }) {
  if (!start) return null
  return (
    <span style={{ fontSize: 11, color: 'var(--ink-4,#999)', marginLeft: 8 }}>
      {shortDate(start)}{end ? ` ~ ${shortDate(end)}` : ''}
    </span>
  )
}

// ── per-project diff card ────────────────────────────────────────────────────

function ProjectDiffCard({ proj }: { proj: DiffProject }) {
  const [open, setOpen] = useState(proj.has_diff)

  const totalChanges =
    (proj.remarks_diff ? 1 : 0) +
    proj.ms_added.length + proj.ms_removed.length + proj.ms_changed.length +
    proj.issues_added.length + proj.issues_removed.length + proj.issues_changed.length

  return (
    <div className="card" style={{ marginBottom: 10, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '12px 16px', background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left', gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {proj.project_name}
          </span>
          <span style={{ fontSize: 12, color: 'var(--ink-4,#999)', whiteSpace: 'nowrap' }}>
            {proj.company}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {totalChanges > 0 ? (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 7px',
              borderRadius: 10, background: 'var(--brand)', color: '#fff',
            }}>
              {totalChanges}
            </span>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--ink-4,#aaa)' }}>변경 없음</span>
          )}
          <span style={{ fontSize: 16, color: 'var(--ink-4,#aaa)', display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>›</span>
        </div>
      </button>

      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border,#eee)' }}>
          {totalChanges === 0 ? (
            <div style={{ color: 'var(--ink-4,#aaa)', fontSize: 13, paddingTop: 12 }}>이번 주 변경 내용 없음</div>
          ) : (
            <>
              {/* ── Remarks ── */}
              {proj.remarks_diff && (
                <>
                  <SectionHeading>비고 (Remarks)</SectionHeading>
                  <DiffRow prev={proj.remarks_diff.prev} cur={proj.remarks_diff.cur} />
                </>
              )}

              {/* ── Milestones ── */}
              {(proj.ms_added.length > 0 || proj.ms_removed.length > 0 || proj.ms_changed.length > 0) && (
                <>
                  <SectionHeading>마일스톤 (Milestones)</SectionHeading>

                  {proj.ms_added.map((m) => (
                    <div key={m.title} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                      <Tag type="added" />
                      <div style={{ fontSize: 13 }}>
                        <span style={{ fontWeight: 500 }}>{m.title}</span>
                        <DateRange start={m.start_date} end={m.end_date} />
                        {m.status && (
                          <span style={{ fontSize: 11, marginLeft: 8, color: 'var(--ink-4,#999)' }}>{m.status}</span>
                        )}
                      </div>
                    </div>
                  ))}

                  {proj.ms_removed.map((m) => (
                    <div key={m.title} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                      <Tag type="removed" />
                      <div style={{ fontSize: 13, textDecoration: 'line-through', opacity: 0.6 }}>
                        <span style={{ fontWeight: 500 }}>{m.title}</span>
                        <DateRange start={m.start_date} end={m.end_date} />
                      </div>
                    </div>
                  ))}

                  {proj.ms_changed.map((m) => (
                    <div key={m.title} style={{ marginBottom: 10, paddingLeft: 8, borderLeft: '2px solid var(--blue,#1a73e8)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <Tag type="changed" />
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{m.title}</span>
                        <DateRange start={m.start_date} end={m.end_date} />
                      </div>
                      {m.changes.status     && <DiffRow label="상태"        prev={m.changes.status.prev}       cur={m.changes.status.cur} />}
                      {m.changes.planned_date && <DiffRow label="계획일"    prev={m.changes.planned_date.prev} cur={m.changes.planned_date.cur} />}
                      {m.changes.actual_date  && <DiffRow label="실제완료일" prev={m.changes.actual_date.prev}  cur={m.changes.actual_date.cur} />}
                    </div>
                  ))}
                </>
              )}

              {/* ── Issues ── */}
              {(proj.issues_added.length > 0 || proj.issues_removed.length > 0 || proj.issues_changed.length > 0) && (
                <>
                  <SectionHeading>이슈 (Issues)</SectionHeading>

                  {proj.issues_added.map((ii) => (
                    <div key={ii.title} style={{ marginBottom: 10, paddingLeft: 8, borderLeft: '2px solid var(--green,#2d8a4e)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <Tag type="added" />
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{ii.title}</span>
                        <span style={{ fontSize: 11, color: 'var(--ink-4,#999)' }}>{ii.status}</span>
                        <DateRange start={ii.start_date} end={ii.end_date} />
                      </div>
                      {ii.details && <div style={{ fontSize: 12, color: 'var(--ink-5,#555)', marginBottom: 4 }}>{ii.details}</div>}
                      {ii.issue_progresses?.map((pg) => (
                        <div key={pg.title} style={{ fontSize: 12, paddingLeft: 12, color: 'var(--ink-5,#555)', marginTop: 2 }}>
                          • {pg.title}<DateRange start={pg.start_date} end={pg.end_date} />
                        </div>
                      ))}
                    </div>
                  ))}

                  {proj.issues_removed.map((ii) => (
                    <div key={ii.title} style={{ marginBottom: 10, paddingLeft: 8, borderLeft: '2px solid var(--red,#c0392b)', opacity: 0.65 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Tag type="removed" />
                        <span style={{ fontWeight: 600, fontSize: 13, textDecoration: 'line-through' }}>{ii.title}</span>
                        <DateRange start={ii.start_date} end={ii.end_date} />
                      </div>
                    </div>
                  ))}

                  {proj.issues_changed.map((ii) => (
                    <div key={ii.title} style={{ marginBottom: 14, paddingLeft: 8, borderLeft: '2px solid var(--blue,#1a73e8)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <Tag type="changed" />
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{ii.title}</span>
                        <span style={{ fontSize: 11, color: 'var(--ink-4,#999)' }}>{ii.status}</span>
                        <DateRange start={ii.start_date} end={ii.end_date} />
                      </div>

                      {/* Field-level changes */}
                      {ii.changes.status     && <DiffRow label="상태"   prev={ii.changes.status.prev}     cur={ii.changes.status.cur} />}
                      {ii.changes.details    && <DiffRow label="내용"   prev={ii.changes.details.prev}    cur={ii.changes.details.cur} />}
                      {ii.changes.start_date && <DiffRow label="시작일" prev={ii.changes.start_date.prev} cur={ii.changes.start_date.cur} />}
                      {ii.changes.end_date   && <DiffRow label="종료일" prev={ii.changes.end_date.prev}   cur={ii.changes.end_date.cur} />}

                      {/* Progress added */}
                      {ii.prog_added.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--ink-4,#999)', fontWeight: 600 }}>진행 추가</span>
                          {ii.prog_added.map((pg) => (
                            <div key={pg.title} style={{
                              fontSize: 12, padding: '3px 8px', marginTop: 3, borderRadius: 4,
                              background: 'var(--green-tint,#e6f4ea)', color: 'var(--green,#2d8a4e)',
                            }}>
                              {pg.title}
                              <DateRange start={pg.start_date} end={pg.end_date} />
                              {pg.details && <span style={{ opacity: 0.8 }}> — {pg.details}</span>}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Progress removed */}
                      {ii.prog_removed.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--ink-4,#999)', fontWeight: 600 }}>진행 삭제</span>
                          {ii.prog_removed.map((pg) => (
                            <div key={pg.title} style={{
                              fontSize: 12, padding: '3px 8px', marginTop: 3, borderRadius: 4,
                              background: 'var(--red-tint,#fdecea)', color: 'var(--red,#c0392b)',
                              textDecoration: 'line-through', opacity: 0.8,
                            }}>
                              {pg.title}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Progress changed */}
                      {ii.prog_changed.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--ink-4,#999)', fontWeight: 600 }}>진행 변경</span>
                          {ii.prog_changed.map((pg) => (
                            <div key={pg.title} style={{
                              marginTop: 4, paddingLeft: 8,
                              borderLeft: '2px solid var(--blue-tint,#c6d9fc)',
                            }}>
                              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 2 }}>
                                {pg.title}
                                <DateRange start={pg.start_date} end={pg.end_date} />
                              </div>
                              {pg.changes.details    && <DiffRow label="내용"   prev={pg.changes.details.prev}    cur={pg.changes.details.cur} />}
                              {pg.changes.start_date && <DiffRow label="시작일" prev={pg.changes.start_date.prev} cur={pg.changes.start_date.cur} />}
                              {pg.changes.end_date   && <DiffRow label="종료일" prev={pg.changes.end_date.prev}   cur={pg.changes.end_date.cur} />}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── page ────────────────────────────────────────────────────────────────────

export default function Analytics() {
  const [data, setData]           = useState<WeeklyDiff | null>(null)
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState<'all' | 'changed'>('changed')
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null)

  const load = (week?: string) => {
    setLoading(true)
    analyticsApi.weeklyDiff(week).then((r) => { setData(r.data); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  const handleWeekChange = (week: string) => {
    setSelectedWeek(week)
    load(week)
  }

  if (loading) return <PageSpinner />
  if (!data)   return null

  const projects     = filter === 'changed' ? data.projects.filter((p) => p.has_diff) : data.projects
  const changedCount = data.projects.filter((p) => p.has_diff).length

  return (
    <div>
      <div className="page-header">
        <div className="page-title">주간 변경 분석</div>
      </div>

      {/* week selector */}
      {data.available_weeks.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-4,#999)', whiteSpace: 'nowrap' }}>조회 주차</span>
          <select
            value={selectedWeek ?? data.available_weeks[0]}
            onChange={(e) => handleWeekChange(e.target.value)}
            style={{
              fontSize: 13, padding: '5px 10px', borderRadius: 6,
              border: '1px solid var(--border,#e0e0e0)',
              background: 'var(--surface,#fff)', color: 'var(--ink-6,#333)',
              cursor: 'pointer',
            }}
          >
            {data.available_weeks.map((w) => (
              <option key={w} value={w}>{shortDate(w)} 주</option>
            ))}
          </select>
          <span style={{ fontSize: 11, color: 'var(--ink-4,#aaa)' }}>← 선택한 주와 직전 주를 비교합니다</span>
        </div>
      )}

      {data.current_week && data.prev_week ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20,
          padding: '10px 16px', borderRadius: 8, background: 'var(--surface-2,#f5f5f5)', fontSize: 13,
        }}>
          <span style={{ color: 'var(--ink-4,#999)' }}>비교 기간</span>
          <span style={{ fontWeight: 500 }}>{shortDate(data.prev_week)} 주</span>
          <span style={{ color: 'var(--ink-4,#bbb)' }}>→</span>
          <span style={{ fontWeight: 600, color: 'var(--brand)' }}>{shortDate(data.current_week)} 주</span>
          <span style={{
            marginLeft: 'auto', fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
            background: changedCount > 0 ? 'var(--brand)' : 'var(--ink-2,#ddd)',
            color: changedCount > 0 ? '#fff' : 'var(--ink-4,#999)',
          }}>
            {changedCount}개 프로젝트 변경
          </span>
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-title">데이터 부족</div>
          <div className="empty-body">비교할 주간 보고서가 2개 이상 필요합니다.</div>
        </div>
      )}

      {data.current_week && (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
            {(['changed', 'all'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                  border: '1px solid var(--border,#e0e0e0)', cursor: 'pointer',
                  background: filter === f ? 'var(--brand)' : 'transparent',
                  color:      filter === f ? '#fff' : 'var(--ink-5,#555)',
                  transition: 'background .12s, color .12s',
                }}
              >
                {f === 'changed' ? `변경된 항목 (${changedCount})` : `전체 프로젝트 (${data.projects.length})`}
              </button>
            ))}
          </div>

          {projects.length === 0 ? (
            <div className="empty-state">
              <div className="empty-title">변경 없음</div>
              <div className="empty-body">이번 주 보고서에 지난 주 대비 변경된 내용이 없습니다.</div>
            </div>
          ) : (
            projects.map((proj) => <ProjectDiffCard key={proj.project_id} proj={proj} />)
          )}
        </>
      )}
    </div>
  )
}
