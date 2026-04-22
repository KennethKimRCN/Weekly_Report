import axios from 'axios'
import type {
  LoginResponse, User, ReportSummary, ReportFull, ReportProject,
  Project, Notification, DashboardData, LookupData, AnalyticsData,
  SearchResult, ScheduleEntry, Comment, GeneratedReportSummary, LlmStatus, LlmSettings, LlmModelList,
  WeeklyDiff, TeamsData, Team,
} from '../types'

// ── Axios instance ────────────────────────────────────────────────────────
export const http = axios.create({ baseURL: '/api' })

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Single-flight redirect: prevents multiple concurrent 401s from each
// triggering a navigation. Uses client-side navigation via a registered
// navigate function instead of window.location.href (which would hard-reload).
let _redirecting = false
let _navigate: ((path: string) => void) | null = null

export function registerNavigate(fn: (path: string) => void) {
  _navigate = fn
}

http.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !_redirecting) {
      _redirecting = true
      localStorage.removeItem('token')
      if (_navigate) {
        _navigate('/login')
      } else {
        window.location.replace('/login')
      }
      // Reset after a tick so future logins work
      setTimeout(() => { _redirecting = false }, 2000)
    }
    return Promise.reject(err)
  },
)

// ── Auth ──────────────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) => {
    const fd = new FormData()
    fd.append('username', email)
    fd.append('password', password)
    return http.post<LoginResponse>('/auth/token', fd)
  },
  me: () => http.get<User>('/auth/me'),
  changePassword: (current_password: string, new_password: string) =>
    http.post('/users/change-password', { current_password, new_password }),
}

// ── Dashboard ─────────────────────────────────────────────────────────────
export const dashboardApi = {
  get: () => http.get<DashboardData>('/dashboard'),
}

// ── Reports ───────────────────────────────────────────────────────────────
export const reportsApi = {
  list: (params?: { week_start?: string; owner_id?: number; status_id?: number; team_id?: number }) =>
    http.get<ReportSummary[]>('/reports', { params }),

  get: (id: number) => http.get<ReportFull>(`/reports/${id}`),

  upsertProject: (
    reportId: number,
    data: {
      project_id: number
      remarks?: string
      project_status: 'active' | 'on_hold' | 'completed' | 'cancelled'
      project_schedules?: { title: string; start_date: string; end_date?: string | null }[]
      issue_items?: {
        title: string
        status: string
        start_date: string
        end_date?: string | null
        details?: string | null
        issue_progresses?: {
          title: string
          start_date: string
          end_date?: string | null
          details?: string | null
        }[]
      }[]
    },
  ) => http.put<ReportProject>(`/reports/${reportId}/projects`, data),

  removeProject: (reportId: number, projectId: number) =>
    http.delete(`/reports/${reportId}/projects/${projectId}`),

  submit: (id: number) => http.post(`/reports/${id}/submit`),

  approve: (id: number, manager_comment?: string) =>
    http.post(`/reports/${id}/approve`, { manager_comment }),

  reject: (id: number, manager_comment: string) =>
    http.post(`/reports/${id}/reject`, { manager_comment }),

  addComment: (
    reportId: number,
    comment: string,
    parent_comment_id?: number,
  ) => http.post<Comment>(`/reports/${reportId}/comments`, { comment, parent_comment_id }),

  generateSummary: (reportId: number) =>
    http.post<GeneratedReportSummary>(`/llm/reports/${reportId}/summary`),
}

// ── Projects ──────────────────────────────────────────────────────────────
export const projectsApi = {
  list: (params?: { status?: string; q?: string; mine?: boolean }) =>
    http.get<Project[]>('/projects', { params }),

  create: (data: Partial<Project> & { assignee_ids?: number[] }) =>
    http.post<Project>('/projects', data),

  update: (id: number, data: Partial<Project> & { assignee_ids?: number[] }) =>
    http.put<Project>(`/projects/${id}`, data),

  downloadImportTemplate: () =>
    http.get<Blob>('/projects/import/template', { responseType: 'blob' as const }),

  importExcel: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return http.post<ProjectImportSummary>('/projects/import', formData)
  },
}

// ── Schedule ──────────────────────────────────────────────────────────────
export const scheduleApi = {
  list: (params?: { year?: number; month?: number }) =>
    http.get<ScheduleEntry[]>('/schedule', { params }),

  create: (data: Omit<ScheduleEntry, 'id' | 'user_id' | 'type_name'>) =>
    http.post<ScheduleEntry>('/schedule', data),

  update: (id: number, data: Omit<ScheduleEntry, 'id' | 'user_id' | 'type_name'>) =>
    http.put<ScheduleEntry>(`/schedule/${id}`, data),

  delete: (id: number) => http.delete(`/schedule/${id}`),
}

// ── Users ─────────────────────────────────────────────────────────────────
export const usersApi = {
  list: () => http.get<User[]>('/users'),

  create: (data: {
    name: string; email: string; employee_id: string; rank_id: number
    manager_id?: number | null; phone?: string | null; locale: string
    is_admin: number; password: string
  }) => http.post<User>('/users', data),

  update: (
    id: number,
    data: {
      name: string
      email: string
      employee_id: string
      rank_id: number
      manager_id?: number | null
      phone?: string | null
      locale: string
      is_admin: number
      new_password?: string | null
    },
  ) => http.put<User>(`/users/${id}`, data),

  delete: (id: number) => http.delete(`/users/${id}`),
}

// ── Teams ─────────────────────────────────────────────────────────────────
export const teamsApi = {
  list: () => http.get<TeamsData>('/teams'),

  create: (data: { name: string; department_id: number; parent_team_id?: number | null; manager_id?: number | null }) =>
    http.post<Team>('/teams', data),

  update: (id: number, data: { name: string; department_id: number; parent_team_id?: number | null; manager_id?: number | null }) =>
    http.put<Team>(`/teams/${id}`, data),

  delete: (id: number) => http.delete(`/teams/${id}`),

  updateMembers: (id: number, members: { user_id: number; role: string; primary_team: number }[]) =>
    http.put(`/teams/${id}/members`, { members }),

  getMembersRecursive: (id: number) =>
    http.get<{ id: number; name: string; rank_name: string; team_id: number }[]>(`/teams/${id}/members-recursive`),
}

// ── Departments ───────────────────────────────────────────────────────────
export const departmentsApi = {
  create: (data: { name: string; code?: string | null; parent_id?: number | null }) =>
    http.post('/teams/departments', data),
  update: (id: number, data: { name: string; code?: string | null; parent_id?: number | null }) =>
    http.put(`/teams/departments/${id}`, data),
  delete: (id: number) => http.delete(`/teams/departments/${id}`),
}

// ── Notifications ─────────────────────────────────────────────────────────
export const notificationsApi = {
  list: () => http.get<Notification[]>('/notifications'),
  readOne: (id: number) => http.patch(`/notifications/${id}/read`),
  readAll: () => http.post('/notifications/read-all'),
}

// ── Lookups ───────────────────────────────────────────────────────────────
export const lookupsApi = {
  get: () => http.get<LookupData>('/lookups'),
}

// ── Search ────────────────────────────────────────────────────────────────
export const searchApi = {
  query: (q: string) => http.get<SearchResult[]>('/search', { params: { q } }),
}

// ── Project Record ────────────────────────────────────────────────────────
export const projectRecordApi = {
  get: (projectId: number) =>
    http.get<ProjectRecord>(`/projects/${projectId}/record`),

  // Milestones
  addMilestone: (projectId: number, data: MilestoneInput) =>
    http.post<Milestone>(`/projects/${projectId}/milestones`, data),
  updateMilestone: (projectId: number, milestoneId: number, data: MilestoneInput) =>
    http.put<Milestone>(`/projects/${projectId}/milestones/${milestoneId}`, data),
  deleteMilestone: (projectId: number, milestoneId: number) =>
    http.delete(`/projects/${projectId}/milestones/${milestoneId}`),

  // Issues
  addIssue: (projectId: number, data: IssueInput) =>
    http.post<ProjectIssue>(`/projects/${projectId}/issues`, data),
  updateIssue: (projectId: number, issueId: number, data: IssueInput) =>
    http.put<ProjectIssue>(`/projects/${projectId}/issues/${issueId}`, data),
  deleteIssue: (projectId: number, issueId: number) =>
    http.delete(`/projects/${projectId}/issues/${issueId}`),

  // Progress
  addProgress: (projectId: number, issueId: number, data: ProgressInput) =>
    http.post<IssueProgressEntry>(`/projects/${projectId}/issues/${issueId}/progress`, data),
  updateProgress: (projectId: number, issueId: number, progressId: number, data: ProgressInput) =>
    http.put<IssueProgressEntry>(`/projects/${projectId}/issues/${issueId}/progress/${progressId}`, data),
  deleteProgress: (projectId: number, issueId: number, progressId: number) =>
    http.delete(`/projects/${projectId}/issues/${issueId}/progress/${progressId}`),
}

// ── Carry-forward ─────────────────────────────────────────────────────────
export const carryApi = {
  preview: (reportId: number) =>
    http.get<CarryPreview>(`/reports/${reportId}/carry-preview`),
  forward: (reportId: number, data: { project_ids: number[]; carry_open_issues: boolean }) =>
    http.post(`/reports/${reportId}/carry-forward`, data),
  availableIssues: (reportId: number, projectId: number) =>
    http.get<ProjectIssue[]>(`/reports/${reportId}/projects/${projectId}/available-issues`),
}

// ── Types for project record (mirrored in types/index.ts) ─────────────────
export interface MilestoneInput {
  title: string; planned_date: string; actual_date?: string | null; status: string
}
export interface IssueInput {
  title: string; status: string; priority: string
  start_date: string; end_date?: string | null; details?: string | null
}
export interface ProgressInput {
  title: string; start_date: string; end_date?: string | null; details?: string | null
}
export interface Milestone {
  id: number; project_id: number; title: string
  planned_date: string; actual_date: string | null
  status: string; created_at: string
}
export interface ProjectIssue {
  id: number; project_id: number; title: string
  status: string; priority: string
  start_date: string; end_date: string | null; details: string | null
  progresses: IssueProgressEntry[]
  created_by_name?: string; progress_count?: number
}
export interface IssueProgressEntry {
  id: number; issue_id: number; title: string
  start_date: string; end_date: string | null; details: string | null
  author_name?: string; created_at: string
}
export interface ProjectRecord {
  id: number; project_name: string; company: string; location: string
  status: string; wbs_number: string | null
  milestones: Milestone[]
  issues: ProjectIssue[]
  assignees: { id: number; name: string; rank_name: string }[]
}
export interface ProjectImportSummary {
  projects_created: number
  projects_updated: number
  milestones_created: number
  issues_created: number
  progress_created: number
  warnings: string[]
}
export interface CarryPreviewProject {
  project_id: number; project_name: string; company: string
  location: string; project_status: string; already_added: boolean
  open_issues: ProjectIssue[]
}
export interface CarryPreview {
  prev_week: string | null
  projects: CarryPreviewProject[]
}
// ── Analytics ─────────────────────────────────────────────────────────────
export const analyticsApi = {
  overview: (weeks = 8) =>
    http.get<AnalyticsData>('/analytics/team-overview', { params: { weeks } }),
  weeklyDiff: (week?: string) =>
    http.get<WeeklyDiff>('/analytics/weekly-diff', { params: week ? { week } : {} }),
}

export const llmApi = {
  status: () => http.get<LlmStatus>('/llm/status'),
  getSettings: () => http.get<LlmSettings>('/llm/settings'),
  getModels: (params?: { base_url?: string; timeout_seconds?: number }) =>
    http.get<LlmModelList>('/llm/models', { params }),
  updateSettings: (data: { base_url: string; model: string; timeout_seconds: number; system_prompt: string }) =>
    http.put<LlmSettings>('/llm/settings', data),
}
