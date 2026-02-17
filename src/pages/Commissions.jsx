import { useState, useEffect } from 'react';
import { DollarSign, Plus, TrendingUp, X, Building2, Calendar, Percent, FileText, Trash2, Edit2, Send, AlertTriangle } from 'lucide-react';
import { getCommissions, saveCommission, deleteCommission, getDeals, COMMISSION_STATUSES, DEAL_STAGES } from '../store/dataStore';
import './Pages.css';
import './DealPipeline.css';

// Format currency
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

// Commission Form Modal
function CommissionModal({ commission, deals, onClose, onSave, onDelete }) {
  const [formData, setFormData] = useState({
    linkedDealId: '',
    clientName: '',
    landlordBuilding: '',
    squareFootage: '',
    leaseTerm: '',
    annualRent: '',
    commissionRate: '',
    expectedCloseDate: '',
    status: 'projected',
    notes: '',
    ...commission,
  });

  // Calculate commission on the fly
  const sqft = parseFloat(formData.squareFootage) || 0;
  const annualRent = parseFloat(formData.annualRent) || 0;
  const termYears = (parseFloat(formData.leaseTerm) || 0) / 12;
  const rate = (parseFloat(formData.commissionRate) || 0) / 100;
  const calculatedAmount = sqft * annualRent * termYears * rate;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));

    // If linking to a deal, prefill some fields
    if (name === 'linkedDealId' && value) {
      const deal = deals.find(d => d.id === value);
      if (deal) {
        setFormData(prev => ({
          ...prev,
          linkedDealId: value,
          clientName: deal.clientName,
          squareFootage: deal.squareFootage || prev.squareFootage,
        }));
      }
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.clientName.trim()) return;
    onSave(formData);
  };

  const isEdit = !!commission?.id;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? 'Edit Commission' : 'New Commission'}</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            {deals.length > 0 && (
              <div className="form-group full-width">
                <label>Link to Deal (Optional)</label>
                <select name="linkedDealId" value={formData.linkedDealId} onChange={handleChange}>
                  <option value="">-- Select a deal --</option>
                  {deals.map(deal => (
                    <option key={deal.id} value={deal.id}>
                      {deal.clientName} ({DEAL_STAGES.find(s => s.id === deal.stage)?.name})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group">
              <label>Client Name *</label>
              <input
                type="text"
                name="clientName"
                value={formData.clientName}
                onChange={handleChange}
                placeholder="Client/Company"
                required
              />
            </div>

            <div className="form-group">
              <label><Building2 size={14} /> Landlord/Building</label>
              <input
                type="text"
                name="landlordBuilding"
                value={formData.landlordBuilding}
                onChange={handleChange}
                placeholder="Building name"
              />
            </div>

            <div className="form-group">
              <label>Square Footage</label>
              <input
                type="number"
                name="squareFootage"
                value={formData.squareFootage}
                onChange={handleChange}
                placeholder="e.g. 5000"
              />
            </div>

            <div className="form-group">
              <label>Lease Term (months)</label>
              <input
                type="number"
                name="leaseTerm"
                value={formData.leaseTerm}
                onChange={handleChange}
                placeholder="e.g. 60"
              />
            </div>

            <div className="form-group">
              <label><DollarSign size={14} /> Annual Rent ($/SF)</label>
              <input
                type="number"
                name="annualRent"
                value={formData.annualRent}
                onChange={handleChange}
                placeholder="e.g. 75"
              />
            </div>

            <div className="form-group">
              <label><Percent size={14} /> Commission Rate (%)</label>
              <input
                type="number"
                step="0.1"
                name="commissionRate"
                value={formData.commissionRate}
                onChange={handleChange}
                placeholder="e.g. 4"
              />
            </div>

            <div className="form-group">
              <label><Calendar size={14} /> Expected Close Date</label>
              <input
                type="date"
                name="expectedCloseDate"
                value={formData.expectedCloseDate}
                onChange={handleChange}
              />
            </div>

            <div className="form-group">
              <label>Status</label>
              <select name="status" value={formData.status} onChange={handleChange}>
                {COMMISSION_STATUSES.map(status => (
                  <option key={status.id} value={status.id}>{status.name}</option>
                ))}
              </select>
            </div>

            {/* Calculated Commission Display */}
            <div className="form-group full-width">
              <div className="calculated-commission">
                <span className="calc-label">Calculated Commission:</span>
                <span className="calc-value">{formatCurrency(calculatedAmount)}</span>
                <span className="calc-formula">
                  ({sqft.toLocaleString()} SF × ${annualRent}/SF × {termYears.toFixed(1)} years × {(rate * 100).toFixed(1)}%)
                </span>
              </div>
            </div>

            <div className="form-group full-width">
              <label><FileText size={14} /> Notes</label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                placeholder="Additional notes..."
                rows={2}
              />
            </div>
          </div>

          <div className="modal-footer">
            {isEdit && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  if (confirm('Delete this commission entry?')) {
                    onDelete(commission.id);
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
                {isEdit ? 'Save Changes' : 'Add Commission'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Commissions() {
  const [commissions, setCommissions] = useState([]);
  const [deals, setDeals] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingCommission, setEditingCommission] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [commissionsData, dealsData] = await Promise.all([
          getCommissions(),
          getDeals(),
        ]);
        setCommissions(commissionsData);
        setDeals(dealsData);
      } catch (err) {
        console.error('Failed to load commissions:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Calculate stats
  const stats = {
    projected: commissions
      .filter(c => c.status === 'projected')
      .reduce((sum, c) => sum + (c.calculatedAmount || 0), 0),
    inContract: commissions
      .filter(c => c.status === 'in_contract')
      .reduce((sum, c) => sum + (c.calculatedAmount || 0), 0),
    closed: commissions
      .filter(c => c.status === 'closed')
      .reduce((sum, c) => sum + (c.calculatedAmount || 0), 0),
    invoiceSent: commissions
      .filter(c => c.status === 'invoice_sent')
      .reduce((sum, c) => sum + (c.calculatedAmount || 0), 0),
    overdue: commissions
      .filter(c => c.status === 'overdue')
      .reduce((sum, c) => sum + (c.calculatedAmount || 0), 0),
    paid: commissions
      .filter(c => c.status === 'paid')
      .reduce((sum, c) => sum + (c.calculatedAmount || 0), 0),
  };

  const handleSave = async (commissionData) => {
    try {
      await saveCommission(commissionData);
      const updated = await getCommissions();
      setCommissions(updated);
      setShowModal(false);
      setEditingCommission(null);
    } catch (err) {
      console.error('Failed to save commission:', err);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteCommission(id);
      const updated = await getCommissions();
      setCommissions(updated);
      setShowModal(false);
      setEditingCommission(null);
    } catch (err) {
      console.error('Failed to delete commission:', err);
    }
  };

  const filteredCommissions = filterStatus === 'all'
    ? commissions
    : commissions.filter(c => c.status === filterStatus);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#888' }}>Loading...</div>;

  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1>Commission Tracker</h1>
          <p>Track your deal commissions and projected earnings</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
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
            <p className="stat-value">{formatCurrency(stats.projected + stats.inContract)}</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon yellow">
            <DollarSign size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">In Contract</p>
            <p className="stat-value">{formatCurrency(stats.inContract)}</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon green">
            <DollarSign size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Closed (Unpaid)</p>
            <p className="stat-value">{formatCurrency(stats.closed + stats.invoiceSent)}</p>
          </div>
        </div>

        {stats.overdue > 0 && (
          <div className="stat-card">
            <div className="stat-icon" style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: 'var(--status-red)' }}>
              <AlertTriangle size={24} />
            </div>
            <div className="stat-content">
              <p className="stat-label">Overdue</p>
              <p className="stat-value" style={{ color: 'var(--status-red)' }}>{formatCurrency(stats.overdue)}</p>
            </div>
          </div>
        )}

        <div className="stat-card">
          <div className="stat-icon teal">
            <DollarSign size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Paid This Year</p>
            <p className="stat-value">{formatCurrency(stats.paid)}</p>
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="table-toolbar">
        <div className="filter-group">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="all">All Statuses</option>
            {COMMISSION_STATUSES.map(status => (
              <option key={status.id} value={status.id}>{status.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Commission Table */}
      {commissions.length === 0 ? (
        <div className="card">
          <div className="empty-state large">
            <DollarSign size={48} className="empty-icon" />
            <h3>No commissions tracked yet</h3>
            <p>Click "Add Commission" to start tracking your deals</p>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Building</th>
                <th>SF</th>
                <th>Term</th>
                <th>Rate</th>
                <th>Commission</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCommissions.map(commission => (
                <tr key={commission.id}>
                  <td className="primary-cell">{commission.clientName}</td>
                  <td>{commission.landlordBuilding || '-'}</td>
                  <td>{commission.squareFootage ? parseInt(commission.squareFootage).toLocaleString() : '-'}</td>
                  <td>{commission.leaseTerm ? `${commission.leaseTerm} mo` : '-'}</td>
                  <td>{commission.commissionRate ? `${commission.commissionRate}%` : '-'}</td>
                  <td className="amount-cell">{formatCurrency(commission.calculatedAmount)}</td>
                  <td>
                    <span className={`status-badge status-${commission.status}`}>
                      {COMMISSION_STATUSES.find(s => s.id === commission.status)?.name}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="icon-btn"
                        onClick={() => {
                          setEditingCommission(commission);
                          setShowModal(true);
                        }}
                        title="Edit"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        className="icon-btn danger"
                        onClick={() => {
                          if (confirm('Delete this commission?')) {
                            handleDelete(commission.id);
                          }
                        }}
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <CommissionModal
          commission={editingCommission}
          deals={deals}
          onClose={() => {
            setShowModal(false);
            setEditingCommission(null);
          }}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

export default Commissions;
