import { useState, useRef, useEffect } from 'react';
import { Save, Download, Upload, Key, Shield, Zap, Wifi, WifiOff } from 'lucide-react';
import { getSettings, saveSettings } from '../store/dataStore';
import './Pages.css';

const EXPORT_KEYS = [
  'dealflow_deals',
  'dealflow_prospects',
  'dealflow_master_list',
  'dealflow_commissions',
  'dealflow_contacts',
  'dealflow_followups',
  'dealflow_activity',
];

function Settings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [connStatus, setConnStatus] = useState(null); // null | 'testing' | 'ok' | 'error'
  const [connDetail, setConnDetail] = useState('');
  const importRef = useRef(null);

  useEffect(() => {
    async function loadData() {
      try {
        const data = await getSettings();
        setSettings(data);
      } catch (err) {
        console.error('Failed to load settings:', err);
        setSettings({
          proxyUrl: '',
          proxySecret: '',
          perplexityApiKey: '',
          apolloApiKey: '',
          exaApiKey: '',
          firecrawlApiKey: '',
          autoEnrich: false,
        });
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const testConnection = async () => {
    if (!settings.proxyUrl) {
      setConnStatus('error');
      setConnDetail('No Proxy URL entered.');
      return;
    }
    setConnStatus('testing');
    setConnDetail('');
    try {
      const url = settings.proxyUrl.replace(/\/+$/, '');
      const headers = { 'Content-Type': 'application/json' };
      if (settings.proxySecret) headers['Authorization'] = `Bearer ${settings.proxySecret}`;
      const res = await fetch(`${url}/health`, { method: 'GET', headers });
      if (res.ok) {
        const data = await res.json();
        setConnStatus('ok');
        setConnDetail(`Connected! Routes: ${(data.routes || []).join(', ')}`);
      } else {
        setConnStatus('error');
        setConnDetail(`Worker responded with ${res.status}. Check the URL and redeploy if needed.`);
      }
    } catch (err) {
      setConnStatus('error');
      setConnDetail(`Cannot reach ${settings.proxyUrl}. Check the URL or make sure the worker is deployed.`);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setSettings(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    setSaved(false);
  };

  const handleSave = async () => {
    try {
      await saveSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save settings:', err);
      alert('Failed to save settings: ' + err.message);
    }
  };

  const handleExport = () => {
    const data = { version: 1, exportedAt: new Date().toISOString() };
    for (const key of EXPORT_KEYS) {
      try {
        const raw = localStorage.getItem(key);
        data[key] = raw ? JSON.parse(raw) : [];
      } catch {
        data[key] = [];
      }
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dealflow-backup-${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.version) {
        alert('Invalid backup file: missing version field.');
        return;
      }

      if (!confirm('This will replace ALL current data (except your API settings). Are you sure?')) {
        return;
      }

      for (const key of EXPORT_KEYS) {
        if (data[key] !== undefined) {
          localStorage.setItem(key, JSON.stringify(data[key]));
        }
      }

      alert('Data imported successfully. Reloading...');
      window.location.reload();
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }

    // Reset file input
    if (importRef.current) importRef.current.value = '';
  };

  if (loading || !settings) return <div className="page fade-in"><p>Loading settings...</p></div>;

  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Configure API keys and proxy connection</p>
        </div>
        <button className="btn btn-primary" onClick={handleSave}>
          <Save size={18} />
          {saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>

      <div className="settings-grid">
        <div className="card settings-section">
          <h3><Shield size={18} /> Proxy Configuration</h3>
          <div className="form-group">
            <label>Proxy URL</label>
            <input
              type="text"
              name="proxyUrl"
              value={settings.proxyUrl}
              onChange={handleChange}
              placeholder="https://your-worker.your-subdomain.workers.dev"
            />
          </div>
          <div className="form-group">
            <label>Proxy Secret</label>
            <input
              type="password"
              name="proxySecret"
              value={settings.proxySecret}
              onChange={handleChange}
              placeholder="Bearer token for proxy auth"
            />
          </div>
          <button
            className="btn btn-secondary"
            onClick={testConnection}
            disabled={connStatus === 'testing'}
            style={{ marginTop: '0.5rem' }}
          >
            {connStatus === 'testing' ? <Wifi size={18} /> : connStatus === 'ok' ? <Wifi size={18} /> : <WifiOff size={18} />}
            {connStatus === 'testing' ? 'Testing...' : 'Test Connection'}
          </button>
          {connStatus && connStatus !== 'testing' && (
            <p style={{
              fontSize: '0.85rem',
              marginTop: '0.5rem',
              color: connStatus === 'ok' ? '#22c55e' : '#ef4444',
            }}>
              {connDetail}
            </p>
          )}
        </div>

        <div className="card settings-section">
          <h3><Key size={18} /> API Keys</h3>
          <div className="form-group">
            <label>Perplexity API Key</label>
            <input
              type="password"
              name="perplexityApiKey"
              value={settings.perplexityApiKey}
              onChange={handleChange}
              placeholder="pplx-..."
            />
          </div>
          <div className="form-group">
            <label>Apollo API Key</label>
            <input
              type="password"
              name="apolloApiKey"
              value={settings.apolloApiKey}
              onChange={handleChange}
              placeholder="Apollo.io API key"
            />
          </div>
          <div className="form-group">
            <label>Exa API Key</label>
            <input
              type="password"
              name="exaApiKey"
              value={settings.exaApiKey}
              onChange={handleChange}
              placeholder="Exa API key"
            />
          </div>
          <div className="form-group">
            <label>Firecrawl API Key</label>
            <input
              type="password"
              name="firecrawlApiKey"
              value={settings.firecrawlApiKey}
              onChange={handleChange}
              placeholder="fc-..."
            />
          </div>
        </div>

        <div className="card settings-section">
          <h3><Zap size={18} /> Automation</h3>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                name="autoEnrich"
                checked={settings.autoEnrich}
                onChange={handleChange}
              />
              Auto-enrich new companies (Quick Add)
            </label>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Automatically run the research agent when adding a company via Quick Add
            </p>
          </div>
        </div>

        <div className="card settings-section">
          <h3><Download size={18} /> Data Management</h3>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={handleExport}>
              <Download size={18} />
              Export All Data
            </button>
            <button className="btn btn-secondary" onClick={() => importRef.current?.click()}>
              <Upload size={18} />
              Import Data
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleImport}
            />
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
            Export creates a JSON backup of all your data. Import replaces existing data (except API settings).
          </p>
        </div>
      </div>
    </div>
  );
}

export default Settings;
