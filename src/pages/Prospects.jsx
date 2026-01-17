import { Plus, LayoutGrid, List } from 'lucide-react';
import { useState } from 'react';
import './Pages.css';

const stages = [
  'Clients',
  'Meetings to Schedule',
  'Top Prospects',
  'Top Pursuits',
  'Secondary Prospects'
];

function Prospects() {
  const [viewMode, setViewMode] = useState('board');

  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1>Prospects CRM</h1>
          <p>Manage your business development pipeline</p>
        </div>
        <div className="header-actions">
          <div className="view-toggle">
            <button
              className={`toggle-btn ${viewMode === 'board' ? 'active' : ''}`}
              onClick={() => setViewMode('board')}
            >
              <LayoutGrid size={18} />
            </button>
            <button
              className={`toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
            >
              <List size={18} />
            </button>
          </div>
          <button className="btn btn-primary">
            <Plus size={18} />
            Add Prospect
          </button>
        </div>
      </div>

      {viewMode === 'board' ? (
        <div className="kanban-board">
          {stages.map((stage) => (
            <div key={stage} className="kanban-column">
              <div className="kanban-header">
                <h4>{stage}</h4>
                <span className="deal-count">0</span>
              </div>
              <div className="kanban-cards">
                <div className="empty-column">
                  <p>No prospects</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <div className="empty-state">
            <p>No prospects in your CRM yet</p>
            <p className="text-muted">Import companies from the Master List to get started</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default Prospects;
