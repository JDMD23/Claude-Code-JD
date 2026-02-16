import { LayoutDashboard, TrendingUp, Users, DollarSign, Bell } from 'lucide-react';
import './Pages.css';

function Dashboard() {
  return (
    <div className="page fade-in">
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>Welcome back! Here's an overview of your business.</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue">
            <TrendingUp size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Active Deals</p>
            <p className="stat-value">0</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon teal">
            <Users size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Prospects</p>
            <p className="stat-value">0</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon green">
            <DollarSign size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Pipeline Value</p>
            <p className="stat-value">$0</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon yellow">
            <Bell size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Follow-ups Due</p>
            <p className="stat-value">0</p>
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <h3>Today's Priorities</h3>
          <div className="empty-state">
            <p>No follow-ups scheduled for today</p>
          </div>
        </div>

        <div className="card">
          <h3>Recent Activity</h3>
          <div className="empty-state">
            <p>No recent activity to show</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
