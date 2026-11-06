import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Activity,
  Bell,
  ChevronDown,
  CircleCheck,
  Cpu,
  Orbit,
  Menu,
  TrainFront,
  X,
} from 'lucide-react'

const navigation = [
  { label: 'Quantum Algorithm', to: '/quantum-algorithm', icon: Orbit },
  { label: 'Classic Algorithm', to: '/classic-algorithm', icon: Cpu },
]

export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const location = useLocation()
  const isQuantum = location.pathname !== '/classic-algorithm'
  const algorithmName = isQuantum ? 'Quantum Algorithm' : 'Classic Algorithm'

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
              onClick={() => setSidebarOpen(false)}
            >
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
              {location.pathname === to && <span className="nav-live-dot" />}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-section-label network-label">ALGORITHM STATUS</div>
        <div className="network-health">
          <CircleCheck size={14} className="sidebar-plan-icon" />
          <span>{algorithmName}</span>
          <span className="health-status">SIM</span>
        </div>
        <div className="sidebar-bottom">
          <div className="help-link"><Activity size={16} /> Route evaluation <span>↗</span></div>
          <div className="user-card">
            <div className="avatar">QR</div>
            <div className="user-meta"><strong>Railway Planner</strong><span>Network design</span></div>
            <ChevronDown size={15} className="user-chevron" />
          </div>
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
            <div className="topbar-popover-wrap">
              <button className="icon-button notification-button" aria-label="Notifications" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}>
                <Bell size={17} /><span className="notification-dot" />
              </button>
              {notificationsOpen && <div className="notification-popover" role="status"><strong>{algorithmName}</strong><span>Routes are selected automatically during evaluation.</span><small>Construction budget: 7 units.</small></div>}
            </div>
            <Link to="/login" className="topbar-avatar" aria-label="Open sign in page">MB</Link>
          </div>
        </header>
        <main className="page-content"><Outlet /></main>
      </div>
    </div>
  )
}
