'use strict';

/* ═══════════════════════════════════════════════════════════════════
   CONFIG
   ═══════════════════════════════════════════════════════════════════ */
const API_URL           = 'https://roxuverse-backend-production-78e6.up.railway.app';
const API_TIMEOUT_MS    = 15000;
const API_UPLOAD_MS     = 60000;
const CHAT_POLL_MS      = 5000;
const CAROUSEL_MS       = 12000;
const XP_PER_LEVEL      = 100;
const MAX_LEVEL         = 999;
const MAX_XP            = 100000;

const BADGES = {
  basic:   { name:'Basic',   icon:'fa-user',          color:'#8a8d94', price:0,      tier:'Rookie',    member:false, fx:'fx-basic',   level:1   },
  special: { name:'Special', icon:'fa-crown',         color:'#ff6ec7', price:17000,  tier:'VIP',       member:true,  fx:'fx-special', level:100 },
  silver:  { name:'Silver',  icon:'fa-shield-halved', color:'#c8d0dc', price:20000,  tier:'Silver',    member:true,  fx:'fx-silver',  level:50  },
  gold:    { name:'Gold',    icon:'fa-trophy',        color:'#ffd31a', price:50000,  tier:'Gold',      member:true,  fx:'fx-gold',    level:150 },
  diamond: { name:'Diamond', icon:'fa-gem',           color:'#18d8f3', price:200000, tier:'Diamond',   member:true,  fx:'fx-diamond', level:400 },
  star:    { name:'Star',    icon:'fa-star',          color:'#ffea00', price:550000, tier:'Legendary', member:true,  fx:'fx-star',    level:999 }
};
const BADGE_ORDER = ['basic', 'special', 'silver', 'gold', 'diamond', 'star'];
const FX_CLASSES  = ['fx-basic', 'fx-special', 'fx-silver', 'fx-gold', 'fx-diamond', 'fx-star'];

const state = {
  user: {
    username: 'user', balance: 0, xp: 0, badge: 'basic',
    owned_badges: ['basic'], avatar_url: '', special_expiry: null,
    token_remaining: 0, token_limit: 0,
    stats: { active: 0, success: 0, pending: 0 }
  },
  tools: [], products: [], payMethods: [], notifications: [], chat: [],
  deposit: { amount: 0, method: '' },
  carouselIndex: 0, carouselTimer: null, chatPollTimer: null, xpAnimFrame: null,
  pickerOpen: false, pickerTab: 'emoji'
};

/* ═══════════════════════════════════════════════════════════════════
   API CLIENT
   ═══════════════════════════════════════════════════════════════════ */
let authToken = localStorage.getItem('roxu_token') || null;

async function api(path, { method = 'GET', body, timeout = API_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  try {
    const res = await fetch(API_URL + path, {
      method, headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || data.message || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') { const e = new Error('Request timeout'); e.status = 408; throw e; }
    throw err;
  } finally { clearTimeout(timer); }
}

const setToken   = (t) => { authToken = t; localStorage.setItem('roxu_token', t); };
const clearToken = () => { authToken = null; localStorage.removeItem('roxu_token'); };

/* ═══════════════════════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════════════════════ */
const $ = (id) => document.getElementById(id);
const fmtRp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[c]);
}
function fmtBytes(b) {
  if (b == null) return '';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
function timeShort(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}
function linkify(text) {
  return text.replace(/(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi, (match) => {
    let url = match, tail = '';
    while (/[.,;:!?)]$/.test(url)) { tail = url.slice(-1) + tail; url = url.slice(0, -1); }
    const href = /^https?:/i.test(url) ? url : 'https://' + url;
    return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" class="msg-link">${esc(url)}</a>${tail}`;
  });
}
function fileIcon(name = '', type = '') {
  const n = name.toLowerCase(), t = type.toLowerCase();
  if (t.startsWith('image/')) return 'fa-file-image';
  if (t.startsWith('video/')) return 'fa-file-video';
  if (t.startsWith('audio/')) return 'fa-file-audio';
  if (t.includes('pdf') || n.endsWith('.pdf')) return 'fa-file-pdf';
  if (/\.(doc|docx)$/.test(n)) return 'fa-file-word';
  if (/\.(xls|xlsx)$/.test(n)) return 'fa-file-excel';
  if (/\.(ppt|pptx)$/.test(n)) return 'fa-file-powerpoint';
  if (/\.(zip|rar|7z)$/.test(n)) return 'fa-file-zipper';
  if (/\.(txt|csv|json)$/.test(n)) return 'fa-file-lines';
  return 'fa-file';
}
function formatRemainingDays(ts) {
  const diff = ts - Date.now();
  if (diff <= 0) return 'Expired';
  const days = Math.ceil(diff / 86400000);
  return days <= 1 ? '<1 hari lagi' : `${days} hari lagi`;
}
const levelFromXP = (xp) => Math.max(1, Math.min(MAX_LEVEL, Math.floor(xp / XP_PER_LEVEL)));

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ═══════════════════════════════════════════════════════════════════
   NAVIGATION
   ═══════════════════════════════════════════════════════════════════ */
function go(screenId) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const screen = $(screenId);
  if (!screen) return;
  screen.classList.add('active');
  screen.scrollTop = 0;
  const isDashboard = screenId === 'dashboard';
  $('bottomNav').classList.toggle('show', isDashboard);
  if (screenId === 'loading') { startLoading(); }
  else if (isDashboard) { loadDashboard(); startCarousel(); }
  else { stopCarousel(); stopChatPolling(); }
}

function switchTab(tab) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + tab));
  const dash = $('dashboard');
  dash.classList.toggle('chat-mode', tab === 'chat');
  if (tab !== 'chat') dash.scrollTop = 0;
  if (tab === 'tools') renderTools();
  if (tab === 'chat') { scrollMessagesToBottom(); startChatPolling(); }
  else { closePicker(); stopChatPolling(); }
}

function togglePass(btn) {
  const input = $('password');
  const icon = btn.querySelector('i');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  icon.classList.toggle('fa-eye', !show);
  icon.classList.toggle('fa-eye-slash', show);
}

/* ═══════════════════════════════════════════════════════════════════
   AUTH
   ═══════════════════════════════════════════════════════════════════ */
async function doLogin(e) {
  e.preventDefault();
  const username = $('username').value.trim();
  const password = $('password').value.trim();
  const msg = $('loginMsg');

  if (!username || !password) {
    msg.textContent = 'Username & password wajib diisi';
    return false;
  }
  msg.style.color = '#9ba1ac';
  msg.textContent = 'Menghubungi server...';

  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: { username, password }
    });

    if (data.user?.is_admin === true) {
      msg.style.color = '#ffb400';
      msg.textContent = 'Admin harap login lewat /admin panel';
      return false;
    }

    setToken(data.token);
    state.user = { ...state.user, ...(data.user || {}), username: data.user?.username || username };
    msg.style.color = '#18e36b';
    msg.textContent = 'Login berhasil...';
    setTimeout(() => { msg.textContent = ''; go('loading'); }, 500);
  } catch (err) {
    msg.style.color = '#ff5c63';
    msg.textContent = err.message || 'Login gagal';
  }
  return false;
}

function logout() {
  clearToken();
  stopChatPolling();
  stopCarousel();
  go('landing');
}

/* ═══════════════════════════════════════════════════════════════════
   LOADING
   ═══════════════════════════════════════════════════════════════════ */
let loadingTimer = null, loadingInterval = null, loadingDone = false;

function startLoading() {
  loadingDone = false;
  clearTimeout(loadingTimer);
  clearInterval(loadingInterval);
  const bar = $('progressBar'), txt = $('percentText');
  let percent = 0;
  bar.style.width = '0%'; txt.textContent = '0%';
  loadingInterval = setInterval(() => {
    percent = Math.min(100, percent + 2);
    bar.style.width = percent + '%'; txt.textContent = percent + '%';
    if (percent >= 100) clearInterval(loadingInterval);
  }, 40);
  loadingTimer = setTimeout(finishLoading, 3000);
}
function skipLoading() { finishLoading(); }
function finishLoading() {
  if (loadingDone) return;
  loadingDone = true;
  clearTimeout(loadingTimer); clearInterval(loadingInterval);
  setTimeout(() => go('dashboard'), 150);
}

/* ═══════════════════════════════════════════════════════════════════
   DATA LOADING
   ═══════════════════════════════════════════════════════════════════ */
async function loadDashboard() {
  try {
    const [user, tools, products, payMethods, notifications] = await Promise.all([
      api('/api/user/me'),
      api('/api/tools').catch(() => ({ tools: [] })),
      api('/api/products').catch(() => ({ products: [] })),
      api('/api/payment/methods').catch(() => ({ methods: [] })),
      api('/api/notifications').catch(() => ({ notifications: [] }))
    ]);
    state.user          = { ...state.user, ...user };
    state.tools         = tools.tools || [];
    state.products      = products.products || [];
    state.payMethods    = payMethods.methods || [];
    state.notifications = notifications.notifications || [];
    renderUser(); renderStats(); renderXP(); renderTools();
    renderPayMethods(); renderProducts(); renderNotifications();
    renderBadgeSelector(); renderBalance();
  } catch (err) {
    toast('Gagal memuat: ' + err.message);
    if (err.status === 401 || err.status === 403) logout();
  }
}

/* ═══════════════════════════════════════════════════════════════════
   RENDERERS
   ═══════════════════════════════════════════════════════════════════ */
function renderUser() {
  const { username, badge, avatar_url, owned_badges } = state.user;
  $('topUsername').textContent = username || 'user';
  setAvatar(avatar_url || '');
  const b = BADGES[badge] || BADGES.basic;
  const chip = $('topBadge');
  FX_CLASSES.forEach((c) => chip.classList.remove(c));
  if (b.member && owned_badges.includes(badge)) chip.classList.add(b.fx);
  chip.style.color = b.color;
  chip.querySelector('i').className = 'fa-solid ' + b.icon;
  const nameEl = $('topUsername');
  if (b.member && owned_badges.includes(badge)) {
    nameEl.style.setProperty('--neon', b.color);
    nameEl.classList.add('neon-text');
  } else {
    nameEl.classList.remove('neon-text');
    nameEl.style.removeProperty('--neon');
  }
  const mini = $('topAvatarMini');
  FX_CLASSES.forEach((c) => mini.classList.remove(c));
  if (b.member && owned_badges.includes(badge)) mini.classList.add(b.fx);
  let sub = `member • ${b.name.toLowerCase()}`;
  if (b.member && badge === 'special' && state.user.special_expiry) {
    sub += ` • ${formatRemainingDays(new Date(state.user.special_expiry).getTime())}`;
  }
  const subEl = $('topBadgeSub');
  subEl.textContent = sub;
  subEl.style.color = b.member ? b.color : '';
}
function renderStats() {
  const s = state.user.stats || {};
  $('statActive').textContent = String(s.active || 0).padStart(2, '0');
  $('statSuccess').textContent = String(s.success || 0).padStart(2, '0');
  $('statPending').textContent = String(s.pending || 0).padStart(2, '0');
}
function renderXP() { renderXPFrom(state.user.xp || 0); }
function renderXPFrom(xpValue) {
  const level = levelFromXP(xpValue);
  const inLevel = xpValue % XP_PER_LEVEL;
  $('levelBadge').textContent = level;
  $('levelLabel').textContent = 'Level ' + level;
  $('xpLabel').textContent = `${inLevel} / ${XP_PER_LEVEL} XP`;
  $('xpBar').style.width = (inLevel / XP_PER_LEVEL * 100) + '%';
  $('xpTotalLabel').textContent = `Total ${xpValue.toLocaleString('id-ID')} XP • Max ${MAX_XP.toLocaleString('id-ID')}`;
}
function animateXPTo(targetXP, duration = 800) {
  if (state.xpAnimFrame) cancelAnimationFrame(state.xpAnimFrame);
  const startXP = state.user.xp;
  const diff = targetXP - startXP;
  if (diff === 0) { renderXPFrom(targetXP); return; }
  const bar = $('xpBar');
  bar.classList.add('pulse');
  setTimeout(() => bar.classList.remove('pulse'), 820);
  const startTime = performance.now();
  const step = (now) => {
    const t = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    renderXPFrom(Math.round(startXP + diff * eased));
    if (t < 1) { state.xpAnimFrame = requestAnimationFrame(step); }
    else { state.user.xp = targetXP; renderXPFrom(targetXP); state.xpAnimFrame = null; }
  };
  state.xpAnimFrame = requestAnimationFrame(step);
}
function renderTools() {
  const grid = $('toolsGrid');
  const tokenText = $('tokenText'), tokenCounter = $('tokenCounter');
  const { token_remaining: remaining, token_limit: limit } = state.user;
  if (limit === -1 || limit === null) {
    tokenText.textContent = '∞ UNLIMITED';
    tokenCounter.classList.add('unlimited');
  } else {
    tokenText.textContent = `${remaining} / ${limit}`;
    tokenCounter.classList.remove('unlimited');
  }
  if (!state.tools.length) {
    grid.innerHTML = `<div class="tools-empty"><div class="empty-icon"><i class="fa-solid fa-toolbox"></i></div><strong>NO TOOLS YET</strong><small>Admin belum menambahkan tools apapun.</small><span class="empty-tag">COMING SOON</span></div>`;
    return;
  }
  grid.innerHTML = state.tools.map((t) => `
    <button class="tool${t.locked ? ' locked' : ''}" onclick="openTool('${esc(t.id)}')">
      <i class="fa-solid ${esc(t.icon || 'fa-wrench')}" style="color:${esc(t.color || '#e8eaee')}"></i>
      <b>${esc(t.name)}</b>
      <span class="${t.locked ? 'tool-locked-text' : 'tool-unlocked-text'}">${t.locked ? 'LOCKED' : 'UNLOCKED'}</span>
      <em class="tool-desc">${esc(t.desc || '')}</em>
    </button>
  `).join('');
}
function renderPayMethods() {
  const grid = $('payMethodsGrid');
  if (!state.payMethods.length) {
    grid.innerHTML = '<p style="grid-column:1/-1;color:#9ba1ac;font-size:11px;text-align:center">Belum ada metode pembayaran</p>';
    return;
  }
  grid.innerHTML = state.payMethods.map((m) => `
    <button class="pay-method" data-method="${esc(m.code)}">
      <i class="fa-solid ${esc(m.icon || 'fa-wallet')}"></i> ${esc(m.name)}
    </button>
  `).join('');
}
function renderProducts() {
  const grid = $('productGrid');
  if (!state.products.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon"><i class="fa-solid fa-store"></i></div><strong>BELUM ADA PRODUK</strong><small>Admin belum menambahkan produk.</small></div>`;
    return;
  }
  grid.innerHTML = state.products.map((p) => `
    <div class="product-card">
      ${p.tag ? `<span class="p-tag">${esc(p.tag)}</span>` : ''}
      <div class="p-icon" style="color:${esc(p.color || '#fff')}"><i class="${esc(p.icon || 'fa-box')}"></i></div>
      <b>${esc(p.name)}</b>
      <div class="p-desc">${esc(p.desc || '')}</div>
      <div class="p-footer">
        <span class="p-price">${fmtRp(p.price)}</span>
        <button class="p-add" onclick="buyProduct(${Number(p.id)})" aria-label="Buy"><i class="fa-solid fa-cart-plus"></i></button>
      </div>
    </div>
  `).join('');
}
function renderNotifications() {
  const list = $('notifList'), badge = $('navNotifBadge'), countEl = $('notifCount');
  if (!state.notifications.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="fa-solid fa-bell-slash"></i></div><strong>TIDAK ADA NOTIFIKASI</strong><small>Semua sudah dibaca.</small></div>`;
    badge.style.display = 'none';
    countEl.textContent = '0 BARU';
    return;
  }
  const unread = state.notifications.filter((n) => !n.read).length;
  if (unread > 0) { badge.style.display = ''; badge.textContent = unread; } else { badge.style.display = 'none'; }
  countEl.textContent = `${unread} BARU`;
  const iconMap = { info: 'fa-circle-info', ok: 'fa-circle-check', warn: 'fa-triangle-exclamation' };
  const clsMap = { info: 'info', ok: 'ok', warn: '' };
  list.innerHTML = state.notifications.map((n) => `
    <div class="notif ${clsMap[n.type] || ''}">
      <i class="fa-solid ${iconMap[n.type] || 'fa-bell'}"></i>
      <div class="meta">
        <strong>${esc(n.title || '')}</strong>
        <small>${esc(n.message || '')}</small>
        <em>${esc(n.time_ago || '')}</em>
      </div>
    </div>
  `).join('');
}
function renderBadgeSelector() {
  const grid = $('badgeSelectorGrid');
  grid.innerHTML = '';
  BADGE_ORDER.forEach((key) => {
    const b = BADGES[key];
    const owned = state.user.owned_badges.includes(key);
    const equipped = state.user.badge === key;
    let statusText, statusClass;
    if (equipped)     { statusText = 'EQUIPPED';      statusClass = 'equipped'; }
    else if (owned)   { statusText = 'TAP TO USE';    statusClass = 'owned'; }
    else if (key === 'basic')   { statusText = 'FREE';              statusClass = 'gratis'; }
    else if (key === 'special') { statusText = 'Rp 17.000 • 3mo';   statusClass = 'vip'; }
    else              { statusText = fmtRp(b.price);  statusClass = ''; }
    const cornerTag = b.level > 1 ? `LV ${b.level}` : '';
    let expiryMini = '';
    if (key === 'special' && owned && state.user.special_expiry) {
      const ts = new Date(state.user.special_expiry).getTime();
      expiryMini = `<span class="expiry-mini"><i class="fa-solid fa-hourglass-half"></i> ${formatRemainingDays(ts)}</span>`;
    }
    const fxClass = owned ? b.fx : 'fx-basic';
    const card = document.createElement('button');
    card.className = 'badge-card' + (owned ? ' owned' : '') + (equipped ? ' equipped' : '') + (!owned && key !== 'basic' ? ' not-owned' : '');
    card.style.setProperty('--item-color', b.color);
    card.onclick = () => handleBadgeClick(key);
    card.innerHTML = `
      ${cornerTag ? `<span class="badge-tag">${cornerTag}</span>` : ''}
      <div class="badge-icon ${fxClass}"><i class="fa-solid ${b.icon}"></i></div>
      <div class="badge-name ${fxClass}">${b.name}</div>
      <div class="badge-tier">${b.tier}</div>
      <span class="badge-status ${statusClass}">${statusText}</span>
      ${expiryMini}
    `;
    grid.appendChild(card);
  });
}
function renderBalance() {
  const formatted = fmtRp(state.user.balance);
  $('balanceAmount').textContent = formatted;
  $('shopBalance').textContent = formatted;
  $('badgeModalBalance').textContent = formatted;
}

/* ═══════════════════════════════════════════════════════════════════
   USER ACTIONS
   ═══════════════════════════════════════════════════════════════════ */
async function openTool(id) {
  try {
    const res = await api(`/api/tools/${encodeURIComponent(id)}/use`, { method: 'POST' });
    toast(res.message || 'Tool dibuka');
    if (res.token_remaining !== undefined) state.user.token_remaining = res.token_remaining;
    if (res.xp !== undefined) { state.user.xp = res.xp; animateXPTo(res.xp, 700); }
    renderTools();
  } catch (err) { toast('❌ ' + err.message); }
}

function openDeposit() {
  state.deposit = { amount: 0, method: '' };
  document.querySelectorAll('.amount-chip').forEach((c) => c.classList.remove('selected'));
  document.querySelectorAll('.pay-method').forEach((c) => c.classList.remove('selected'));
  renderPayMethods();
  $('depositStep1').style.display = 'block';
  $('depositStep2').style.display = 'none';
  $('depositTitle').textContent = 'DEPOSIT BALANCE';
  $('depositModal').classList.add('show');
}
function closeDeposit() { $('depositModal').classList.remove('show'); }

async function submitDepositRequest() {
  if (!state.deposit.amount) { toast('Pilih jumlah deposit dulu'); return; }
  if (!state.deposit.method) { toast('Pilih metode pembayaran'); return; }
  try {
    await api('/api/payment/deposit', {
      method: 'POST',
      body: { amount: state.deposit.amount, method: state.deposit.method }
    });
    $('depositAmountLabel').textContent = fmtRp(state.deposit.amount);
    const m = state.payMethods.find((x) => x.code === state.deposit.method) || {};
    $('paymentDetailBox').innerHTML = buildPaymentDetailHTML(m);
    $('depositStep1').style.display = 'none';
    $('depositStep2').style.display = 'block';
    $('depositTitle').textContent = 'INSTRUKSI PEMBAYARAN';
    toast('Deposit dibuat, tunggu konfirmasi admin');
  } catch (err) { toast('Gagal: ' + err.message); }
}

function buildPaymentDetailHTML(m) {
  const header = (label) => `<div style="font-size:10px;letter-spacing:.20em;font-weight:800;color:#9ba1ac;margin-bottom:10px">${label}</div>`;
  if (m.type === 'qris') {
    return `${header('SCAN QRIS')}
      <img src="${esc(m.qris_url || '')}" alt="QRIS" style="max-width:220px;width:100%;border-radius:12px;border:1px solid var(--line);background:#fff;padding:8px">
      <div style="font-size:11px;margin-top:12px;color:#fff">${esc(m.merchant || '')}</div>
      <div style="font-size:10px;color:#9ba1ac;margin-top:4px">NMID: ${esc(m.nmid || '-')}</div>`;
  }
  if (m.type === 'bank') {
    return `${header('TRANSFER BANK')}
      <div style="font-size:14px;font-weight:800;color:var(--cyan);margin-bottom:6px">${esc(m.bank_name || '')}</div>
      <div style="font-size:18px;font-weight:800;color:#fff;letter-spacing:.08em;margin:8px 0">${esc(m.account_number || '')}</div>
      <div style="font-size:11px;color:#9ba1ac">a/n ${esc(m.account_name || '')}</div>`;
  }
  if (m.type === 'ewallet') {
    return `${header('E-WALLET')}
      <div style="font-size:14px;font-weight:800;color:var(--purple);margin-bottom:6px">${esc(m.wallet_name || 'DANA')}</div>
      <div style="font-size:18px;font-weight:800;color:#fff;letter-spacing:.08em;margin:8px 0">${esc(m.phone || '')}</div>
      <div style="font-size:11px;color:#9ba1ac">a/n ${esc(m.account_name || '')}</div>`;
  }
  return `<p style="color:#9ba1ac;font-size:11px">Detail pembayaran tidak tersedia</p>`;
}

function openShop() { renderBalance(); renderProducts(); $('shopModal').classList.add('show'); }
function closeShop() { $('shopModal').classList.remove('show'); }

async function buyProduct(id) {
  const product = state.products.find((x) => x.id === id);
  if (!product) return;
  if (state.user.balance < product.price) { toast(`Saldo kurang. Butuh ${fmtRp(product.price)}`); return; }
  if (!confirm(`Beli "${product.name}" seharga ${fmtRp(product.price)}?`)) return;
  try {
    const res = await api(`/api/products/${id}/buy`, { method: 'POST' });
    if (res.balance !== undefined) { state.user.balance = res.balance; renderBalance(); }
    toast('✅ Pembelian sukses!');
  } catch (err) { toast('❌ ' + err.message); }
}

function openBadgeSelector() { renderBalance(); renderBadgeSelector(); $('badgeModal').classList.add('show'); }
function closeBadgeSelector() { $('badgeModal').classList.remove('show'); }

async function handleBadgeClick(key) {
  const b = BADGES[key];
  if (!b) return;
  if (state.user.badge === key) { toast(`${b.name} sedang dipakai`); return; }
  const owned = state.user.owned_badges.includes(key);
  if (owned) {
    try {
      const res = await api('/api/badges/equip', { method: 'POST', body: { badge: key } });
      applyBadgeResponse(res);
      toast(`✅ ${b.name} dipakai`);
    } catch (err) { toast('❌ ' + err.message); }
    return;
  }
  if (b.price === 0) { toast('Badge ini gratis'); return; }
  if (state.user.balance < b.price) { toast(`Saldo kurang. Butuh ${fmtRp(b.price)}`); return; }
  if (!confirm(`Beli ${b.name} seharga ${fmtRp(b.price)}?`)) return;
  try {
    const res = await api('/api/badges/buy', { method: 'POST', body: { badge: key } });
    applyBadgeResponse(res);
    toast(`🎉 ${b.name} aktif!`);
  } catch (err) { toast('❌ ' + err.message); }
}

function applyBadgeResponse(res) {
  if (res.balance !== undefined)         state.user.balance = res.balance;
  if (res.badge)                         state.user.badge = res.badge;
  if (res.owned_badges)                  state.user.owned_badges = res.owned_badges;
  if (res.token_limit !== undefined)     state.user.token_limit = res.token_limit;
  if (res.token_remaining !== undefined) state.user.token_remaining = res.token_remaining;
  if (res.special_expiry)                state.user.special_expiry = res.special_expiry;
  if (res.xp !== undefined) { animateXPTo(res.xp, 1200); state.user.xp = res.xp; }
  renderUser(); renderBalance(); renderBadgeSelector(); renderTools(); refreshChat();
}

async function handleAvatarUpload(file) {
  if (!['image/png', 'image/jpeg', 'image/jpg', 'image/gif'].includes(file.type)) { toast('Format harus PNG/JPG/GIF'); return; }
  if (file.size > 2 * 1024 * 1024) { toast('Maks 2MB'); return; }
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const res = await api('/api/user/avatar', {
        method: 'POST',
        body: { avatar_base64: ev.target.result },
        timeout: API_UPLOAD_MS
      });
      state.user.avatar_url = res.avatar_url || ev.target.result;
      setAvatar(state.user.avatar_url);
      toast('Avatar tersimpan ✅');
      refreshChat();
    } catch (err) { toast('Gagal upload: ' + err.message); }
  };
  reader.readAsDataURL(file);
}

function setAvatar(url) {
  const img = $('topAvatarImg'), icon = $('topAvatarIcon');
  if (!img || !icon) return;
  if (url) { img.src = url; img.hidden = false; icon.style.display = 'none'; }
  else { img.hidden = true; img.src = ''; icon.style.display = ''; }
}

/* ═══════════════════════════════════════════════════════════════════
   CAROUSEL
   ═══════════════════════════════════════════════════════════════════ */
function startCarousel() {
  stopCarousel();
  const slides = document.querySelectorAll('.video-carousel .slide');
  const dots   = document.querySelectorAll('.video-carousel .dot');
  if (!slides.length) return;
  const goToSlide = (index) => {
    slides.forEach((s, i) => s.classList.toggle('active', i === index));
    dots.forEach((d, i) => d.classList.toggle('active', i === index));
    state.carouselIndex = index;
    const activeVideo = slides[index].querySelector('video.slide-video');
    if (activeVideo) activeVideo.play().catch(() => {});
  };
  goToSlide(0);
  state.carouselTimer = setInterval(() => goToSlide((state.carouselIndex + 1) % slides.length), CAROUSEL_MS);
  dots.forEach((dot, i) => { dot.onclick = () => { goToSlide(i); startCarousel(); }; });
}
function stopCarousel() {
  if (state.carouselTimer) { clearInterval(state.carouselTimer); state.carouselTimer = null; }
}

/* ═══════════════════════════════════════════════════════════════════
   CHAT
   ═══════════════════════════════════════════════════════════════════ */
const EMOJI_CATEGORIES = {
  'Smileys':  ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕'],
  'Gestures': ['👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤝','🙏','💪','🦾','✍️','💅','👏','🙌','👐','🤲'],
  'Love':     ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟'],
  'Symbols':  ['✨','⭐','🌟','💫','⚡','🔥','💥','💢','💦','💨','🎉','🎊','🎈','🎁','🏆','👑','💎','⚔️','🛡️','🎯']
};
const STICKER_LIST = ['😎','🤩','🥳','😭','🤯','😱','🤔','👑','💎','⭐','🔥','💯','🎉','🚀','💀','🤖'];

function renderChatMessage(msg) {
  const isMe = msg.me;
  const badgeKey = msg.badge || 'basic';
  const b = BADGES[badgeKey] || BADGES.basic;
  const fxClass = b.member ? b.fx : '';
  let avatarHTML;
  if (isMe && state.user.avatar_url) avatarHTML = `<img src="${esc(state.user.avatar_url)}" alt="">`;
  else if (msg.avatar_url) avatarHTML = `<img src="${esc(msg.avatar_url)}" alt="">`;
  else avatarHTML = `<i class="fa-solid fa-user"></i>`;
  let bodyHTML;
  if (msg.type === 'image') {
    bodyHTML = `<div class="msg-image"><img src="${esc(msg.content || '')}" alt="image">${msg.isGif ? '<span class="gif-badge">GIF</span>' : ''}</div>`;
  } else if (msg.type === 'sticker') {
    bodyHTML = `<div class="msg-sticker">${esc(msg.content || '')}</div>`;
  } else if (msg.type === 'file') {
    bodyHTML = `<a class="msg-file" href="${esc(msg.content || '')}" download="${esc(msg.fileName || 'file')}">
      <div class="msg-file-icon"><i class="fa-solid ${fileIcon(msg.fileName, msg.fileType)}"></i></div>
      <div class="msg-file-info"><strong>${esc(msg.fileName || 'file')}</strong><small>${fmtBytes(msg.fileSize)}</small></div>
      <i class="fa-solid fa-download msg-file-dl"></i>
    </a>`;
  } else {
    bodyHTML = `<div class="msg-text">${linkify(esc(msg.content || ''))}</div>`;
  }
  const nameClass = b.member ? 'msg-name neon-text' : 'msg-name';
  const nameStyle = b.member ? `style="color:${b.color};--neon:${b.color}"` : '';
  return `
    <div class="msg ${isMe ? 'msg-me' : ''}">
      <div class="msg-avatar-wrap ${fxClass}"><div class="msg-avatar">${avatarHTML}</div></div>
      <div class="msg-body">
        <div class="msg-head">
          <strong class="${nameClass}" ${nameStyle}>${esc(msg.username || 'user')}</strong>
          <span class="badge-chip xsmall ${fxClass}"><i class="fa-solid ${b.icon}"></i></span>
          <span class="msg-time">${esc(msg.time || '')}</span>
        </div>
        ${bodyHTML}
      </div>
    </div>`;
}
function renderMessages() {
  const box = $('roomMessages');
  if (!box) return;
  box.innerHTML = state.chat.map(renderChatMessage).join('');
  scrollMessagesToBottom();
}
function scrollMessagesToBottom() {
  const box = $('roomMessages');
  if (box) box.scrollTop = box.scrollHeight;
}
async function refreshChat() {
  try {
    const data = await api('/api/chat/messages');
    state.chat = (data.messages || []).map((m) => ({
      me: m.username === state.user.username,
      username: m.username || 'user',
      badge: m.badge || 'basic',
      avatar_url: m.avatar_url || '',
      type: m.type || 'text',
      content: m.content,
      text: m.type === 'text' || !m.type ? m.content : '',
      fileName: m.fileName || m.file_name || 'file',
      fileSize: m.fileSize ?? m.file_size,
      fileType: m.fileType || m.file_type || '',
      time: timeShort(m.created_at || m.createdAt)
    }));
    renderMessages();
    if (data.online !== undefined) $('onlineCount').textContent = `${data.online} online`;
  } catch (_) {}
}
function startChatPolling() {
  stopChatPolling();
  refreshChat();
  state.chatPollTimer = setInterval(refreshChat, CHAT_POLL_MS);
}
function stopChatPolling() {
  if (state.chatPollTimer) { clearInterval(state.chatPollTimer); state.chatPollTimer = null; }
}
async function sendChatMessage(payload) {
  const body = { content: payload.text || payload.content, type: payload.type || 'text' };
  if (payload.type === 'file') {
    body.fileName = payload.fileName; body.fileSize = payload.fileSize; body.fileType = payload.fileType;
  }
  const isBig = payload.type === 'image' || payload.type === 'file';
  const timeout = isBig ? API_UPLOAD_MS : API_TIMEOUT_MS;
  try {
    await api('/api/chat/messages', { method: 'POST', body, timeout });
    await refreshChat();
  } catch (err) { toast('Gagal kirim: ' + err.message); }
}
function sendChatText() {
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text) return;
  sendChatMessage({ text });
  input.value = '';
}
function handleChatFile(file) {
  if (file.size > 10 * 1024 * 1024) { toast('Maks 10MB'); return; }
  const reader = new FileReader();
  reader.onload = (ev) => {
    if (file.type.startsWith('image/')) {
      sendChatMessage({ type: 'image', content: ev.target.result, isGif: file.type === 'image/gif' });
    } else {
      sendChatMessage({ type: 'file', content: ev.target.result, fileName: file.name, fileSize: file.size, fileType: file.type });
    }
  };
  reader.readAsDataURL(file);
}

/* ═══════════════════════════════════════════════════════════════════
   PICKER
   ═══════════════════════════════════════════════════════════════════ */
function togglePicker(tab) {
  const sheet = $('pickerSheet');
  if (state.pickerOpen && state.pickerTab === tab) { closePicker(); return; }
  switchPickerTab(tab || 'emoji', true);
  sheet.classList.add('show');
  state.pickerOpen = true;
  setTimeout(scrollMessagesToBottom, 60);
}
function closePicker() {
  const sheet = $('pickerSheet');
  if (sheet) sheet.classList.remove('show');
  state.pickerOpen = false;
}
function switchPickerTab(tab, skipToggle) {
  state.pickerTab = tab;
  document.querySelectorAll('.picker-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  const body = $('pickerBody');
  if (tab === 'emoji') body.innerHTML = renderEmojiPicker();
  else if (tab === 'sticker') body.innerHTML = renderStickerPicker();
  else body.innerHTML = renderPickerEmpty('GIF');
  if (!skipToggle) { $('pickerSheet').classList.add('show'); state.pickerOpen = true; }
  body.scrollTop = 0;
}
function renderPickerEmpty(label) {
  return `<div class="picker-empty"><div class="picker-empty-icon"><i class="fa-solid fa-cloud-arrow-down"></i></div><strong>${label} BELUM TERSEDIA</strong><small>Nantikan update berikutnya.</small><span class="picker-empty-tag">COMING SOON</span></div>`;
}
function renderEmojiPicker() {
  const cats = Object.keys(EMOJI_CATEGORIES);
  if (!cats.length) return renderPickerEmpty('EMOJI');
  return cats.map((cat) => `<div class="emoji-section-title">${cat}</div><div class="emoji-grid">${EMOJI_CATEGORIES[cat].map((e) => `<button class="emoji-btn" type="button" onclick="insertEmoji('${e}')">${e}</button>`).join('')}</div>`).join('');
}
function renderStickerPicker() {
  if (!STICKER_LIST.length) return renderPickerEmpty('STICKER');
  return `<div class="emoji-section-title">Tap sticker untuk kirim</div><div class="sticker-grid">${STICKER_LIST.map((s) => `<button class="sticker-btn" type="button" onclick="sendSticker('${s}')">${s}</button>`).join('')}</div>`;
}
function insertEmoji(emoji) {
  const input = $('chatInput');
  if (!input) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
  const pos = start + emoji.length;
  input.setSelectionRange(pos, pos);
  input.focus();
}
function sendSticker(emoji) { sendChatMessage({ type: 'sticker', content: emoji }); closePicker(); }

/* ═══════════════════════════════════════════════════════════════════
   EVENT WIRING
   ═══════════════════════════════════════════════════════════════════ */
$('avatarUpload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleAvatarUpload(file);
  e.target.value = '';
});
$('chatFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleChatFile(file);
  e.target.value = '';
});
$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatText(); }
});
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.amount-chip');
  if (chip) {
    document.querySelectorAll('.amount-chip').forEach((c) => c.classList.remove('selected'));
    chip.classList.add('selected');
    state.deposit.amount = parseInt(chip.dataset.amount, 10);
  }
  const method = e.target.closest('.pay-method');
  if (method) {
    document.querySelectorAll('.pay-method').forEach((c) => c.classList.remove('selected'));
    method.classList.add('selected');
    state.deposit.method = method.dataset.method;
  }
});

/* ═══════════════════════════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', async () => {
  if (authToken) {
    try {
      await api('/api/user/me');
      go('loading');
      return;
    } catch (err) {
      if (err.status === 401 || err.status === 403) clearToken();
    }
  }
  go('landing');
});
