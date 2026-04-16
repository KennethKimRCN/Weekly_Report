// Deterministic avatar color from user ID
const COLORS = ['avatar-c0','avatar-c1','avatar-c2','avatar-c3','avatar-c4','avatar-c5','avatar-c6','avatar-c7']

export function avatarColor(id: number): string {
  return COLORS[id % COLORS.length]
}

// Two-character initials: first char of each word (up to 2 words)
export function avatarInitials(name: string): string {
  if (!name || name === '?') return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(1, 3)
  return parts[0][0] + parts[1][0]
}

// Page title map for breadcrumb
export const PAGE_TITLES: Record<string, string> = {
  '/':             '대시보드',
  '/my-report':    '내 보고서',
  '/team-reports': '팀 보고서',
  '/calendar':     '일정',
  '/projects':     '프로젝트',
  '/analytics':    '분석',
  '/members':      '팀원',
}
