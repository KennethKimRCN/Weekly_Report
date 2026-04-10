import React from 'react'
import type { RiskLevel, ProjectStatus } from '../../types'

// ── Status chips ──────────────────────────────────────────────────────────
const STATUS_LABELS: Record<number, string> = { 1: '초안', 2: '제출', 3: '승인', 4: '반려' }
const STATUS_CLASS:  Record<number, string> = {
  1: 'chip-draft', 2: 'chip-submitted', 3: 'chip-approved', 4: 'chip-rejected',
}
const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: '진행중', on_hold: '보류', completed: '완료', cancelled: '취소',
}

export function StatusChip({ statusId }: { statusId: number }) {
  return (
    <span className={`chip ${STATUS_CLASS[statusId] ?? 'chip-draft'}`}>
      {STATUS_LABELS[statusId] ?? '초안'}
    </span>
  )
}

export function ProjectStatusChip({ status }: { status: ProjectStatus }) {
  return <span className={`chip chip-${status}`}>{PROJECT_STATUS_LABELS[status]}</span>
}

export function RiskChip({ level }: { level: RiskLevel }) {
  const labels: Record<RiskLevel, string> = { normal: '정상', risk: '위험', blocker: '차단' }
  return <span className={`chip chip-${level}`}>{labels[level]}</span>
}

// ── Progress bar ──────────────────────────────────────────────────────────
export function ProgressBar({
  value, riskLevel = 'normal', width = 80,
}: { value: number; riskLevel?: RiskLevel; width?: number }) {
  return (
    <div className="flex items-center gap-6">
      <div className="progress" style={{ width }}>
        <div
          className={`progress-bar${riskLevel !== 'normal' ? ` ${riskLevel}` : ''}`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
      <span className="text-sm text-muted">{value}%</span>
    </div>
  )
}

// ── Bar chart ─────────────────────────────────────────────────────────────
export function BarChart({ data, height = 120 }: {
  data: { label: string; total: number; submitted: number; approved: number }[]
  height?: number
}) {
  if (!data.length) return (
    <div className="empty-state" style={{ padding: '24px 0' }}>
      <div className="empty-body">데이터 없음</div>
    </div>
  )
  const max = Math.max(...data.map((d) => d.total), 1)
  return (
    <div>
      <div className="bar-chart" style={{ height }} role="img" aria-label="제출 현황 바 차트">
        {data.map((d, i) => {
          const hTotal    = Math.round((d.total / max) * height)
          const hApproved = Math.round((d.approved / Math.max(d.total, 1)) * hTotal)
          const hPending  = Math.round(((d.submitted - d.approved) / Math.max(d.total, 1)) * hTotal)
          const hUnsub    = hTotal - hApproved - hPending
          return (
            <div key={i} className="bar-col" title={`${d.label}: 전체 ${d.total}, 제출 ${d.submitted}, 승인 ${d.approved}`}>
              <div className="bar-stack" style={{ height }}>
                {hApproved > 0 && <div className="bar-seg" style={{ height: hApproved, background: 'var(--green)' }} />}
                {hPending  > 0 && <div className="bar-seg" style={{ height: hPending,  background: 'var(--blue)' }} />}
                {hUnsub    > 0 && <div className="bar-seg" style={{ height: hUnsub,    background: '#c5d8fb' }} />}
              </div>
              <div className="bar-lbl">{d.label}</div>
            </div>
          )
        })}
      </div>
      {/* Legend */}
      <div className="flex gap-12 mt-8" style={{ flexWrap: 'wrap' }}>
        {[
          { color: '#c5d8fb',        label: '전체' },
          { color: 'var(--blue)',    label: '제출' },
          { color: 'var(--green)',   label: '승인' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-4">
            <div style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 }} aria-hidden="true" />
            <span className="text-sm text-muted">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────
export function Spinner({ size = 24 }: { size?: number }) {
  return <div className="spinner" style={{ width: size, height: size }} role="status" aria-label="로딩 중" />
}

export function PageSpinner() {
  return <div className="page-spinner"><Spinner size={36} /></div>
}

// ── Table skeleton ────────────────────────────────────────────────────────
export function TableSkeleton({ rows = 4, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div aria-busy="true" aria-label="데이터 로딩 중">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-row">
          {Array.from({ length: cols }).map((_, j) => (
            <div
              key={j}
              className="skeleton skeleton-cell"
              style={{ flex: j === 0 ? 2 : 1, height: 14 }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────
export function EmptyState({ icon, title, subtitle, action }: {
  icon?: React.ReactNode
  title: string
  subtitle?: string
  action?: React.ReactNode
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {subtitle && <div className="empty-body">{subtitle}</div>}
      {action}
    </div>
  )
}
