import { Plus, Kanban } from 'lucide-react';
import './Pages.css';

const stages = [
  'Kick-off / Market Analysis',
  'Space Touring',
  'LOI',
  'Lease Negotiation',
  'Consent',
  'Closed'
];

function DealPipeline() {
  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1>Deal Pipeline</h1>
          <p>Track your deals from kick-off to close</p>
        </div>
        <button className="btn btn-primary">
          <Plus size={18} />
          Add Deal
        </button>
      </div>

      <div className="kanban-board">
        {stages.map((stage) => (
          <div key={stage} className="kanban-column">
            <div className="kanban-header">
              <h4>{stage}</h4>
              <span className="deal-count">0</span>
            </div>
            <div className="kanban-cards">
              <div className="empty-column">
                <p>No deals</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default DealPipeline;
