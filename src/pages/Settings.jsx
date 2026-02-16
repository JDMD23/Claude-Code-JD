import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Key, Zap, Shield, Eye, EyeOff, CheckCircle2, AlertCircle, Database, Trash2 } from 'lucide-react';
import { getSettings, saveSettings, enrichCompany, getMasterList, addToMasterList } from '../store/dataStore';
import './Pages.css';
import './Settings.css';

function Settings() {
  const [settings, setSettings] = useState(getSettings());
  const [saved, setSaved] = useState(false);
  const [showApollo, setShowApollo] = useState(false);
  const [showPerplexity, setShowPerplexity] = useState(false);
  const [showTavily, setShowTavily] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const handleChange = (field, value) => {
    setSettings(prev => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTestEnrich = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await enrichCompany('rogo.ai');
      const hasData = Object.keys(result).length > 0;
      setTestResult({
        success: hasData,
        message: hasData
          ? `Found: ${result.companyName || 'N/A'} | ${result.description || 'No description'}`
          : 'No data returned.',
      });
    } catch (err) {
      setTestResult({ success: false, message: err.message || 'Connection failed.' });
    }
    setTesting(false);
  };

  const handleClearData = (key, label) => {
    if (confirm(`Clear all ${label}? This cannot be undone.`)) {
      localStorage.removeItem(`dealflow_${key}`);
      window.location.reload();
    }
  };

  const maskKey = (key) => {
    if (!key) return '';
    if (key.length <= 8) return '*'.repeat(key.length);
    return key.slice(0, 4) + '*'.repeat(key.length - 8) + key.slice(-4);
  };

  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>API keys, enrichment services, and data management</p>
        </div>
      </div>

      {/* Proxy + API Keys Section */}
      <div className="card settings-section">
        <div className="settings-section-header">
          <Key size={18} strokeWidth={1.5} />
          <h3>API Proxy & Keys</h3>
        </div>
        <p className="settings-description">
          To use Perplexity/Apollo enrichment, you need a proxy server (see workers/proxy.js for setup instructions).
          Keys are stored locally in your browser and sent only to your proxy.
        </p>

        <div className="api-key-group">
          <label className="api-key-label">
            <span>Proxy URL</span>
            <span className="api-key-hint">Your Cloudflare Worker URL (e.g. https://dealflow-proxy.you.workers.dev)</span>
          </label>
          <div className="api-key-input-wrap">
            <input
              type="text"
              value={settings.proxyUrl}
              onChange={(e) => handleChange('proxyUrl', e.target.value)}
              placeholder="https://dealflow-proxy.your-name.workers.dev"
              className="api-key-input"
            />
          </div>
        </div>

        <div className="api-key-group">
          <label className="api-key-label">
            <span>Apollo.io API Key</span>
            <span className="api-key-hint">Organization enrichment, employee data</span>
          </label>
          <div className="api-key-input-wrap">
            <input
              type={showApollo ? 'text' : 'password'}
              value={settings.apolloApiKey}
              onChange={(e) => handleChange('apolloApiKey', e.target.value)}
              placeholder="Enter your Apollo API key..."
              className="api-key-input"
            />
            <button
              className="icon-btn"
              onClick={() => setShowApollo(!showApollo)}
              type="button"
            >
              {showApollo ? <EyeOff size={16} strokeWidth={1.5} /> : <Eye size={16} strokeWidth={1.5} />}
            </button>
          </div>
        </div>

        <div className="api-key-group">
          <label className="api-key-label">
            <span>Perplexity API Key</span>
            <span className="api-key-hint">AI-powered company research</span>
          </label>
          <div className="api-key-input-wrap">
            <input
              type={showPerplexity ? 'text' : 'password'}
              value={settings.perplexityApiKey}
              onChange={(e) => handleChange('perplexityApiKey', e.target.value)}
              placeholder="Enter your Perplexity API key..."
              className="api-key-input"
            />
            <button
              className="icon-btn"
              onClick={() => setShowPerplexity(!showPerplexity)}
              type="button"
            >
              {showPerplexity ? <EyeOff size={16} strokeWidth={1.5} /> : <Eye size={16} strokeWidth={1.5} />}
            </button>
          </div>
        </div>

        <div className="api-key-group">
          <label className="api-key-label">
            <span>Tavily API Key</span>
            <span className="api-key-hint">Advanced web search for NYC addresses (tavily.com)</span>
          </label>
          <div className="api-key-input-wrap">
            <input
              type={showTavily ? 'text' : 'password'}
              value={settings.tavilyApiKey || ''}
              onChange={(e) => handleChange('tavilyApiKey', e.target.value)}
              placeholder="Enter your Tavily API key (tvly-...)..."
              className="api-key-input"
            />
            <button
              className="icon-btn"
              onClick={() => setShowTavily(!showTavily)}
              type="button"
            >
              {showTavily ? <EyeOff size={16} strokeWidth={1.5} /> : <Eye size={16} strokeWidth={1.5} />}
            </button>
          </div>
        </div>

        <div className="settings-actions">
          <button className="btn btn-primary" onClick={handleSave}>
            {saved ? <><CheckCircle2 size={16} strokeWidth={1.5} /> Saved</> : 'Save Keys'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleTestEnrich}
            disabled={testing}
          >
            <Zap size={16} strokeWidth={1.5} />
            {testing ? 'Testing...' : 'Test with rogo.ai'}
          </button>
        </div>

        {testResult && (
          <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
            {testResult.success
              ? <CheckCircle2 size={16} strokeWidth={1.5} />
              : <AlertCircle size={16} strokeWidth={1.5} />
            }
            <span>{testResult.message}</span>
          </div>
        )}
      </div>

      {/* Enrichment Settings */}
      <div className="card settings-section">
        <div className="settings-section-header">
          <Zap size={18} strokeWidth={1.5} />
          <h3>Enrichment</h3>
        </div>
        <p className="settings-description">
          Configure auto-enrichment when adding companies to the Master List.
        </p>

        <div className="setting-toggle">
          <div>
            <span className="setting-toggle-label">Auto-enrich new companies</span>
            <span className="setting-toggle-hint">Automatically fetch data when adding companies via Quick-Add</span>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={settings.autoEnrich}
              onChange={(e) => handleChange('autoEnrich', e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>

      {/* Data Management */}
      <div className="card settings-section">
        <div className="settings-section-header">
          <Database size={18} strokeWidth={1.5} />
          <h3>Data Management</h3>
        </div>
        <p className="settings-description">
          All data is stored in your browser's local storage. Clearing data cannot be undone.
        </p>

        <div className="data-actions">
          <button className="btn btn-secondary" onClick={() => handleClearData('deals', 'deals')}>
            <Trash2 size={14} strokeWidth={1.5} /> Clear Deals
          </button>
          <button className="btn btn-secondary" onClick={() => handleClearData('prospects', 'prospects')}>
            <Trash2 size={14} strokeWidth={1.5} /> Clear Prospects
          </button>
          <button className="btn btn-secondary" onClick={() => handleClearData('master_list', 'master list')}>
            <Trash2 size={14} strokeWidth={1.5} /> Clear Master List
          </button>
          <button className="btn btn-secondary" onClick={() => handleClearData('commissions', 'commissions')}>
            <Trash2 size={14} strokeWidth={1.5} /> Clear Commissions
          </button>
          <button className="btn btn-danger" onClick={() => {
            if (confirm('Clear ALL DealFlow data? This cannot be undone.')) {
              Object.keys(localStorage).filter(k => k.startsWith('dealflow_')).forEach(k => localStorage.removeItem(k));
              window.location.reload();
            }
          }}>
            <Trash2 size={14} strokeWidth={1.5} /> Clear All Data
          </button>
        </div>
      </div>

      {/* Security Notice */}
      <div className="card settings-section muted">
        <div className="settings-section-header">
          <Shield size={18} strokeWidth={1.5} />
          <h3>Security</h3>
        </div>
        <p className="settings-description">
          API keys are stored locally in your browser and never sent to any server other than the respective API providers.
          DealFlow runs entirely client-side with no backend.
        </p>
      </div>
    </div>
  );
}

export default Settings;
