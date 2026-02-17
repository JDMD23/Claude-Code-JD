import { useState } from 'react';
import { Building2, Mail, ArrowRight, Loader } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }

    setSending(true);
    try {
      await signIn(email.trim());
      setSent(true);
    } catch (err) {
      if (err.message?.includes('rate')) {
        setError('Too many attempts. Please wait a minute and try again.');
      } else {
        setError(err.message || 'Failed to send magic link. Please try again.');
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'var(--bg-primary)',
      padding: '1rem',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        backgroundColor: 'var(--bg-secondary)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-color)',
        padding: '2.5rem 2rem',
        boxShadow: 'var(--shadow-lg)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <Building2
            size={40}
            strokeWidth={1.5}
            style={{ color: 'var(--accent-primary)', marginBottom: '0.75rem' }}
          />
          <h1 style={{
            fontSize: '1.5rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            margin: 0,
          }}>
            Norman CRE
          </h1>
          <p style={{
            fontSize: '0.85rem',
            color: 'var(--text-secondary)',
            marginTop: '0.5rem',
          }}>
            Sign in to your account
          </p>
        </div>

        {sent ? (
          /* Success state */
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: 'rgba(34, 197, 94, 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem',
            }}>
              <Mail size={24} style={{ color: 'var(--status-green)' }} />
            </div>
            <h3 style={{
              fontSize: '1.1rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '0.5rem',
            }}>
              Check your email
            </h3>
            <p style={{
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
              marginBottom: '1.5rem',
            }}>
              We sent a login link to <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>
            </p>
            <button
              onClick={() => { setSent(false); setEmail(''); }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-primary)',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          /* Login form */
          <form onSubmit={handleSubmit}>
            <label style={{
              display: 'block',
              fontSize: '0.8rem',
              fontWeight: 500,
              color: 'var(--text-secondary)',
              marginBottom: '0.5rem',
            }}>
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoFocus
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                fontSize: '0.9rem',
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                outline: 'none',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
              onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
            />

            {error && (
              <p style={{
                fontSize: '0.8rem',
                color: 'var(--status-red)',
                marginTop: '0.5rem',
              }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={sending}
              style={{
                width: '100%',
                marginTop: '1rem',
                padding: '0.75rem 1rem',
                fontSize: '0.9rem',
                fontWeight: 600,
                backgroundColor: 'var(--accent-primary)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                cursor: sending ? 'not-allowed' : 'pointer',
                opacity: sending ? 0.7 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                transition: 'background-color 0.2s, opacity 0.2s',
              }}
              onMouseEnter={(e) => { if (!sending) e.target.style.backgroundColor = 'var(--accent-primary-hover)'; }}
              onMouseLeave={(e) => { e.target.style.backgroundColor = 'var(--accent-primary)'; }}
            >
              {sending ? (
                <>
                  <Loader size={16} className="spinning" />
                  Sending...
                </>
              ) : (
                <>
                  Send Magic Link
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default Login;
