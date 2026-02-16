import { useState, useEffect } from 'react';
import { Plus, X, GripVertical, Calendar, Building2, User, Mail, Phone, DollarSign, FileText } from 'lucide-react';
import { DndContext, DragOverlay, useSensor, useSensors, PointerSensor, useDroppable, rectIntersection } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getDeals, saveDeal, updateDealStage, deleteDeal, DEAL_STAGES } from '../store/dataStore';
import './Pages.css';
import './DealPipeline.css';

// Calculate days in current stage
function getDaysInStage(deal) {
  if (!deal.stageHistory || deal.stageHistory.length === 0) return 0;
  const lastStageChange = deal.stageHistory[deal.stageHistory.length - 1];
  const stageDate = new Date(lastStageChange.date);
  const now = new Date();
  const diffTime = Math.abs(now - stageDate);
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

// Get color based on days in stage
function getStageColor(days) {
  if (days < 14) return 'green';
  if (days <= 30) return 'yellow';
  return 'red';
}

// Sortable Deal Card Component
function DealCard({ deal, onClick }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    data: { type: 'card', stage: deal.stage },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const daysInStage = getDaysInStage(deal);
  const stageColor = getStageColor(daysInStage);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="deal-card"
      onClick={() => onClick(deal)}
    >
      <div className="deal-card-header">
        <div className="drag-handle" {...attributes} {...listeners}>
          <GripVertical size={16} />
        </div>
        <div className={`stage-indicator ${stageColor}`} title={`${daysInStage} days in stage`} />
      </div>

      <h4 className="deal-client">{deal.clientName}</h4>
      {deal.dealNickname && <p className="deal-nickname">{deal.dealNickname}</p>}

      <div className="deal-meta">
        {deal.squareFootage && (
          <span className="meta-item">
            <Building2 size={14} />
            {parseInt(deal.squareFootage).toLocaleString()} SF
          </span>
        )}
        {deal.targetDate && (
          <span className="meta-item">
            <Calendar size={14} />
            {new Date(deal.targetDate).toLocaleDateString()}
          </span>
        )}
      </div>

      <div className="deal-footer">
        <span className="days-badge" style={{ color: `var(--status-${stageColor})` }}>
          {daysInStage} {daysInStage === 1 ? 'day' : 'days'}
        </span>
      </div>
    </div>
  );
}

// Droppable Column wrapper
function DroppableColumn({ id, children }) {
  const { isOver, setNodeRef } = useDroppable({ id, data: { type: 'column' } });

  return (
    <div ref={setNodeRef} className={`kanban-column ${isOver ? 'column-drag-over' : ''}`}>
      {children}
    </div>
  );
}

// Kanban Column Component
function KanbanColumn({ stage, deals, onCardClick }) {
  const stageDeals = deals.filter(d => d.stage === stage.id);

  return (
    <DroppableColumn id={stage.id}>
      <div className="kanban-header">
        <h4>{stage.name}</h4>
        <span className="deal-count">{stageDeals.length}</span>
      </div>

      <SortableContext items={stageDeals.map(d => d.id)} strategy={verticalListSortingStrategy}>
        <div className="kanban-cards">
          {stageDeals.length === 0 ? (
            <div className="empty-column">
              <p>No deals</p>
            </div>
          ) : (
            stageDeals.map(deal => (
              <DealCard key={deal.id} deal={deal} onClick={onCardClick} />
            ))
          )}
        </div>
      </SortableContext>
    </DroppableColumn>
  );
}

// Deal Form Modal
function DealModal({ deal, onClose, onSave, onDelete }) {
  const [formData, setFormData] = useState({
    clientName: '',
    dealNickname: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    squareFootage: '',
    targetBudget: '',
    targetDate: '',
    notes: '',
    stage: 'kickoff',
    ...deal,
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.clientName.trim()) return;
    onSave(formData);
  };

  const isEdit = !!deal?.id;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? 'Edit Deal' : 'New Deal'}</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-group full-width">
              <label>Client/Company Name *</label>
              <input
                type="text"
                name="clientName"
                value={formData.clientName}
                onChange={handleChange}
                placeholder="Enter client name"
                required
              />
            </div>

            <div className="form-group">
              <label>Deal Nickname</label>
              <input
                type="text"
                name="dealNickname"
                value={formData.dealNickname}
                onChange={handleChange}
                placeholder="Optional nickname"
              />
            </div>

            <div className="form-group">
              <label>Stage</label>
              <select name="stage" value={formData.stage} onChange={handleChange}>
                {DEAL_STAGES.map(stage => (
                  <option key={stage.id} value={stage.id}>{stage.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label><User size={14} /> Contact Name</label>
              <input
                type="text"
                name="contactName"
                value={formData.contactName}
                onChange={handleChange}
                placeholder="Primary contact"
              />
            </div>

            <div className="form-group">
              <label><Mail size={14} /> Contact Email</label>
              <input
                type="email"
                name="contactEmail"
                value={formData.contactEmail}
                onChange={handleChange}
                placeholder="email@company.com"
              />
            </div>

            <div className="form-group">
              <label><Phone size={14} /> Contact Phone</label>
              <input
                type="tel"
                name="contactPhone"
                value={formData.contactPhone}
                onChange={handleChange}
                placeholder="(555) 555-5555"
              />
            </div>

            <div className="form-group">
              <label><Building2 size={14} /> Square Footage</label>
              <input
                type="number"
                name="squareFootage"
                value={formData.squareFootage}
                onChange={handleChange}
                placeholder="e.g. 5000"
              />
            </div>

            <div className="form-group">
              <label><DollarSign size={14} /> Target Budget ($/SF)</label>
              <input
                type="number"
                name="targetBudget"
                value={formData.targetBudget}
                onChange={handleChange}
                placeholder="e.g. 75"
              />
            </div>

            <div className="form-group">
              <label><Calendar size={14} /> Target Completion Date</label>
              <input
                type="date"
                name="targetDate"
                value={formData.targetDate}
                onChange={handleChange}
              />
            </div>

            <div className="form-group full-width">
              <label><FileText size={14} /> Notes</label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                placeholder="Additional notes about this deal..."
                rows={3}
              />
            </div>
          </div>

          <div className="modal-footer">
            {isEdit && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  if (confirm('Are you sure you want to delete this deal?')) {
                    onDelete(deal.id);
                  }
                }}
              >
                Delete
              </button>
            )}
            <div className="footer-right">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                {isEdit ? 'Save Changes' : 'Create Deal'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// Main Deal Pipeline Component
function DealPipeline() {
  const [deals, setDeals] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingDeal, setEditingDeal] = useState(null);
  const [activeId, setActiveId] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  useEffect(() => {
    setDeals(getDeals());
  }, []);

  const handleDragStart = (event) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    // Determine target stage
    let newStage = null;

    // Check if dropped directly on a column (droppable)
    const stageMatch = DEAL_STAGES.find(s => s.id === overId);
    if (stageMatch) {
      newStage = stageMatch.id;
    } else {
      // Dropped on a card — find which stage that card belongs to
      const overDeal = deals.find(d => d.id === overId);
      if (overDeal) {
        newStage = overDeal.stage;
      }
    }

    if (newStage) {
      const activeDeal = deals.find(d => d.id === activeId);
      if (activeDeal && activeDeal.stage !== newStage) {
        const updated = updateDealStage(activeId, newStage);
        setDeals(updated);
      }
    }
  };

  const handleSaveDeal = (dealData) => {
    const updated = saveDeal(dealData);
    setDeals(updated);
    setShowModal(false);
    setEditingDeal(null);
  };

  const handleDeleteDeal = (dealId) => {
    const updated = deleteDeal(dealId);
    setDeals(updated);
    setShowModal(false);
    setEditingDeal(null);
  };

  const handleCardClick = (deal) => {
    setEditingDeal(deal);
    setShowModal(true);
  };

  const openNewDealModal = () => {
    setEditingDeal(null);
    setShowModal(true);
  };

  const activeDeal = deals.find(d => d.id === activeId);

  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1>Deal Pipeline</h1>
          <p>Track your deals from kick-off to close</p>
        </div>
        <button className="btn btn-primary" onClick={openNewDealModal}>
          <Plus size={18} />
          Add Deal
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={rectIntersection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="kanban-board">
          {DEAL_STAGES.map(stage => (
            <KanbanColumn
              key={stage.id}
              stage={stage}
              deals={deals}
              onCardClick={handleCardClick}
            />
          ))}
        </div>

        <DragOverlay>
          {activeDeal ? (
            <div className="deal-card dragging">
              <h4 className="deal-client">{activeDeal.clientName}</h4>
              {activeDeal.dealNickname && <p className="deal-nickname">{activeDeal.dealNickname}</p>}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {showModal && (
        <DealModal
          deal={editingDeal}
          onClose={() => {
            setShowModal(false);
            setEditingDeal(null);
          }}
          onSave={handleSaveDeal}
          onDelete={handleDeleteDeal}
        />
      )}
    </div>
  );
}

export default DealPipeline;
