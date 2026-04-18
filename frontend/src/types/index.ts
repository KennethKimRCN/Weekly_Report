// ── Auth ──────────────────────────────────────────────────────────────────
export interface User {
  id: number
  name: string
  email: string
  employee_id: string
  rank_id: number
  rank_name: string
  manager_id: number | null
  manager_name: string | null
  department_name: string | null
  phone: string | null
  locale: 'ko' | 'en'
  is_admin: number
  is_deleted: number
  last_login_at: string | null
  department?: string | null
}

export interface LoginResponse {
  access_token: string
  token_type: string
  user: { id: number; name: string; email: string; is_admin: number }
}

// ── Reports ───────────────────────────────────────────────────────────────
export type RiskLevel = 'normal' | 'risk' | 'blocker'
export type Visibility = 'private' | 'team' | 'department' | 'company'
export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'cancelled'

export interface ReportSummary {
  id: number
  owner_id: number
  owner_name: string
  week_start: string
  year: number
  week_number: number
  status_id: number
  status_name: string
  visibility: Visibility
  is_locked: number
  manager_comment: string | null
  submitted_at: string | null
  approved_at: string | null
  approved_by: number | null
  total_projects: number
  risk_count: number
  blocker_count: number
  avg_completion: number
}

export interface ReportProject {
  id: number
  report_id: number
  project_id: number
  project_name: string
  solution_product: string | null
  company: string
  location: string
  wbs_number: string | null
  remarks: string | null
  project_status: ProjectStatus
  updated_at: string
  project_schedules: ProjectScheduleItem[]
  issue_items: IssueItem[]
}

export interface ProjectScheduleItem {
  id: number
  report_project_id: number
  title: string
  start_date: string
  end_date: string | null
  status?: string
  created_at: string
  updated_at: string
}

export interface IssueItem {
  id: number
  report_project_id: number
  title: string
  status: string
  priority?: string
  start_date: string
  end_date: string | null
  details: string | null
  created_at: string
  updated_at: string
  issue_progresses: IssueProgress[]
  full_issue_progresses?: IssueProgress[]
}

export interface IssueProgress {
  id: number
  issue_item_id: number
  title: string
  start_date: string
  end_date: string | null
  details: string | null
  author_name?: string
  created_at: string
  updated_at: string
}

export interface Comment {
  id: number
  report_id: number
  user_id: number
  user_name: string
  parent_comment_id: number | null
  comment: string
  is_deleted: number
  created_at: string
  updated_at: string
}

export interface ScheduleEntry {
  id: number
  user_id: number
  type_id: number
  type_name: string
  start_date: string
  end_date: string
  location: string | null
  details: string | null
}

export interface ReportFull extends ReportSummary {
  projects: ReportProject[]
  comments: Comment[]
  week_schedule: ScheduleEntry[]
}

export interface GeneratedReportSummary {
  summary: string
  highlights: string[]
  source: 'llm' | 'fallback'
  model: string | null
  previous_week_start: string | null
}

export interface LlmStatus {
  available: boolean
  model: string | null
  base_url: string
  error: string | null
}

export interface LlmSettings {
  id: number
  base_url: string
  model: string
  timeout_seconds: number
  system_prompt: string
  updated_at: string | null
  updated_by: number | null
}

export interface LlmModelList {
  models: string[]
}

// ── Projects ──────────────────────────────────────────────────────────────
export interface Assignee {
  id: number
  name: string
  rank_name: string
}

export interface Project {
  id: number
  project_name: string
  wbs_number: string | null
  solution_product: string | null
  company: string
  location: string
  status: ProjectStatus
  start_date: string | null
  end_date: string | null
  dept_name: string | null
  assignees: Assignee[]
  open_issue_count?: number
}

// ── Notifications ─────────────────────────────────────────────────────────
export interface Notification {
  id: number
  user_id: number
  type: string
  title: string
  message: string | null
  reference_type: string | null
  reference_id: number | null
  is_read: number
  is_deleted: number
  created_at: string
}

// ── Dashboard ─────────────────────────────────────────────────────────────
export interface SubmissionStat {
  week_start: string
  total: number
  submitted: number
  approved: number
}

export interface DashboardData {
  week_start: string
  my_report: ReportSummary | null
  team_reports: ReportSummary[]
  pending_approvals: { id: number; week_start: string; owner_name: string; status_name: string }[]
  blockers: { project_name: string; remarks: string | null; reporter: string; week_start: string }[]
  unread_notifications: number
  submission_stats: SubmissionStat[]
}

// ── Lookups ───────────────────────────────────────────────────────────────
export interface Lookup {
  id: number
  name: string
  sort_order?: number
}

export interface LookupData {
  ranks: Lookup[]
  report_status: Lookup[]
  schedule_types: Lookup[]
  tags: Lookup[]
  departments: (Lookup & { code: string | null })[]
  users_simple: { id: number; name: string; rank_id: number; rank_name?: string }[]
}

// ── Analytics ─────────────────────────────────────────────────────────────
export interface WeeklyAnalytics {
  week_start: string
  total_reports: number
  submitted: number
  approved: number
  total_risks: number
  total_blockers: number
  avg_completion: number
}

export interface AnalyticsData {
  weekly: WeeklyAnalytics[]
  risk_trend: { week_start: string; risk_level: RiskLevel; count: number }[]
  top_projects: {
    project_name: string
    company: string
    report_count: number
    avg_completion: number
    blocker_count: number
  }[]
}

// ── Search ────────────────────────────────────────────────────────────────
export interface SearchResult {
  report_id: number
  source_type: string
  content: string
  week_start: string
  owner_name: string
}
