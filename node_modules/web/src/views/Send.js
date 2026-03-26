// =============================================
// MTIRIRIKO FLOW — Send Money (Live Demo)
// =============================================
import { state, executeTransaction, calcFee, fmt, syncBalances } from '../state.js';
import { icon } from '../icons.js';
import { fireConfetti, showSuccess, toast } from '../animations.js';

let picked = null;
let amtStr = '';

export function renderSend() {
  picked = state.quickSend.find(c => c.active) || state.quickSend[0];
  amtStr = '';

  const app = document.getElementById('app');
  const n = parseFloat(amtStr) || 0;
  const feeInfo = n > 0 ? calcFee(n) : { fee: 0 };

  app.innerHTML = `
    <div class="screen-header">
      <button class="back-btn" id="go-back">${icon('back')}</button>
      <div class="screen-title">Send Money</div>
      <div class="spacer"></div>
      ${picked ? `<div style="display:flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;background:var(--glass-2);border:1px solid var(--glass-border);font-size:12px;font-weight:600;color:var(--text-1);">
        <span style="width:22px;height:22px;border-radius:6px;background:hsl(${picked.hue},65%,32%);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#fff;">${picked.initials}</span>
        ${picked.name}
      </div>` : ''}
    </div>

    <!-- Amount Entry -->
    <div id="step-amount">
      <div class="amount-entry">
        <div class="amount-to" id="send-to-label">To ${picked ? picked.name : '—'}</div>
        <div class="amount-card">
          <div class="amount-label">You send</div>
          <div class="amount-display">
            <span class="amount-kes">cKES</span>
            <span id="amt-val">${amtStr ? fmt(parseInt(amtStr)) : '0'}</span>
            <span class="amount-cursor"></span>
          </div>
        </div>
      </div>

      <div id="fee-section" class="hidden">
        <div class="fee-breakdown">
          <div class="fee-row">
            <span class="fee-label">Fee (0.5%)</span>
            <span class="fee-value" id="fee-val">cKES 0</span>
          </div>
          <div class="fee-row fee-row--total">
            <span class="fee-label">Total debit</span>
            <span class="fee-value" id="fee-total">cKES 0</span>
          </div>
          <div class="fee-arrive">${icon('clock', 12)} Arrives in ~1.2s</div>
        </div>
      </div>

      <div class="quick-chips">
        ${[1, 100, 100000, 1000000].map(v => `<button class="quick-chip" data-v="${v}">${fmt(v)}</button>`).join('')}
      </div>

      <div class="numpad" id="numpad">
        ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', '⌫'].map(k =>
    `<button class="numpad-key${k === '⌫' ? ' numpad-key--back' : ''}" data-k="${k}">${k}</button>`
  ).join('')}
      </div>

      <button class="send-btn-big" id="send-btn" disabled>
        ${icon('send', 18)} Enter Amount
      </button>
    </div>

    <nav class="bottom-nav">
      <button class="nav-item" data-route="#home">${icon('home')}<span class="nav-label">Home</span></button>
      <button class="nav-item" data-route="#stats">${icon('stats')}<span class="nav-label">Stats</span></button>
      <button class="nav-center-btn" id="nav-c2">${icon('plus')}</button>
      <button class="nav-item" data-route="#cards">${icon('card')}<span class="nav-label">Cards</span></button>
      <button class="nav-item" data-route="#menu">${icon('menu')}<span class="nav-label">Menu</span></button>
    </nav>
  `;

  // --- Wire ---
  document.getElementById('go-back').addEventListener('click', () => { window.location.hash = '#home'; });

  document.querySelectorAll('.quick-chip').forEach(btn => {
    btn.addEventListener('click', () => { amtStr = btn.dataset.v; refreshAmount(); });
  });

  document.getElementById('numpad')?.addEventListener('click', e => {
    const k = e.target.dataset.k;
    if (!k) return;
    if (k === '⌫') { amtStr = amtStr.slice(0, -1); }
    else if (k === '000') { if (amtStr.length > 0 && amtStr.length < 8) amtStr += '000'; }
    else if (amtStr.length < 9) { amtStr += k; }
    refreshAmount();
  });

  document.getElementById('send-btn')?.addEventListener('click', executeSendFlow);

  document.querySelectorAll('.nav-item[data-route]').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = btn.dataset.route;
      if (r === '#cards' || r === '#menu') toast('Coming soon', 'info');
      else window.location.hash = r;
    });
  });
  document.getElementById('nav-c2')?.addEventListener('click', () => { });
}

function refreshAmount() {
  const n = parseFloat(amtStr) || 0;
  const feeInfo = n > 0 ? calcFee(n) : { fee: 0 };
  const el = document.getElementById('amt-val');
  if (el) el.textContent = amtStr === '' ? '0' : fmt(parseFloat(amtStr || '0'));

  // Fee section
  const feeSection = document.getElementById('fee-section');
  if (feeSection) {
    if (n > 0) {
      feeSection.classList.remove('hidden');
      document.getElementById('fee-val').textContent = `cKES ${fmt(feeInfo.fee)}`;
      document.getElementById('fee-total').textContent = `cKES ${fmt(n + feeInfo.fee)}`;
    } else {
      feeSection.classList.add('hidden');
    }
  }

  const btn = document.getElementById('send-btn');
  if (btn) {
    const valid = n > 0 && (n + feeInfo.fee) <= state.balance;
    btn.disabled = !valid;

    if (n <= 0) btn.innerHTML = `${icon('send', 18)} Enter Amount`;
    else if (!valid) btn.innerHTML = `Insufficient Balance`;
    else btn.innerHTML = `${icon('send', 18)} Send cKES ${fmt(n)}`;
  }
}

async function executeSendFlow() {
  const n = parseFloat(amtStr);
  const feeInfo = calcFee(n);
  if (!n || !picked || (n + feeInfo.fee) > state.balance) return;

  const btn = document.getElementById('send-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = `${icon('send', 18)} Awaiting Ledger Confirm…`; }

  // ACTUAL BLOCKCHAIN TRANSACTION (Awaiting Mining)
  const success = await executeTransaction(n, picked.cId);

  if (success) {
    showSuccess({ name: picked.name, amount: n, formatted: fmt(n) });
    fireConfetti(100);
  } else {
    toast('Blockchain Transaction failed', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = `${icon('send', 18)} Send cKES ${fmt(n)}`; }
  }
}
