import { useState, useRef, useEffect } from 'react';
import { X, Send, MessageSquare, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { sendChatMessage, getChatContext, getSettings } from '../store/dataStore';
import './ChatPanel.css';

function ChatPanel({ isOpen, onClose, contextType = 'general', contextData = null }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Check if proxy is configured
  const settings = getSettings();
  const hasProxy = !!settings.proxyUrl;

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && hasProxy) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, hasProxy]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage = { role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      // Build context for this chat
      const context = getChatContext(contextType, contextData);

      // Send all messages (for conversation history)
      const allMessages = [...messages, userMessage];
      const response = await sendChatMessage(allMessages, context);

      setMessages(prev => [...prev, { role: 'assistant', content: response.content }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
  };

  const getContextLabel = () => {
    if (contextType === 'company' && contextData) {
      return `Researching: ${contextData.organizationName}`;
    }
    if (contextType === 'deal' && contextData) {
      return `Deal: ${contextData.clientName}`;
    }
    if (contextType === 'prospect' && contextData) {
      return `Prospect: ${contextData.organizationName}`;
    }
    return 'DealFlow Assistant';
  };

  const getSuggestions = () => {
    if (contextType === 'company' && contextData) {
      return [
        'Draft an outreach email',
        'Summarize what we know',
        'What questions should I ask?',
      ];
    }
    if (contextType === 'deal') {
      return [
        'What should I do next?',
        'Draft a follow-up email',
        'Summarize this deal',
      ];
    }
    return [
      'Which deals need attention?',
      'Summarize my pipeline',
      'What follow-ups are due?',
    ];
  };

  if (!isOpen) return null;

  return (
    <div className="chat-panel-overlay" onClick={onClose}>
      <div className="chat-panel" onClick={e => e.stopPropagation()}>
        <div className="chat-header">
          <div className="chat-header-left">
            <Sparkles size={18} strokeWidth={1.5} />
            <div>
              <h3>Claude Assistant</h3>
              <span className="chat-context-label">{getContextLabel()}</span>
            </div>
          </div>
          <div className="chat-header-actions">
            {messages.length > 0 && (
              <button className="icon-btn" onClick={clearChat} title="Clear chat">
                <Trash2 size={16} strokeWidth={1.5} />
              </button>
            )}
            <button className="icon-btn" onClick={onClose}>
              <X size={18} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {!hasProxy ? (
          <div className="chat-no-api-key">
            <MessageSquare size={32} strokeWidth={1.5} />
            <h4>Proxy URL Required</h4>
            <p>Configure your Proxy URL in Settings to use the AI assistant.</p>
          </div>
        ) : (
          <>
            <div className="chat-messages">
              {messages.length === 0 && (
                <div className="chat-empty">
                  <Sparkles size={24} strokeWidth={1.5} />
                  <p>How can I help you today?</p>
                  <div className="chat-suggestions">
                    {getSuggestions().map((suggestion, i) => (
                      <button
                        key={i}
                        className="chat-suggestion"
                        onClick={() => setInput(suggestion)}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`chat-message ${msg.role}`}>
                  <div className="chat-message-content">
                    {msg.content.split('\n').map((line, j) => (
                      <p key={j}>{line || '\u00A0'}</p>
                    ))}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="chat-message assistant loading">
                  <Loader2 size={16} className="spin" />
                  <span>Thinking...</span>
                </div>
              )}

              {error && (
                <div className="chat-error">
                  {error}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <div className="chat-input-area">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Claude anything..."
                rows={1}
                disabled={loading}
              />
              <button
                className="chat-send-btn"
                onClick={handleSend}
                disabled={!input.trim() || loading}
              >
                <Send size={18} strokeWidth={1.5} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ChatPanel;
