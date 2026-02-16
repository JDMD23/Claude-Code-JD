import { useState, useEffect } from 'react';
import { TrendingUp, Users, DollarSign, Bell, Kanban, Clock, ArrowRight, Activity, AlertTriangle, CheckCircle2, Building2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getDashboardStats, DEAL_STAGES } from '../store/dataStore';
import './Pages.css';
import './Dashboard.css';

function formatCurrency(amount) {
  if (!amount) return '$0';
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}K`;
  return `$${amount.toLocaleString()}`;
}

function timeAgo(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'yesterday';
  return `${diffDays}d ago`;
}

function getActivityIcon(type) {
  switch (type) {
    case 'deal_created': return <Kanban size={14} strokeWidth={1.5} />;
    case 'deal_moved': return <ArrowRight size={14} strokeWidth={1.5} />;
    case 'prospect_added': return <Users size={14} strokeWidth={1.5} />;
    case 'prospect_moved': return <ArrowRight size={14} strokeWidth={1.5} />;
    case 'commission_added': return <DollarSign size={14} strokeWidth={1.5} />;
    case 'companies_imported': return <Building2 size={14} strokeWidth={1.5} />;
    case 'followup_completed': return <CheckCircle2 size={14} strokeWidth={1.5} />;
    default: return <Activity size={14} strokeWidth={1.5} />;
  }
}

function Dashboard() {
  const [stats, setStats] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    setStats(getDashboardStats());
  }, []);

  if (!stats) return null;

  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Your deal pipeline at a glance</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card" onClick={() => navigate('/pipeline')} style={{ cursor: 'pointer' }}>
          <div className="stat-icon blue">
            <TrendingUp size={24} strokeWidth={1.5} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Active Deals</p>
            <p className="stat-value">{stats.deals.total}</p>
          </div>
        </div>

        <div className="stat-card" onClick={() => navigate('/prospects')} style={{ cursor: 'pointer' }}>
          <div className="stat-icon teal">
            <Users size={24} strokeWidth={1.5} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Prospects</p>
            <p className="stat-value">{stats.prospects.total}</p>
          </div>
        </div>

        <div className="stat-card" onClick={() => navigate('/commissions')} style={{ cursor: 'pointer' }}>
          <div className="stat-icon green">
            <DollarSign size={24} strokeWidth={1.5} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Pipeline Value</p>
            <p className="stat-value">{formatCurrency(stats.commissions.pipeline)}</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon yellow">
            <Bell size={24} strokeWidth={1.5} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Follow-ups Due</p>
            <p className="stat-value">{stats.followUps.overdue + stats.followUps.today}</p>
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        {/* Pipeline Snapshot */}
        <div className="card dash-card">
          <div className="dash-card-header">
            <h3>Pipeline Snapshot</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => navigate('/pipeline')}>
              View All <ArrowRight size={14} strokeWidth={1.5} />
            </button>
          </div>
          {stats.deals.total === 0 ? (
            <div className="empty-state">
              <p>No deals yet. Add your first deal in the Pipeline.</p>
            </div>
          ) : (
            <div className="pipeline-snapshot">
              {DEAL_STAGES.map(stage => {
                const count = stats.deals.byStage[stage.id] || 0;
                const pct = stats.deals.total > 0 ? (count / stats.deals.total) * 100 : 0;
                return (
                  <div key={stage.id} className="pipeline-row">
                    <span className="pipeline-stage-name">{stage.name}</span>
                    <div className="pipeline-bar-track">
                      <div className="pipeline-bar-fill" style={{ width: `${Math.max(pct, count > 0 ? 8 : 0)}%` }} />
                    </div>
                    <span className="pipeline-count mono">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Commission Summary */}
        <div className="card dash-card">
          <div className="dash-card-header">
            <h3>Commissions</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => navigate('/commissions')}>
              View All <ArrowRight size={14} strokeWidth={1.5} />
            </button>
          </div>
          <div className="commission-summary">
            <div className="commission-row">
              <span className="commission-label">Projected</span>
              <span className="commission-amount mono">{formatCurrency(stats.commissions.projected)}</span>
            </div>
            <div className="commission-row">
              <span className="commission-label">Closed</span>
              <span className="commission-amount mono">{formatCurrency(stats.commissions.closed)}</span>
            </div>
            <div className="commission-row highlight">
              <span className="commission-label">Paid</span>
              <span className="commission-amount mono">{formatCurrency(stats.commissions.paid)}</span>
            </div>
          </div>
        </div>

        {/* Follow-ups */}
        <div className="card dash-card">
          <div className="dash-card-header">
            <h3>Follow-ups</h3>
          </div>
          {stats.followUps.overdue === 0 && stats.followUps.today === 0 && stats.followUps.thisWeek === 0 ? (
            <div className="empty-state">
              <p>No follow-ups scheduled</p>
            </div>
          ) : (
            <div className="followup-summary">
              {stats.followUps.overdue > 0 && (
                <div className="followup-group overdue">
                  <div className="followup-group-header">
                    <AlertTriangle size={14} strokeWidth={1.5} />
                    <span>Overdue</span>
                    <span className="followup-count">{stats.followUps.overdue}</span>
                  </div>
                  {stats.followUps.overdueList.map(f => (
                    <div key={f.id} className="followup-item">
                      <span>{f.companyName || 'Unnamed'}</span>
                      <span className="text-muted">{f.note?.slice(0, 40)}</span>
                    </div>
                  ))}
                </div>
              )}
              {stats.followUps.today > 0 && (
                <div className="followup-group today">
                  <div className="followup-group-header">
                    <Clock size={14} strokeWidth={1.5} />
                    <span>Today</span>
                    <span className="followup-count">{stats.followUps.today}</span>
                  </div>
                  {stats.followUps.todayList.map(f => (
                    <div key={f.id} className="followup-item">
                      <span>{f.companyName || 'Unnamed'}</span>
                      <span className="text-muted">{f.note?.slice(0, 40)}</span>
                    </div>
                  ))}
                </div>
              )}
              {stats.followUps.thisWeek > 0 && (
                <div className="followup-group">
                  <div className="followup-group-header">
                    <Clock size={14} strokeWidth={1.5} />
                    <span>This Week</span>
                    <span className="followup-count">{stats.followUps.thisWeek}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="card dash-card">
          <div className="dash-card-header">
            <h3>Recent Activity</h3>
          </div>
          {stats.recentActivity.length === 0 ? (
            <div className="empty-state">
              <p>No activity yet. Start by adding deals or importing companies.</p>
            </div>
          ) : (
            <div className="activity-feed">
              {stats.recentActivity.map(item => (
                <div key={item.id} className="activity-item">
                  <div className="activity-icon">
                    {getActivityIcon(item.type)}
                  </div>
                  <div className="activity-content">
                    <span className="activity-message">{item.message}</span>
                    <span className="activity-time">{timeAgo(item.timestamp)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
