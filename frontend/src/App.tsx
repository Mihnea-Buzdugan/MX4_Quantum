import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import AuthPage from './pages/AuthPage'
import DashboardPage from './pages/DashboardPage'
import RunHistoryPage from './pages/RunHistoryPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/quantum-algorithm/simulated" replace />} />
        <Route path="quantum-algorithm" element={<Navigate to="/quantum-algorithm/simulated" replace />} />
        <Route path="quantum-algorithm/simulated" element={<DashboardPage key="quantum-simulated" algorithm="quantum-simulated" />} />
        <Route path="quantum-algorithm/real-hardware" element={<DashboardPage key="quantum-hardware" algorithm="quantum-hardware" />} />
        <Route path="classic-algorithm" element={<DashboardPage key="classic" algorithm="classic" />} />
        <Route path="run-history" element={<RunHistoryPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
