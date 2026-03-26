// =============================================
// MTIRIRIKO FLOW — Stats Screen (New)
// Bar chart, segmented control, summaries
// =============================================
import { state, fmt } from '../state.js';
import { icon } from '../icons.js';
import { toast } from '../animations.js';

export function renderStats() {
    const app = document.getElementById('app');

    const maxSpend = Math.max(...state.spending.map(s => s.amount));
    const currentMonth = new Date().toLocaleString('en', { month: 'short' });

    const barsHTML = state.spending.map(s => {
        const pct = Math.round((s.amount / maxSpend) * 100);
        const isActive = s.month === currentMonth || s.month === 'Mar';
        return `
      <div class="chart-bar">
        <div class="chart-fill ${isActive ? 'chart-fill--active' : ''}" style="height:${pct}%"></div>
        <div class="chart-month">${s.month}</div>
      </div>
    `;
    }).join('');

    // Recent transactions for stats
    const txHTML = state.transactions.slice(0, 4).map(tx => {
        const cls = tx.type;
        const prefix = tx.type === 'out' ? '−' : '+';
        return `
      <div class="tx-item">
        <div class="tx-avatar tx-avatar--${cls}">${tx.name.charAt(0)}</div>
        <div class="tx-info">
          <div class="tx-name">${tx.name}</div>
          <div class="tx-cat">${tx.cat}<span class="tx-cat-dot"></span>${tx.time}</div>
        </div>
        <div class="tx-right">
          <div class="tx-amount tx-amount--${cls}">${prefix} cKES ${fmt(tx.amount)}</div>
        </div>
      </div>`;
    }).join('');

    app.innerHTML = `
    <div class="screen-header">
      <button class="back-btn" id="go-back">${icon('back')}</button>
      <div class="screen-title">Statistics</div>
    </div>

    <div class="seg-control">
      <button class="seg-btn" data-period="daily">Daily</button>
      <button class="seg-btn" data-period="weekly">Weekly</button>
      <button class="seg-btn active" data-period="monthly">Monthly</button>
      <button class="seg-btn" data-period="yearly">Yearly</button>
    </div>

    <div class="stats-balance">
      <div class="stats-balance-label">Total Balance</div>
      <div class="stats-balance-amount">cKES ${fmt(state.balance)} ${icon('trendUp', 20)}</div>
    </div>

    <div class="chart-container">
      <div class="chart-bars">${barsHTML}</div>
    </div>

    <div class="summary-row">
      <div class="summary-card">
        <div class="summary-icon summary-icon--spent">${icon('arrowUp', 16)}</div>
        <div class="summary-label">Total Spent</div>
        <div class="summary-val">cKES ${fmt(state.monthlySpent)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-icon summary-icon--income">${icon('arrowDown', 16)}</div>
        <div class="summary-label">Total Received</div>
        <div class="summary-val">cKES ${fmt(state.monthlyIncome)}</div>
      </div>
    </div>

    <div class="section-header">
      <div class="section-title">Recent Activity</div>
      <button class="section-link" id="see-all">See all</button>
    </div>
    <div class="tx-list stagger">${txHTML}</div>

    <nav class="bottom-nav">
      <button class="nav-item" data-route="#home">${icon('home')}<span class="nav-label">Home</span></button>
      <button class="nav-item active" data-route="#stats">${icon('stats')}<span class="nav-label">Stats</span></button>
      <button class="nav-center-btn" id="nav-c4">${icon('plus')}</button>
      <button class="nav-item" data-route="#cards">${icon('card')}<span class="nav-label">Cards</span></button>
      <button class="nav-item" data-route="#menu">${icon('menu')}<span class="nav-label">Menu</span></button>
    </nav>
  `;

    // --- Events ---
    document.getElementById('go-back').addEventListener('click', () => { window.location.hash = '#home'; });

    document.querySelectorAll('.seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            toast(`Showing ${btn.dataset.period} data`, 'info');
        });
    });

    document.getElementById('see-all')?.addEventListener('click', () => toast('📋 Full history — coming soon', 'info'));

    document.querySelectorAll('.nav-item[data-route]').forEach(btn => {
        btn.addEventListener('click', () => {
            const r = btn.dataset.route;
            if (r === '#cards' || r === '#menu') toast('Coming soon', 'info');
            else window.location.hash = r;
        });
    });
    document.getElementById('nav-c4')?.addEventListener('click', () => { window.location.hash = '#send'; });
}
