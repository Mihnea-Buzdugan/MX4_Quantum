import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  Bell,
  CircleCheck,
  Cpu,
  History,
  LogIn,
  LogOut,
  Layers,
  Orbit,
  Menu,
  TrainFront,
  X,
} from 'lucide-react'

import { authFetch, isLoggedIn, logout } from '../utils/auth'

type CurrentUser = { email: string; firstName?: string; lastName?: string; username?: string }

function initials(user: CurrentUser | null) {
  if (!user) return '?'
  const fromName = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.trim()
  return (fromName || user.email.slice(0, 2)).toUpperCase()
}

function displayName(user: CurrentUser | null) {
  if (!user) return 'Signed in'
  const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
  return name || user.username || user.email
}

const navigation = [
  { label: 'Classic Algorithm', to: '/classic-algorithm', icon: Cpu, mode: 'CLASSIC' },
  { label: 'Quantum Algorithm (Simulated)', to: '/quantum-algorithm/simulated', icon: Orbit, mode: 'SIMULATOR' },
  { label: 'Quantum Algorithm (Real Hardware)', to: '/quantum-algorithm/real-hardware', icon: Orbit, mode: 'REAL HARDWARE' },
  { label: 'Batch Simulations', to: '/batch-simulations', icon: Layers, mode: 'BATCH' },
  { label: 'Run History', to: '/run-history', icon: History, mode: 'HISTORY' },
]

export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [simulationSpeed, setSimulationSpeed] = useState<SimulationSpeed>('realtime')
  const [runMetrics, setRunMetrics] = useState<RunMetrics | null>(null)
  const [runHistory, setRunHistory] = useState<RunHistoryRecord[]>([])
  const location = useLocation()
  const navigate = useNavigate()
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loggedIn, setLoggedIn] = useState(isLoggedIn())
  const [loggingOut, setLoggingOut] = useState(false)

  // who is signed in (name / email for the sidebar and the avatar)
  useEffect(() => {
    if (!isLoggedIn()) {
      setLoggedIn(false)
      setUser(null)
      return
    }
    setLoggedIn(true)
    let cancelled = false
    authFetch('/api/user/')
      .then(async (response) => (response.ok ? (await response.json()) as { user?: CurrentUser } : null))
      .then((data) => { if (!cancelled && data?.user) setUser(data.user) })
      .catch(() => { /* offline: keep the session, just no name */ })
    return () => { cancelled = true }
  }, [location.pathname])

  async function handleLogout() {
    setLoggingOut(true)
    await logout() // revokes the refresh token on the server and clears the stored tokens
    setUser(null)
    setLoggedIn(false)
    setRunHistory([])
    setRunMetrics(null)
    setLoggingOut(false)
    navigate('/login', { replace: true })
  }
  // nested pages (e.g. /run-history/batches/3) belong to their section
  const activeWorkspace = navigation.find(({ to }) => location.pathname === to || location.pathname.startsWith(`${to}/`)) ?? navigation[0]
  const algorithmName = activeWorkspace.label
  const appendRunHistory = useCallback((record: RunHistoryRecord) => {
    setRunHistory((history) => [record, ...history])
  }, [])
  const clearRunHistory = useCallback(() => setRunHistory([]), [])

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><TrainFront size={19} strokeWidth={2.2} /></div>
          <div>
            <div className="brand-name">QUANTUM <span>RAIL</span></div>
            <div className="brand-caption">NETWORK INTELLIGENCE</div>
          </div>
          <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            <X size={17} />
          </button>
        </div>

        <div className="sidebar-section-label">WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {navigation.map(({ label, to, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
              onClick={() => {
                setSidebarOpen(false)
                setRunMetrics(null)
              }}
            >
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
              {activeWorkspace.to === to && <span className="nav-live-dot" />}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-section-label network-label">ALGORITHM STATUS</div>
        <div className="network-health">
          <CircleCheck size={14} className="sidebar-plan-icon" />
          <span>{algorithmName}</span>
          <span className="health-status">{activeWorkspace.mode}</span>
        </div>
        <div className="sidebar-bottom">
          <div className="help-link"><Activity size={16} /> Route evaluation <span>↗</span></div>
          {loggedIn ? (
            <div className="user-card">
              <div className="avatar" aria-hidden="true">{initials(user)}</div>
              <div className="user-meta"><strong>{displayName(user)}</strong><span>{user?.email ?? 'Railway Planner'}</span></div>
              <button type="button" className="logout-button" onClick={() => void handleLogout()} disabled={loggingOut} aria-label="Log out" title="Log out">
                <LogOut size={15} />
              </button>
            </div>
          ) : (
            <div className="user-card">
              <div className="avatar" aria-hidden="true">QR</div>
              <div className="user-meta"><strong>Not signed in</strong><span>Runs are not saved</span></div>
              <Link to="/login" className="logout-button" aria-label="Sign in" title="Sign in"><LogIn size={15} /></Link>
            </div>
          )}
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-leading">
            <button className="icon-button menu-button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>
              <Menu size={19} />
            </button>
            <div className="breadcrumb"><span>Workspace</span><i>/</i><strong>{algorithmName}</strong></div>
          </div>
          <div className="topbar-actions">
            <div className="system-status"><span className="health-indicator" /> {algorithmName} ready</div>
            <label className="simulation-speed-control">
              <span>Speed</span>
              <select
                aria-label="Simulation speed"
                value={simulationSpeed}
                onChange={(event) => {
                  setRunMetrics(null)
                  setSimulationSpeed(event.target.value === 'slow' ? 'slow' : 'realtime')
                }}
              >
                <option value="realtime">Realtime</option>
                <option value="slow">x0.5 Speed</option>
              </select>
            </label>
            <div className="speed-comparison" aria-live="polite" aria-label="Simulated and real execution time">
              <span>SIM / REAL</span>
              <strong>{formatDuration(runMetrics?.simulatedMs)} / {formatDuration(runMetrics?.executionMs)}</strong>
            </div>
            <div className="topbar-popover-wrap">
              <button className="icon-button notification-button" aria-label="Notifications" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}>
                <Bell size={17} /><span className="notification-dot" />
              </button>
              {notificationsOpen && <div className="notification-popover" role="status"><strong>{algorithmName}</strong><span>Routes are selected automatically during evaluation.</span><small>Construction budget: 7 units.</small></div>}
            </div>
            {loggedIn ? (
              <>
                <span className="topbar-avatar" title={user?.email ?? ''}>{initials(user)}</span>
                <button type="button" className="button button-secondary topbar-logout" onClick={() => void handleLogout()} disabled={loggingOut}>
                  <LogOut size={14} /> {loggingOut ? 'Logging out…' : 'Log out'}
                </button>
              </>
            ) : (
              <Link to="/login" className="button button-primary topbar-logout"><LogIn size={14} /> Sign in</Link>
            )}
          </div>
        </header>
        <main className="page-content">
          <Outlet context={{ simulationSpeed, setRunMetrics, runHistory, appendRunHistory, clearRunHistory }} />
        </main>
      </div>
    </div>
  )
}

export type SimulationSpeed = 'realtime' | 'slow'
export type RunMetrics = {
  executionMs: number
  simulatedMs: number | null
}
export type RunHistoryRecord = {
  timestamp: number
  algorithm: string
  speed: SimulationSpeed
  executionMs: number
  planStatus: 'valid' | 'invalid'
  totalCost: number
  totalReward: number
  selectedRoutes: string[]
}
export type WorkspaceContext = {
  simulationSpeed: SimulationSpeed
  setRunMetrics: (metrics: RunMetrics | null) => void
  runHistory: RunHistoryRecord[]
  appendRunHistory: (record: RunHistoryRecord) => void
  clearRunHistory: () => void
}

function formatDuration(durationMs: number | null | undefined) {
  if (durationMs === undefined || durationMs === null) return '—'
  return durationMs < 1000 ? `${durationMs.toFixed(1)} ms` : `${(durationMs / 1000).toFixed(1)} s`
}