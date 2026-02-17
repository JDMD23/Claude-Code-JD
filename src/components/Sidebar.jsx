import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Kanban,
  Users,
  Database,
  FileText,
  DollarSign,
  Settings,
  ChevronLeft,
  ChevronRight,
  Building2,
  Settings
} from 'lucide-react';
import { useState } from 'react';
import './Sidebar.css';

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/pipeline', icon: Kanban, label: 'Deal Pipeline' },
  { path: '/prospects', icon: Users, label: 'Prospects' },
  { path: '/master-list', icon: Database, label: 'Master List' },
  { path: '/lease-intelligence', icon: FileText, label: 'Lease Intelligence' },
  { path: '/commissions', icon: DollarSign, label: 'Commissions' },
  { path: '/settings', icon: Settings, label: 'Settings' },
];

function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="logo">
          <Building2 size={28} strokeWidth={1.5} className="logo-icon" />
          {!collapsed && <span className="logo-text">DealFlow</span>}
        </div>
        <button
          className="collapse-btn"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={18} strokeWidth={1.5} /> : <ChevronLeft size={18} strokeWidth={1.5} />}
        </button>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `nav-item ${isActive ? 'active' : ''}`
            }
          >
            <item.icon size={20} strokeWidth={1.5} className="nav-icon" />
            {!collapsed && <span className="nav-label">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        {!collapsed && (
          <p className="version-text">v1.0.0</p>
        )}
      </div>
    </aside>
  );
}

export default Sidebar;
