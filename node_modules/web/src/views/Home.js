// =============================================
// MTIRIRIKO FLOW — Home Screen
// 2030 Spatial Interface: Balance IS the screen
// =============================================
import { state, fmt } from '../state.js';
import { icon } from '../icons.js';
import { toast } from '../animations.js';

export function renderHome() {
  const app = document.getElementById('app');

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';

  // Format balance with animated-ready spans
  const balStr = fmt(state.balance);

  // Transaction feed
  const txHTML = state.recent.length > 0
    ? state.recent.slice(0, 4).map((tx, i) => {
      const isOut = tx.type === 'out';
      return `
          <div class="flow-tx" style="animation-delay:${i * 60}ms">
            <div class="flow-tx-dot flow-tx-dot--${tx.type}"></div>
            <div class="flow-tx-body">
              <span class="flow-tx-name">${tx.name}</span>
              <span class="flow-tx-meta">${tx.cat} · ${tx.time}</span>
            </div>
            <span class="flow-tx-amount flow-tx-amount--${tx.type}">${isOut ? '−' : '+'}${fmt(tx.amount)}</span>
          </div>`;
    }).join('')
    : `<div class="flow-empty">Your flow begins here</div>`;

  app.innerHTML = `
    <div class="flow-scene">

      <!-- Identity Strip -->
      <div class="flow-id">
        <div class="flow-avatar" id="profile-avatar">${state.user.initials}</div>
        <div class="flow-id-text">
          <span class="flow-greeting">${greeting}</span>
          <span class="flow-name">${state.user.name}</span>
        </div>
        <button class="flow-notif" id="notif-btn">
          <span class="flow-notif-ring"></span>
        </button>
      </div>

      <!-- Hero Balance — the entire emotional center -->
      <div class="flow-hero" id="flow-hero" style="transform-style: preserve-3d;">
        <div class="flow-auth-badge"><dot></dot>Biometric Verified</div>
        <div class="flow-hero-label" style="transform: translateZ(20px);">
          <span class="flow-hero-badge">cKES</span>
          <span class="flow-hero-sync">${icon('clock', 10)} Neural Sync Active</span>
        </div>
        <div class="flow-hero-number" id="hero-balance" style="transform: translateZ(40px); text-shadow: 0 10px 30px rgba(0,240,255,0.15);">${balStr}</div>
        <div style="transform: translateZ(10px); display: flex; justify-content: space-between; align-items: flex-end;">
          <div class="flow-hero-address" id="wallet-id-card">${icon('lock', 10, 'rgba(255,255,255,0.4)')} ${state.user.walletId}</div>
          <div style="font-family:'SF Mono', monospace; font-size:8px; color:rgba(255,255,255,0.2); text-align:right;">SYS.LATENCY: 12ms<br>NODE: NAIROBI/01</div>
        </div>
      </div>

      <!-- Floating Action River -->
      <div class="flow-actions">
        <button class="flow-pill flow-pill--send" id="btn-send">
          <span class="flow-pill-icon">${icon('send', 18)}</span>
          <span class="flow-pill-label">Send</span>
        </button>
        <button class="flow-pill flow-pill--receive" id="btn-receive">
          <span class="flow-pill-icon">${icon('receive', 18)}</span>
          <span class="flow-pill-label">Receive</span>
        </button>
        <button class="flow-pill flow-pill--withdraw" id="btn-withdraw">
          <span class="flow-pill-icon">${icon('withdraw', 18)}</span>
          <span class="flow-pill-label">Withdraw</span>
        </button>
      </div>

      <!-- Pulse Cards -->
      <div class="flow-pulse-row">
        <div class="flow-pulse-card">
          <span class="flow-pulse-value">${fmt(state.monthlyIncome)}</span>
          <span class="flow-pulse-label">In</span>
        </div>
        <div class="flow-pulse-divider"></div>
        <div class="flow-pulse-card">
          <span class="flow-pulse-value">${fmt(state.monthlySpent)}</span>
          <span class="flow-pulse-label">Out</span>
        </div>
      </div>

      <!-- Transaction Stream -->
      <div class="flow-stream">
        <div class="flow-stream-header">
          <span class="flow-stream-title">Activity</span>
        </div>
        ${txHTML}
      </div>

    </div>

    <nav class="flow-nav">
      <button class="flow-nav-item flow-nav-item--active" data-route="#home">
        <span class="flow-nav-dot"></span>
      </button>
      <button class="flow-nav-item" data-route="#stats">
        ${icon('stats', 20)}
      </button>
      <button class="flow-nav-fab" id="nav-center">${icon('plus', 22)}</button>
      <button class="flow-nav-item" data-route="#cards">
        ${icon('card', 20)}
      </button>
      <button class="flow-nav-item" data-route="#menu">
        ${icon('menu', 20)}
      </button>
    </nav>
  `;

  // --- Wire ---
  document.getElementById('wallet-id-card').addEventListener('click', () => {
    navigator.clipboard.writeText(state.user.rawAddress).then(() => {
      toast('Copied ' + state.user.walletId, 'success');
    });
  });

  // Breathing ambient glow on hero
  const hero = document.getElementById('flow-hero');
  if (hero) {
    hero.addEventListener('mousemove', (e) => {
      const rect = hero.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      hero.style.setProperty('--glow-x', x + '%');
      hero.style.setProperty('--glow-y', y + '%');
    });
  }

  document.getElementById('profile-avatar').addEventListener('click', () => {
    state.activeId = state.activeId === 'abigail' ? 'mercy' : 'abigail';
    toast(`${state.user.name}`, 'info');
    renderHome();
  });

  document.getElementById('notif-btn').addEventListener('click', () => toast('All clear', 'info'));
  document.getElementById('btn-send').addEventListener('click', () => { window.location.hash = '#send'; });
  document.getElementById('btn-receive').addEventListener('click', () => { window.location.hash = '#receive'; });
  document.getElementById('btn-withdraw').addEventListener('click', () => { window.location.hash = '#withdraw'; });
  document.getElementById('nav-center').addEventListener('click', () => { window.location.hash = '#send'; });

  document.querySelectorAll('.flow-nav-item[data-route]').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = btn.dataset.route;
      if (r === '#cards' || r === '#menu') toast('Coming soon', 'info');
      else window.location.hash = r;
    });
  });
}
