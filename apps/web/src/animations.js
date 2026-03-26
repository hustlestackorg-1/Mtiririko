// =============================================
// MTIRIRIKO FLOW — Animations (Premium)
// =============================================
import { icon } from './icons.js';

const CONFETTI_COLORS = ['#5f38ff', '#00f0ff', '#fbbf24', '#a855f7', '#00bcd4', '#4325cc'];

export function fireConfetti(count = 70) {
  const container = document.getElementById('confetti-container');
  if (!container) return;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    const x = Math.random() * 100;
    const delay = Math.random() * 0.5;
    const dur = 1.2 + Math.random() * 0.8;
    const size = 5 + Math.random() * 8;
    p.style.cssText = `
      left:${x}%; top:-10px; width:${size}px; height:${size}px;
      background:${color}; animation-duration:${dur}s; animation-delay:${delay}s;
      border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
    `;
    container.appendChild(p);
    setTimeout(() => p.remove(), (dur + delay) * 1000 + 100);
  }
}

export function showSuccess({ name, amount, formatted }) {
  const el = document.getElementById('result-overlay');
  if (!el) return;

  el.innerHTML = `
    <div class="success-ring"></div>
    <div class="result-circle result-circle--ok">
      <svg width="44" height="44" viewBox="0 0 48 48" fill="none">
        <path class="check-draw" d="M12 25 L20 33 L36 15" stroke="var(--cyan)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <div class="result-title">Sent!</div>
    <div class="result-amount-hero">cKES ${formatted}</div>
    <div class="result-to-name">to ${name}</div>
    <div class="result-trust">${icon('lock', 14)} Secured by Mtiririko Network</div>
  `;
  el.classList.add('open');

  if (navigator.vibrate) navigator.vibrate([40, 20, 40]);

  setTimeout(() => {
    el.classList.remove('open');
    window.location.hash = '#home';
  }, 2000);
}

export function toast(msg, type = 'info', duration = 2400) {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'toastIn 0.18s ease reverse both';
    setTimeout(() => t.remove(), 200);
  }, duration);
}
