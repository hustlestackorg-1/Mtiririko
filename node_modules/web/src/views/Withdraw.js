// =============================================
// MTIRIRIKO FLOW — Fiat Off-Ramp (Withdraw)
// =============================================
import { state, executeWithdrawal, fmt } from '../state.js';
import { icon } from '../icons.js';
import { toast } from '../animations.js';

let selectedMethod = 'mpesa';
let amtStr = '';

const methods = [
  { id: 'mpesa', name: 'M-Pesa', icon: 'M', hue: 140, dest: '0712 *** 678' },
  { id: 'paypal', name: 'PayPal', icon: 'P', hue: 210, dest: 'abigail@...' },
  { id: 'bank', name: 'Stripe', icon: 'S', hue: 250, dest: 'Equity *901' }
];

export function renderWithdraw() {
  amtStr = '';
  refreshDOM();
}

function refreshDOM() {
  const app = document.getElementById('app');

  const methodHTML = methods.map(m => `
      <div class="offramp-method ${selectedMethod === m.id ? 'active' : ''}" data-id="${m.id}" style="--v-hue: ${m.hue}">
        <div class="offramp-icon">${m.icon}</div>
        <div style="flex:1;">
          <div style="font-size:14px; color:var(--text-1); font-weight:500;">${m.name}</div>
          <div style="font-size:11px; color:var(--text-3); font-family: 'SF Mono', monospace;">${m.dest}</div>
        </div>
        ${selectedMethod === m.id ? `<div style="color:var(--cyan)">${icon('verify', 16)}</div>` : ''}
      </div>
    `).join('');

  app.innerHTML = `
      <div class="screen-header">
        <button class="back-btn" id="go-back">${icon('back')}</button>
        <div class="screen-title">Withdraw (Off-Ramp)</div>
      </div>

      <div class="flow-scene" style="padding: 24px; display: flex; flex-direction: column; gap: 24px;">
        
        <div style="background: rgba(255, 56, 95, 0.03); border: 1px solid rgba(255, 56, 95, 0.1); border-radius: 16px; padding: 20px;">
          <div style="font-family: 'SF Mono', monospace; font-size: 10px; color: #ff385f; letter-spacing: 1px; margin-bottom: 12px; opacity: 0.8;">LIQUIDITY BRIDGE // EVM TO FIAT</div>
          <div style="font-size: 13px; color: var(--text-2); line-height: 1.5;">
            Withdraw directly to your bank or mobile money. The protocol will permanently burn your <b>cKES</b> and release fiat equivalents.
          </div>
        </div>

        <div style="display:flex; flex-direction:column; gap:8px;">
          <div style="font-size:12px; font-weight:600; color:var(--text-3); text-transform:uppercase; letter-spacing:1px;">Destination</div>
          <div style="display:flex; flex-direction:column; gap:8px;">
            ${methodHTML}
          </div>
        </div>

        <div class="send-amount-wrapper" style="margin: 0; padding: 16px 0;">
          <div class="send-currency" style="color: var(--text-2);">cKES</div>
          <input type="number" class="send-input" id="withdraw-input" placeholder="0" inputmode="numeric" style="margin-right: -40px;">
        </div>

        <div class="flow-auth-badge" style="align-self: flex-start; margin-bottom: 0;">
          <dot style="background:#ff385f; box-shadow:0 0 6px #ff385f;"></dot>Balance: ${fmt(state.balance)}
        </div>

        <div class="spacer"></div>

        <button class="flow-pill" id="burn-btn" style="width: 100%; border-radius: 16px; padding: 20px; font-size: 16px; justify-content: center; background: rgba(255, 56, 95, 0.1); color: #ff385f; border-color: rgba(255,56,95,0.2);">
          ${icon('lock', 16)} Biometric Withdraw
        </button>

        <!-- Terminal output hidden by default -->
        <div id="burn-terminal" style="display: none; background: #000; border-radius: 12px; padding: 16px; font-family: 'Fira Code', monospace; font-size: 10px; color: #ff385f; line-height: 1.6; border: 1px solid #ff385f33; margin-top: 12px; height: 100px; overflow-y: hidden;">
          > AUTHENTICATING BIOMETRICS...
        </div>
      </div>

      <nav class="flow-nav">
        <button class="flow-nav-item" data-route="#home"><div class="flow-nav-dot"></div></button>
        <button class="flow-nav-item" data-route="#stats">${icon('stats', 20)}</button>
        <button class="flow-nav-fab" id="nav-cW">${icon('plus', 24)}</button>
        <button class="flow-nav-item" data-route="#cards">${icon('card', 20)}</button>
        <button class="flow-nav-item" data-route="#menu">${icon('menu', 20)}</button>
      </nav>
    `;

  document.getElementById('go-back').addEventListener('click', () => { window.location.hash = '#home'; });

  document.querySelectorAll('.offramp-method').forEach(card => {
    card.addEventListener('click', () => {
      selectedMethod = card.dataset.id;
      refreshDOM(); // Render again to show active tick
    });
  });

  document.getElementById('burn-btn').addEventListener('click', async () => {
    const v = document.getElementById('withdraw-input').value;
    const amount = parseFloat(v);
    if (!amount || amount <= 0 || amount > state.balance) {
      toast('Invalid amount or insufficient balance', 'error');
      return;
    }

    const btn = document.getElementById('burn-btn');
    const term = document.getElementById('burn-terminal');
    const m = methods.find(x => x.id === selectedMethod);

    btn.style.display = 'none';
    term.style.display = 'block';

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    await sleep(600);
    term.innerHTML += '<br>> FACE ID VERIFIED. PROCEEDING...';
    await sleep(800);
    term.innerHTML += '<br>> CALLING cKES.BURN(' + amount + ') ON EVM NODE...';
    await sleep(1500);

    const success = await executeWithdrawal(amount, m.name);

    if (success) {
      term.innerHTML += '<br>> <span style="color:#FFF">BURN SUCCESSFUL. B2C FIAT API TRIGGERED.</span>';
      term.innerHTML += '<br>> <span style="color:#FFF">FIAT RELEASED TO ' + m.dest + '</span>';
      toast(`✅ ${fmt(amount)} KES sent to ${m.name}`, 'success');
      setTimeout(() => {
        window.location.hash = '#home';
      }, 2000);
    } else {
      term.innerHTML += '<br>> <span style="color:red">BURN FAILED. TRANSACTION REVERTED.</span>';
      toast('Withdrawal Failed', 'error');
      setTimeout(() => {
        btn.style.display = 'flex';
        term.style.display = 'none';
      }, 2000);
    }
  });

  document.querySelectorAll('.flow-nav-item[data-route]').forEach(btn => {
    btn.addEventListener('click', () => {
      window.location.hash = btn.dataset.route;
    });
  });
  document.getElementById('nav-cW')?.addEventListener('click', () => { window.location.hash = '#send' });
}
