import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import AuthPage from './pages/AuthPage'
import DashboardPage from './pages/DashboardPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/quantum-algorithm" replace />} />
          <Route path="quantum-algorithm" element={<DashboardPage key="quantum" algorithm="quantum" />} />
          <Route path="classic-algorithm" element={<DashboardPage key="classic" algorithm="classic" />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
