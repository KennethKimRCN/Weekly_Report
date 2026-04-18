import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ToastProvider } from './components/ui/Toast'
import { AppShell } from './components/layout/AppShell'
import Login         from './pages/Login'
import Dashboard     from './pages/Dashboard'
import MyReport      from './pages/MyReport'
import TeamReports   from './pages/TeamReports'
import Calendar      from './pages/Calendar'
import Projects      from './pages/Projects'
import ProjectRecord from './pages/ProjectRecord'
import Analytics     from './pages/Analytics'
import Members       from './pages/Members'
import MyProjects    from './pages/MyProjects'
import LlmSettings   from './pages/LlmSettings'

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<AppShell />}>
            <Route path="/"                        element={<Dashboard />} />
            <Route path="/my-report"               element={<MyReport />} />
            <Route path="/team-reports"            element={<TeamReports />} />
            <Route path="/calendar"                element={<Calendar />} />
            <Route path="/projects"                element={<Projects />} />
            <Route path="/projects/:projectId"     element={<ProjectRecord />} />
            <Route path="/analytics"               element={<Analytics />} />
            <Route path="/members"                 element={<Members />} />
            <Route path="/my-projects"             element={<MyProjects />} />
            <Route path="/admin/llm-settings"      element={<LlmSettings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  )
}
