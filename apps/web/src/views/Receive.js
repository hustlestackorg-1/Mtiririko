// =============================================
// MTIRIRIKO FLOW — Fiat On-Ramp (Top Up)
// =============================================
import { state, fmt, executeTopUp } from '../state.js';
import { icon } from '../icons.js';
import { toast } from '../animations.js';

export function renderReceive() {
  const app = document.getElementById('app');

  app.innerHTML = `
    <div class="screen-header">
      <button class="back-btn" id="go-back">${icon('back')}</button>
      <div class="screen-title">Top Up (Mint cKES)</div>
    </div>

    <div class="flow-scene" style="padding: 24px; display: flex; flex-direction: column; gap: 24px;">
      
      <div style="background: rgba(0, 240, 255, 0.03); border: 1px solid rgba(0, 240, 255, 0.1); border-radius: 16px; padding: 20px;">
        <div style="font-family: 'SF Mono', monospace; font-size: 10px; color: var(--cyan); letter-spacing: 1px; margin-bottom: 12px; opacity: 0.8;">LIQUIDITY BRIDGE // M-PESA TO EVM</div>
        <div style="font-size: 13px; color: var(--text-2); line-height: 1.5;">
          Deposit fiat from your M-Pesa wallet. The protocol will instantly mint 1:1 backed <b>cKES</b> into your spatial wallet address.
        </div>
      </div>

      <div class="send-amount-wrapper" style="margin: 0; padding: 32px 0;">
        <div class="send-currency" style="color: var(--text-2);">KES</div>
        <input type="number" class="send-input" id="topup-input" placeholder="0" inputmode="numeric" style="margin-right: -40px;">
      </div>

      <div class="flow-auth-badge" style="align-self: flex-start; margin-bottom: 0;">
        <dot></dot>Source: Safaricom (${state.user.phone})
      </div>

      <div class="spacer"></div>

      <button class="flow-pill" id="stk-btn" style="width: 100%; border-radius: 16px; padding: 20px; font-size: 16px; justify-content: center;">
        <span style="color: var(--cyan); margin-right: 8px;">${icon('bolt', 18)}</span> Trigger STK Push
      </button>

      <!-- Terminal output hidden by default -->
      <div id="mint-terminal" style="display: none; background: #000; border-radius: 12px; padding: 16px; font-family: 'Fira Code', monospace; font-size: 10px; color: #00ff41; line-height: 1.6; border: 1px solid #00ff4133; margin-top: 12px; height: 100px; overflow-y: hidden;">
        > INITIALIZING FIAT-TO-CRYPTO BRIDGE...
      </div>
    </div>

    <nav class="flow-nav">
      <button class="flow-nav-item" data-route="#home"><div class="flow-nav-dot"></div></button>
      <button class="flow-nav-item" data-route="#stats">${icon('stats', 20)}</button>
      <button class="flow-nav-fab" id="nav-c">${icon('plus', 24)}</button>
      <button class="flow-nav-item" data-route="#cards">${icon('card', 20)}</button>
      <button class="flow-nav-item" data-route="#menu">${icon('menu', 20)}</button>
    </nav>
  `;

  document.getElementById('go-back').addEventListener('click', () => { window.location.hash = '#home'; });

  document.getElementById('stk-btn').addEventListener('click', async () => {
    const v = document.getElementById('topup-input').value;
    const amount = parseFloat(v);
    if (!amount || amount <= 0) {
      toast('Enter a valid KES amount', 'error');
      return;
    }

    const btn = document.getElementById('stk-btn');
    const term = document.getElementById('mint-terminal');

    btn.style.display = 'none';
    term.style.display = 'block';

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    await sleep(400);
    term.innerHTML += '<br>> M-PESA STK PUSH INITIATED... WAITING FOR USER PIN.';
    await sleep(2000);
    term.innerHTML += '<br>> FIAT DEPOSIT CONFIRMED. TX_ID: 9XF4J9K';
    await sleep(800);
    term.innerHTML += '<br>> CALLING cKES.MINT(AMOUNT) ON EVM NODE...';
    await sleep(1500);

    const success = await executeTopUp(amount, 'M-Pesa');

    if (success) {
      term.innerHTML += '<br>> <span style="color:#FFF">MINT SUCCESSFUL. BALANCES SYNCED.</span>';
      toast(`✅ ${fmt(amount)} cKES Minted`, 'success');
      setTimeout(() => {
        window.location.hash = '#home';
      }, 1500);
    } else {
      term.innerHTML += '<br>> <span style="color:red">MINT FAILED. INSUFFICIENT GAS OR NODE DOWN.</span>';
      toast('Top Up Failed', 'error');
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
  document.getElementById('nav-c')?.addEventListener('click', () => { window.location.hash = '#send'; });
}
