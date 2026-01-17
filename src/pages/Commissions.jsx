import { DollarSign, Plus, TrendingUp } from 'lucide-react';
import './Pages.css';

function Commissions() {
  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1>Commission Tracker</h1>
          <p>Track your deal commissions and projected earnings</p>
        </div>
        <button className="btn btn-primary">
          <Plus size={18} />
          Add Commission
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue">
            <TrendingUp size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Projected Pipeline</p>
            <p className="stat-value">$0</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon yellow">
            <DollarSign size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">In Contract</p>
            <p className="stat-value">$0</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon green">
            <DollarSign size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Closed (Unpaid)</p>
            <p className="stat-value">$0</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon teal">
            <DollarSign size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Paid This Year</p>
            <p className="stat-value">$0</p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="empty-state large">
          <DollarSign size={48} className="empty-icon" />
          <h3>No commissions tracked yet</h3>
          <p>Commission entries will appear here as deals progress through your pipeline</p>
          <button className="btn btn-primary" style={{ marginTop: '1rem' }}>
            <Plus size={18} />
            Add Commission Entry
          </button>
        </div>
      </div>
    </div>
  );
}

export default Commissions;
