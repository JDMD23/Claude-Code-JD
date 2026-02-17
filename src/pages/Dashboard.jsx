import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, Users, DollarSign, Bell, CheckCircle, AlertTriangle, Clock } from 'lucide-react';
import { getDashboardStats, completeFollowUp, DEAL_STAGES } from '../store/dataStore';
import './Pages.css';

function formatCurrency(amount) {
  return '$' + Math.round(amount).toLocaleString();
}

function timeAgo(dateStr) {
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadStats = useCallback(async () => {
    try {
      const data = await getDashboardStats();
      setStats(data);
    } catch (err) {
      console.error('Failed to load dashboard stats:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  async function handleComplete(id) {
    try {
      await completeFollowUp(id);
      await loadStats();
    } catch (err) {
      console.error('Failed to complete follow-up:', err);
    }
  }

  if (loading || !stats) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#888' }}>Loading...</div>;

  const followUpsDue = stats.followUps.overdue + stats.followUps.today;
  const priorities = [
    ...stats.followUps.overdueList.map(f => ({ ...f, isOverdue: true })),
    ...stats.followUps.todayList.map(f => ({ ...f, isOverdue: false })),
  ];

  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Welcome back! Here's an overview of your business.</p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue">
            <TrendingUp size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Active Deals</p>
            <p className="stat-value">{stats.deals.total}</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon teal">
            <Users size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Prospects</p>
            <p className="stat-value">{stats.prospects.total}</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon green">
            <DollarSign size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Pipeline Value</p>
            <p className="stat-value">{formatCurrency(stats.commissions.pipeline)}</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon yellow">
            <Bell size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Follow-ups Due</p>
            <p className="stat-value">{followUpsDue}</p>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="dashboard-grid">
        {/* Today's Priorities */}
        <div className="card">
          <h3>Today's Priorities</h3>
          {priorities.length === 0 ? (
            <div className="empty-state">
              <p>No follow-ups due — you're all caught up</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.75rem 0' }}>
              {priorities.map(f => (
                <div key={f.id} style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: '0.625rem 0.75rem',
                  backgroundColor: f.isOverdue ? 'rgba(239,68,68,0.06)' : 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                  borderLeft: f.isOverdue ? '3px solid var(--status-red)' : '3px solid var(--accent-primary)',
                }}>
                  {f.isOverdue
                    ? <AlertTriangle size={16} style={{ color: 'var(--status-red)', flexShrink: 0 }} />
                    : <Clock size={16} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                      {f.companyName || 'Unknown'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {f.contactName ? `${f.contactName} · ` : ''}
                      {f.dueDate ? new Date(f.dueDate).toLocaleDateString() : ''}
                      {f.isOverdue && <span style={{ color: 'var(--status-red)', marginLeft: '0.35rem' }}>Overdue</span>}
                    </div>
                  </div>
                  <button
                    className="icon-btn"
                    title="Mark complete"
                    onClick={() => handleComplete(f.id)}
                  >
                    <CheckCircle size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="card">
          <h3>Recent Activity</h3>
          {stats.recentActivity.length === 0 ? (
            <div className="empty-state">
              <p>No recent activity to show</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', padding: '0.75rem 0' }}>
              {stats.recentActivity.map(a => (
                <div key={a.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  padding: '0.5rem 0',
                  borderBottom: '1px solid var(--border-color)',
                  fontSize: '0.85rem',
                }}>
                  <span style={{ color: 'var(--text-primary)' }}>{a.message}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', whiteSpace: 'nowrap', marginLeft: '1rem' }}>
                    {timeAgo(a.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pipeline by Stage */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3>Pipeline by Stage</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.75rem 0' }}>
          {DEAL_STAGES.map(stage => {
            const count = stats.deals.byStage[stage.id] || 0;
            const maxCount = Math.max(1, ...Object.values(stats.deals.byStage));
            const pct = (count / maxCount) * 100;
            return (
              <div key={stage.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ width: '180px', flexShrink: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {stage.name}
                </span>
                <div style={{ flex: 1, height: '20px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                  {count > 0 && (
                    <div style={{
                      width: `${pct}%`, height: '100%',
                      backgroundColor: 'var(--accent-primary)',
                      borderRadius: 'var(--radius-sm)',
                      transition: 'width 0.3s ease',
                      minWidth: count > 0 ? '24px' : 0,
                    }} />
                  )}
                </div>
                <span style={{ width: '28px', textAlign: 'right', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
