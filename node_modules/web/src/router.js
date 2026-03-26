// =============================================
// MTIRIRIKO FLOW — Router
// =============================================
import { renderHome } from './views/Home.js';
import { renderSend } from './views/Send.js';
import { renderReceive } from './views/Receive.js';
import { renderStats } from './views/Stats.js';
import { renderWithdraw } from './views/Withdraw.js';

export function initRouter() {
    window.addEventListener('hashchange', navigate);
    navigate();
}

function navigate() {
    const raw = window.location.hash || '#home';

    if (raw.startsWith('#send/')) {
        renderSend(parseInt(raw.split('/')[1]) || null);
    } else if (raw === '#send') {
        renderSend(null);
    } else if (raw === '#receive') {
        renderReceive();
    } else if (raw === '#stats') {
        renderStats();
    } else if (raw === '#withdraw') {
        renderWithdraw();
    } else {
        renderHome();
    }
    updateNav(raw);
}

function updateNav(hash) {
    document.querySelectorAll('.nav-item').forEach(btn => {
        const route = btn.dataset.route;
        if (!route) return;
        btn.classList.toggle('active', hash === route || hash.startsWith(route + '/'));
    });
}
