import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import './App.css';

const API = import.meta.env.VITE_API_URL || '';
const UPI_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;

function detectPlatform() {
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  return 'desktop';
}

function parseRedirect() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('status');
  const transactionId = params.get('transactionId');
  const code = params.get('code');
  const amountRaw = params.get('amount');
  const amount = amountRaw != null && amountRaw !== '' ? Number(amountRaw) : null;
  const name = params.get('name') || null;
  const upi = params.get('upi') || null;
  if (status === 'success' || status === 'failed') {
    return { view: status, transactionId, code, amount, name, upi };
  }
  return { view: 'form', transactionId: null, code: null, amount: null, name: null, upi: null };
}

function mergePayer(stored, url, api) {
  const amount =
    (api?.amountPaise != null ? api.amountPaise / 100 : null) ??
    url?.amount ??
    stored?.amount ??
    null;
  return {
    name: api?.customerName || url?.name || stored?.name || null,
    upi: api?.upiId || url?.upi || stored?.upi || null,
    amount,
  };
}

function copyText(text) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

function loadPayer(txnId) {
  try {
    const raw = sessionStorage.getItem(`pay_${txnId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePayer(txnId, data) {
  try {
    sessionStorage.setItem(`pay_${txnId}`, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

function ResultScreen({ type, transactionId, code, payer, onRetry, onDone, verifying }) {
  const isSuccess = type === 'success';
  const amount = payer?.amount != null ? payer.amount : null;

  return (
    <main className={`result-card result-${type}`}>
      <div className="result-icon-wrap" aria-hidden="true">
        {isSuccess ? (
          <svg className="result-icon" viewBox="0 0 52 52">
            <circle className="result-circle" cx="26" cy="26" r="24" fill="none" />
            <path className="result-check" fill="none" d="M14 27 L22 35 L38 17" />
          </svg>
        ) : (
          <svg className="result-icon" viewBox="0 0 52 52">
            <circle className="result-circle-fail" cx="26" cy="26" r="24" fill="none" />
            <path className="result-cross" fill="none" d="M18 18 L34 34 M34 18 L18 34" />
          </svg>
        )}
      </div>

      <h1 className="result-title">{isSuccess ? 'Payment successful' : 'Payment failed'}</h1>
      <p className="result-subtitle">
        {isSuccess
          ? `Payment received from ${payer?.name || 'customer'}.`
          : 'Payment was not completed. You can generate a new link and try again.'}
      </p>

      <div className="result-details">
        {payer?.name && (
          <div className="result-row">
            <span>Name</span>
            <strong>{payer.name}</strong>
          </div>
        )}
        {payer?.upi && (
          <div className="result-row">
            <span>UPI ID</span>
            <strong>{payer.upi}</strong>
          </div>
        )}
        <div className="result-row">
          <span>Amount</span>
          <strong>{amount != null ? `₹${Number(amount).toFixed(2)}` : '—'}</strong>
        </div>
        {transactionId && (
          <div className="result-row result-row-id">
            <span>Transaction ID</span>
            <div className="txn-wrap">
              <code className="txn-id">{transactionId}</code>
              <button type="button" className="btn-copy" onClick={() => copyText(transactionId)}>
                Copy
              </button>
            </div>
          </div>
        )}
        {code && !isSuccess && (
          <div className="result-row">
            <span>Status code</span>
            <strong>{code}</strong>
          </div>
        )}
        {verifying && isSuccess && (
          <div className="result-verifying">
            <span className="spinner spinner-sm" />
            Confirming with server…
          </div>
        )}
      </div>

      <div className="result-actions">
        {isSuccess ? (
          <button type="button" className="pay-btn pay-btn-success" onClick={onDone}>
            Create new link
          </button>
        ) : (
          <>
            <button type="button" className="pay-btn" onClick={onRetry}>
              Try again
            </button>
            <button type="button" className="btn-ghost" onClick={onDone}>
              Back
            </button>
          </>
        )}
      </div>
    </main>
  );
}

function App() {
  const [name, setName] = useState('');
  const [upi, setUpi] = useState('success@upi');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('info');
  const [view, setView] = useState('form');
  const [paymentLink, setPaymentLink] = useState('');
  const [transactionId, setTransactionId] = useState(null);
  const [redirectCode, setRedirectCode] = useState(null);
  const [payer, setPayer] = useState(null);
  const [verifying, setVerifying] = useState(false);

  const showMessage = useCallback((text, type = 'info') => {
    setMessage(text);
    setMessageType(type);
  }, []);

  const clearUrl = useCallback(() => {
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const resetForm = useCallback(() => {
    setView('form');
    setPaymentLink('');
    setTransactionId(null);
    setRedirectCode(null);
    setPayer(null);
    setMessage('');
    clearUrl();
  }, [clearUrl]);

  useEffect(() => {
    const { view: v, transactionId: txn, code, amount: urlAmount, name: urlName, upi: urlUpi } = parseRedirect();
    if (v === 'form') return;

    setView(v);
    setTransactionId(txn);
    setRedirectCode(code);
    clearUrl();

    const stored = txn ? loadPayer(txn) : null;
    const urlPayer = { amount: urlAmount, name: urlName, upi: urlUpi };
    setPayer(mergePayer(stored, urlPayer, null));

    if (txn) {
      setVerifying(true);
      axios
        .get(`${API}/api/payments/status/${txn}`)
        .then(({ data }) => {
          if (data.status === 'failed') setView('failed');
          setPayer(mergePayer(stored, urlPayer, data));
        })
        .catch(() => {})
        .finally(() => setVerifying(false));
    }
  }, [clearUrl]);

  const validate = () => {
    const amt = Number(amount);
    if (!name.trim() || name.trim().length < 2) {
      showMessage('Enter a valid name (min 2 characters).', 'error');
      return false;
    }
    const upiVal = upi.trim().toLowerCase();
    if (!UPI_RE.test(upiVal)) {
      showMessage('Enter a valid UPI ID (e.g. rahul@paytm).', 'error');
      return false;
    }
    if (!amt || amt < 1) {
      showMessage('Enter amount of at least ₹1.', 'error');
      return false;
    }
    return true;
  };

  const handleGenerateLink = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setPaymentLink('');
    showMessage('Generating payment link…', 'info');

    const payerData = { name: name.trim(), upi: upi.trim().toLowerCase(), amount: Number(amount) };

    try {
      const { data } = await axios.post(`${API}/api/payments/initiate`, {
        amount: payerData.amount,
        customerName: payerData.name,
        upiId: payerData.upi,
        description: `Payment from ${payerData.name}`,
        successUrl: `${window.location.origin}/?status=success`,
        failureUrl: `${window.location.origin}/?status=failed`,
        platform: detectPlatform(),
      });

      if (!data.success || !data.paymentLink) {
        throw new Error(data.message || 'Could not generate link');
      }

      setPayer(payerData);
      setPaymentLink(data.paymentLink);
      setTransactionId(data.transactionId);
      savePayer(data.transactionId, payerData);
      setView('link');
      showMessage('Payment link ready! Share or open to pay.', 'success');
    } catch (error) {
      showMessage(error.response?.data?.message || error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const isResult = view === 'success' || view === 'failed';

  return (
    <div className="page">
      <div className="page-glow" aria-hidden="true" />

      <header className="header">
        <div className="logo">
          <span className="logo-icon">₹</span>
          <div>
            <p className="logo-title">UPI Pay</p>
            <p className="logo-sub">
              {isResult ? 'Payment status' : view === 'link' ? 'Payment link' : 'Create payment link'}
            </p>
          </div>
        </div>
        {!isResult && <span className="badge">PhonePe</span>}
      </header>

      {isResult ? (
        <ResultScreen
          type={view}
          transactionId={transactionId}
          code={redirectCode}
          payer={payer}
          verifying={verifying}
          onRetry={resetForm}
          onDone={resetForm}
        />
      ) : view === 'link' ? (
        <main className="checkout-card link-card">
          <h1 className="form-title">Payment link ready</h1>
          <p className="form-desc">Share this link. Payer opens it and completes via PhonePe / UPI apps.</p>

          <div className="summary-box">
            <div className="summary-row"><span>Name</span><strong>{payer?.name}</strong></div>
            <div className="summary-row"><span>UPI</span><strong>{payer?.upi}</strong></div>
            <div className="summary-row"><span>Amount</span><strong>₹{Number(payer?.amount).toFixed(2)}</strong></div>
          </div>

          <label className="field-label" htmlFor="pay-link">
            Payment link
          </label>
          <div className="link-box">
            <input id="pay-link" className="link-input" readOnly value={paymentLink} />
            <button type="button" className="btn-copy" onClick={() => copyText(paymentLink)}>
              Copy
            </button>
          </div>

          <div className="link-actions">
            <a href={paymentLink} className="pay-btn pay-btn-block">
              Open & pay now
            </a>
            <button type="button" className="btn-ghost" onClick={resetForm}>
              Create another link
            </button>
          </div>
        </main>
      ) : (
        <main className="checkout-card">
          <h1 className="form-title">Payment details</h1>
          <p className="form-desc">Enter payer info and amount to generate a secure PhonePe payment link.</p>

          <form className="pay-form" onSubmit={handleGenerateLink}>
            <label className="field-label" htmlFor="name">
              Full name
            </label>
            <input
              id="name"
              className="field-input"
              type="text"
              placeholder="Rahul Sharma"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />

            <label className="field-label" htmlFor="upi">
              UPI ID
            </label>
            <input
              id="upi"
              className="field-input"
              type="text"
              placeholder="success@upi"
              value={upi}
              onChange={(e) => setUpi(e.target.value)}
              autoComplete="off"
              required
            />

            <label className="field-label" htmlFor="amount">
              Amount (₹)
            </label>
            <input
              id="amount"
              className="field-input"
              type="number"
              min="1"
              step="0.01"
              placeholder="100"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />

            <button type="submit" className="pay-btn pay-btn-block" disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner" />
                  Generating…
                </>
              ) : (
                'Generate payment link'
              )}
            </button>
          </form>

          <p className="secure-note">
            Link opens PhonePe checkout — GPay, Paytm, PhonePe & more on next screen.
          </p>
        </main>
      )}

      {message && !isResult && (
        <div className={`toast toast-${messageType}`} role="alert">
          {message}
        </div>
      )}

      <footer className="footer">
        <p>
          {isResult
            ? 'Need help? Share your transaction ID with support.'
            : 'Sandbox: use VPA success@upi in PhonePe simulator for test payments.'}
        </p>
      </footer>
    </div>
  );
}

export default App;
