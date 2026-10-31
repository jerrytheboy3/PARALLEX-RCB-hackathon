// QR content analysis. The QR image is decoded IN THE BROWSER; only its text reaches us.
// We never open, fetch or resolve anything inside it.

const RECEIVE_RE = /\b(?:receive|claim|get|credit(?:ed)?|cash\s?back|refund|reward|prize|won|winning|bonus|lucky)\b|ಪಡೆಯಿರಿ|ಸ್ವೀಕರಿಸಿ|ಬಹುಮಾನ|ಕ್ಯಾಶ್‌?ಬ್ಯಾಕ್/i;

function safeDecode(v) {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function parseUpi(raw) {
  const q = raw.slice(raw.indexOf('?') + 1);
  const params = {};
  for (const part of q.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = (i < 0 ? part : part.slice(0, i)).toLowerCase();
    const v = i < 0 ? '' : safeDecode(part.slice(i + 1).replace(/\+/g, ' '));
    if (!(k in params)) params[k] = v.slice(0, 200);
  }
  return params;
}

/**
 * @param {string} raw decoded QR text
 * @param {string} [context] message that came with the QR (optional)
 * @returns {{ displayText: string, qr: object, signals: object[] }}  signals use offsets into displayText
 */
export function analyzeQrContent(raw, context) {
  const content = String(raw || '').trim();
  const ctx = context && context.trim() ? `\n\nMessage that came with the QR:\n${context.trim()}` : '';

  if (/^upi:\/\/pay\?/i.test(content)) {
    const p = parseUpi(content);
    const lines = ['UPI payment QR — scanning it takes money FROM your account.'];
    lines.push(`Payee: ${p.pn || '(no name)'} <${p.pa || 'unknown'}>`);
    if (p.am) lines.push(`Amount: ₹${p.am}`);
    if (p.tn) lines.push(`Note: ${p.tn}`);
    const displayText = lines.join('\n') + ctx;

    const signals = [];
    // Search the human-readable parts (name, note, context) for "receive money" bait —
    // not the header line and not the VPA itself. Masking keeps offsets aligned.
    const headerLen = lines[0].length;
    const vpa = `<${p.pa || 'unknown'}>`;
    const vpaAt = displayText.indexOf(vpa);
    const masked = (' '.repeat(headerLen) + displayText.slice(headerLen)).split('');
    if (vpaAt >= 0) for (let i = vpaAt; i < vpaAt + vpa.length; i++) masked[i] = ' ';
    const m = masked.join('').match(RECEIVE_RE);
    if (m) {
      const start = m.index;
      signals.push({
        id: 'upi_receive_scam',
        category: 'money',
        strength: 'serious',
        weight: 40,
        start,
        end: start + m[0].length,
        evidence: m[0],
        explanation: 'Says you will RECEIVE money — but scanning a UPI QR and entering your PIN only ever SENDS money out of your account.',
        lang: /[ಀ-೿]/.test(m[0]) ? 'kn' : 'en',
        source: 'server',
      });
    }
    if (p.am && Number(p.am) > 0) {
      const line = `Amount: ₹${p.am}`;
      const start = displayText.indexOf(line);
      signals.push({
        id: 'upi_preset_amount',
        category: 'money',
        strength: 'weak',
        weight: 10,
        start,
        end: start + line.length,
        evidence: line,
        explanation: `The amount (₹${p.am}) is already filled in — check it before you pay; this QR will take that amount from you.`,
        lang: 'en',
        source: 'server',
      });
    }
    return {
      displayText,
      qr: {
        kind: 'upi',
        payeeVpa: p.pa || null,
        payeeName: p.pn || null,
        amount: p.am || null,
        note: p.tn || null,
        currency: p.cu || 'INR',
        notice: 'Scanning a UPI QR always SENDS money. You never need to scan or enter a PIN to receive money.',
      },
      signals,
    };
  }

  if (/^https?:\/\//i.test(content)) {
    return { displayText: content + ctx, qr: { kind: 'url', url: content }, signals: [] };
  }
  return { displayText: content + ctx, qr: { kind: 'text' }, signals: [] };
}
