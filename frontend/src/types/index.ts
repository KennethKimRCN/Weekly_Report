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

export interface DashboardScheduleItem {
  id: number
  start_date: string
  end_date: string
  location: string | null
  details: string | null
  type_name: string
}

export interface DashboardIssueUpdate {
  id: number
  progress_title: string
  start_date: string
  updated_at: string
  issue_title: string
  status: string
  priority: string
  project_name: string
  issue_id: number
  project_id: number
}

export interface DashboardTeamMember {
  id: number
  name: string
  report_id: number | null
  status_id: number | null
  status_name: string | null
}

export interface DashboardTeam {
  team_id: number
  team_name: string
  members: DashboardTeamMember[]
}

export interface DashboardData {
  week_start: string
  current_user_id: number
  schedule: DashboardScheduleItem[]
  issue_updates: DashboardIssueUpdate[]
  team_status: DashboardTeam[]
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

// ── Weekly Diff (Analytics) ───────────────────────────────────────────────
export interface DiffField { prev: string | null; cur: string | null }

export interface DiffMilestone {
  id?: number; title: string
  start_date: string | null   // planned_date
  end_date: string | null     // actual_date
  status: string
}
export interface DiffMilestoneChanged {
  title: string; status: string
  start_date: string | null; end_date: string | null
  changes: { status?: DiffField; planned_date?: DiffField; actual_date?: DiffField }
}

export interface DiffIssueProgress {
  id?: number; title: string
  start_date: string; end_date: string | null; details: string | null
}
export interface DiffIssueProgressChanged {
  title: string; start_date: string; end_date: string | null; details: string | null
  changes: { details?: DiffField; start_date?: DiffField; end_date?: DiffField }
}
export interface DiffIssue {
  id?: number; title: string; status: string
  start_date: string; end_date: string | null; details: string | null
  issue_progresses: DiffIssueProgress[]
}
export interface DiffIssueChanged {
  title: string; status: string
  start_date: string | null; end_date: string | null
  changes: {
    status?: DiffField; details?: DiffField
    start_date?: DiffField; end_date?: DiffField
  }
  prog_added: DiffIssueProgress[]
  prog_removed: DiffIssueProgress[]
  prog_changed: DiffIssueProgressChanged[]
}
export interface DiffProject {
  project_id: number; project_name: string; company: string; location: string
  has_diff: boolean
  remarks_diff: DiffField | null
  ms_added: DiffMilestone[]; ms_removed: DiffMilestone[]; ms_changed: DiffMilestoneChanged[]
  issues_added: DiffIssue[]; issues_removed: DiffIssue[]; issues_changed: DiffIssueChanged[]
}
export interface WeeklyDiff {
  current_week: string | null; prev_week: string | null
  projects: DiffProject[]
  available_weeks: string[]
}


// ── Teams ─────────────────────────────────────────────────────────────────
export interface TeamMember {
  user_id: number
  team_id: number
  name: string
  rank_id: number
  rank_name: string
  role: string
  primary_team: number
}

export interface Team {
  id: number
  name: string
  department_id: number
  department_name: string
  parent_team_id: number | null
  parent_team_name: string | null
  manager_id: number | null
  manager_name: string | null
  members: TeamMember[]
}

export interface TeamsData {
  teams: Team[]
  departments: { id: number; name: string; code: string | null; parent_id: number | null }[]
}

export interface SearchResult {
  report_id: number
  source_type: string
  content: string
  week_start: string
  owner_name: string
}
