import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';

type ApiResponse = { user?: { id: string; email: string }; message?: string; error?: { message?: string } };

async function postAuth(path: string, body: Record<string, string>): Promise<ApiResponse> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as ApiResponse;
  if (!response.ok) throw new Error(data.error?.message || 'Something went wrong. Please try again.');
  return data;
}

export default function AuthPage() {
  const [email, setEmail] = useState('');
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const code = digits.join('');

  const requestCode = async () => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const data = await postAuth('/api/v1/auth/signup/request-otp', { email });
      setStep('code');
      setNotice(data.message || 'Check your inbox for the verification code.');
      window.setTimeout(() => inputRefs.current[0]?.focus(), 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send the verification code.');
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    setError('');
    setBusy(true);
    try {
      await postAuth('/api/v1/auth/signup/verify-otp', { email, code });
      window.location.replace('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not verify the code.');
    } finally {
      setBusy(false);
    }
  };

  const updateDigit = (index: number, value: string) => {
    const characters = value.replace(/\D/g, '');
    if (characters.length > 1) {
      const pasted = characters.slice(0, 6).split('');
      setDigits(Array.from({ length: 6 }, (_, i) => pasted[i] || ''));
      inputRefs.current[Math.min(pasted.length, 5)]?.focus();
      return;
    }
    const next = [...digits];
    next[index] = characters;
    setDigits(next);
    if (characters && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[index] && index > 0) inputRefs.current[index - 1]?.focus();
    if (event.key === 'ArrowLeft' && index > 0) inputRefs.current[index - 1]?.focus();
    if (event.key === 'ArrowRight' && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const pasteCode = (event: ClipboardEvent<HTMLDivElement>) => {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    event.preventDefault();
    const values = pasted.split('');
    setDigits(Array.from({ length: 6 }, (_, i) => values[i] || ''));
    inputRefs.current[Math.min(values.length, 5)]?.focus();
  };

  return (
    <main className="signup-page">
      <header className="signup-header">
        <a className="signup-brand" href="/" aria-label="ClientoraHQ home"><span>✳</span><b>Clientora<span>HQ</span></b></a>
        <a href="/" className="signup-back">Back to dashboard</a>
      </header>
      <section className="signup-content">
        <div className="signup-copy">
          <span className="signup-eyebrow">ClientoraHQ Recorder</span>
          <h1>Video that moves work forward</h1>
          <p>Share clear context with quick video messages and meeting recordings.</p>
          <div className="signup-points"><span><i>✓</i> Record and share in one place</span><span><i>✓</i> Keep your workspace organized</span></div>
        </div>
        <form className="signup-form" onSubmit={(event) => { event.preventDefault(); if (step === 'email') void requestCode(); else void verifyCode(); }}>
          <span className="signup-eyebrow">Create your account</span>
          <h2>Get started for free</h2>
          <p>Enter your work email and we’ll send you a one-time verification code.</p>
          <label htmlFor="signup-email">Work email</label>
          <input id="signup-email" type="email" autoComplete="email" required maxLength={254} placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.currentTarget.value)} disabled={busy || step === 'code'} />
          {error && <p className="auth-error" role="alert">{error}</p>}
          {notice && <p className="auth-notice" role="status">{notice}</p>}
          {step === 'email' ? <button className="signup-primary" type="submit" disabled={busy}>{busy ? 'Sending code…' : 'Sign up'}</button> : <p className="auth-code-help">Enter the six digit code in the verification window.</p>}
          <small>By continuing, you agree to the terms and acknowledge the privacy policy.</small>
        </form>
      </section>
      {step === 'code' && <div className="otp-overlay"><div className="otp-dashboard-skeleton" aria-hidden="true"><div className="otp-skeleton-sidebar"><b>✳ Loom</b><i /><i /><i /><i /></div><div className="otp-skeleton-main"><i /><div /><div className="otp-skeleton-grid"><i /><i /><i /></div></div></div><div className="otp-dimmer" aria-hidden="true" />
        <section className="otp-dialog" role="dialog" aria-modal="true" aria-labelledby="otp-title">
          <span className="otp-logo">✳</span><h2 id="otp-title">We’ve emailed you a code</h2><p>To complete your account setup, enter the code we sent to:</p><strong>{email}</strong>
          <div className="otp-dialog-inputs" onPaste={pasteCode}>{digits.map((digit, index) => <input key={index} ref={(node) => { inputRefs.current[index] = node; }} aria-label={`Digit ${index + 1}`} inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'} maxLength={6} value={digit} onChange={(event) => updateDigit(index, event.currentTarget.value)} onKeyDown={(event) => handleKeyDown(index, event)} />)}</div>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="signup-primary" type="button" onClick={() => void verifyCode()} disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify'}</button>
          <button className="otp-mail-link" type="button" onClick={() => { window.location.href = 'mailto:'; }}>✉ &nbsp; Open email</button>
          <p className="otp-resend">Didn’t receive an email? <button type="button" disabled={busy} onClick={() => void requestCode()}>Resend email</button></p>
        </section>
      </div>}
    </main>
  );
}
