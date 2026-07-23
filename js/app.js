/* ===== 界面与交互 ===== */
'use strict';

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtM(n) { return (Math.round(n * 100) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pad2(n) { return String(n).padStart(2, '0'); }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function dateAdd(dstr, days) {
  const d = new Date(dstr + 'T00:00:00'); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function weekRange(dstr) {  // 周一 ~ 周日
  const d = new Date(dstr + 'T00:00:00');
  const wd = (d.getDay() + 6) % 7;
  const start = dateAdd(dstr, -wd);
  return [start, dateAdd(start, 6)];
}
function weekdayCN(dstr) { return '日一二三四五六'[new Date(dstr + 'T00:00:00').getDay()]; }
/* 负债的显示：负数意味着记录到的还款比借入多（多见于早期没记「借」），
   这不代表有钱，所以按 0 显示，别抬高净资产；把原委放进提示里。 */
function debtLabel(v) {
  if (v > 0) return { text: fmtM(v), color: 'var(--danger)', tip: '' };
  return { text: '0.00', color: 'var(--text-3)', tip: v < 0 ? `记录里还款比借入多 ${fmtM(-v)}（多为早期花呗还款没记「借」）。若开始记账前确实有欠款，在账户页填「期初负债」即可。` : '' };
}
/* 净还金额（还款超出借入的部分），0 表示没有 */
function netRepaid(v) { return v < 0 ? -v : 0; }
/* 收入分类关键词作为解析提示（排除与支出分类重复的词，避免误判） */
function incomeHints() {
  const expKws = new Set(Store.getCategories('expense').flatMap(c => c.keywords || []));
  return Store.getCategories('income').flatMap(c => c.keywords || []).filter(kw => !expKws.has(kw));
}

/* ---------- 全局状态 ---------- */
const S = {
  tab: 'record',              // record | accounts | analysis | settings
  anaSub: 'detail',           // 数据分析的子页：detail | stats | compare
  setSub: 'general',          // 设置的子页：general | category
  finSub: 'budget',           // 财务管理的子页：budget | goals | accounts
  finPeriod: 'month',         // 财务管理看月还是看年
  finAnchor: todayStr(),      // 财务管理当前锚点日期
  finChart: 'bar',            // 中位数/平均数图形态：bar | line
  goalYear: todayStr().slice(0, 4),   // 存钱计划查看的年份
  recordMode: 'expense',      // 记账页：expense | income | transfer
  recordDate: todayStr(),
  parsed: [],
  manualType: 'expense',
  manualAcct: '',             // 手动记账选的账户
  detailMonth: todayStr().slice(0, 7),
  detailFilter: 'all',
  detailSearch: '',
  editingId: null,
  statsPeriod: 'month',       // day | week | month | year
  statsAnchor: todayStr(),
  statsType: 'expense',
  statsChart: 'pie',          // pie | bar | line
  cmpMode: 'year',            // year | expense | income | catAll
  cmpYears: null,             // Set
  cmpCat: '',
  cmpChart: 'bar',
  cmpCatType: 'expense',
  cmpMini: 'bar',             // 分类矩阵的迷你图形态
  catOpen: null,              // 分类页展开的分类 id
  catType: 'expense',         // 分类页当前显示的类型
};

/* ---------- 日期跳转选择器 ----------
   period: day | week | month | year
   anchor: 'YYYY-MM-DD'
   返回新的锚点日期，取消返回 null。
   年份行取自实际有数据的年份（再补上当前年和锚点年），月份格子标出当月支出，
   这样一眼能看出哪个月有账、有多少。 */
async function pickPeriod(period, anchor) {
  const dataYears = Store.years().map(Number);
  const nowY = new Date().getFullYear();
  const anchorY = +anchor.slice(0, 4);
  const years = [...new Set([...dataYears, nowY, anchorY])].sort((a, b) => a - b);

  const needDay = period === 'day' || period === 'week';
  let sel = anchor;                                  // 始终维护一个完整日期，年/月/日三处共用同一个状态
  const Y = () => +sel.slice(0, 4);
  const M = () => +sel.slice(5, 7);
  const D = () => +sel.slice(8, 10);
  /* 换年换月后原来的「日」可能不存在（例如 1月31日 → 2月），夹到当月最后一天 */
  const setYM = (y, m) => {
    const last = new Date(y, m, 0).getDate();
    sel = `${y}-${pad2(m)}-${pad2(Math.min(D(), last))}`;
  };
  const monthSum = (yy, mm) => Store.totals(Store.inMonth(`${yy}-${pad2(mm)}`)).expense;

  const body = document.createElement('div');
  const paint = () => {
    const yearRow = `
      <div class="pk-sec">
        <div class="pk-label">年份</div>
        <div class="pk-years">${years.map(v => `<button class="pk-y ${v === Y() ? 'on' : ''}" data-y="${v}">${v}年</button>`).join('')}</div>
      </div>`;
    const monthGrid = period === 'year' ? '' : `
      <div class="pk-sec">
        <div class="pk-label">月份（下方数字是当月支出）</div>
        <div class="pk-months">
          ${Array.from({ length: 12 }, (_, i) => {
            const mm = i + 1, s = monthSum(Y(), mm);
            return `<button class="pk-m ${mm === M() ? 'on' : ''} ${s ? '' : 'empty'}" data-m="${mm}">
              <div class="pk-mn">${mm}月</div>
              <div class="pk-ma">${s ? Charts.fmt(s) : '—'}</div>
            </button>`;
          }).join('')}
        </div>
      </div>`;
    const dayJump = needDay ? `
      <div class="pk-sec">
        <div class="pk-label">${period === 'day' ? '具体哪一天' : '这一周里的任意一天'}</div>
        <div class="pk-jump"><input type="date" class="pk-date" value="${sel}"></div>
      </div>` : '';
    body.innerHTML = yearRow + monthGrid + dayJump;

    body.querySelectorAll('.pk-y').forEach(b => b.onclick = () => {
      setYM(+b.dataset.y, M());
      if (period === 'year') body._done(sel);            // 选年就是最终结果，不用再点确定
      else paint();
    });
    body.querySelectorAll('.pk-m').forEach(b => b.onclick = () => {
      setYM(Y(), +b.dataset.m);
      if (period === 'month') body._done(sel);           // 选完月直接跳，少点一次
      else paint();                                      // 日/周：把日期框同步到这个月
    });
    const di = body.querySelector('.pk-date');
    if (di) di.onchange = () => { if (di.value) { sel = di.value; paint(); } };
  };
  paint();

  const title = { day: '跳到某一天', week: '跳到某一周', month: '跳到某个月', year: '跳到某一年' }[period];
  return Modal.open({
    title, body, okText: '跳转',
    getValue: () => sel,
    onOpen: (mask, done) => { body._done = done; },
  });
}

/* ---------- 备份提醒条 ----------
   只在「自动备份做不到」的环境出现（主要是 iPhone/iPad 的 Safari）。
   那边浏览器不给网页无人值守写文件的权限，所以只能提醒你亲手点一下。 */
async function renderReminder() {
  const host = $('#remindHost');
  if (!host || S._remindHidden) { if (host) host.innerHTML = ''; return; }
  const r = await Backup.reminder();
  if (!r) { host.innerHTML = ''; return; }
  const when = r.never ? '还从没备份过' : `已经 <b>${r.days}</b> 天没备份了`;
  host.innerHTML = `
    <div class="remind-bar">
      <span class="rb-ico">⚠️</span>
      <span class="rb-t">你有 <b>${r.n}</b> 笔账${r.never ? '' : '，'}${when}。<br>
        这台设备不支持自动备份，请点右边存一份到「文件」或 iCloud 云盘。</span>
      <button class="btn small" id="rbGo">立即备份</button>
      <button class="rb-x" id="rbHide" title="本次不再提示">✕</button>
    </div>`;
  $('#rbGo').onclick = async () => {
    try {
      const res = await Backup.run({ interactive: true });
      if (res.ok) { toast('备份完成 → ' + res.where); render(); }
    } catch (err) { await Modal.alert('备份失败', err.message); }
  };
  $('#rbHide').onclick = () => { S._remindHidden = true; host.innerHTML = ''; };
}

/* ---------- 主渲染 ---------- */
function render() {
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === S.tab));
  renderReminder();
  renderLedgerChip();
  const v = $('#view');
  switch (S.tab) {
    case 'record': v.innerHTML = viewRecord(); bindRecord(); break;
    case 'accounts':   // 账户已并入财务管理，老入口重定向过去
      S.tab = 'finance'; S.finSub = 'accounts';
      v.innerHTML = viewFinance(); bindFinance(); break;
    case 'finance': v.innerHTML = viewFinance(); bindFinance(); break;
    case 'analysis': v.innerHTML = viewAnalysis(); bindAnalysis(); break;
    case 'settings': v.innerHTML = viewSettings(); bindSettings(); break;
  }
  const kb = Store.storageSize();
  $('#storageHint').textContent = `${Store.getEntries().length} 笔 · ${(kb / 1024).toFixed(0)}KB`;
}

/* 顶部账本切换标签 */
function renderLedgerChip() {
  const el = $('#ledgerName');
  if (!el) return;
  const a = Store.activeLedger();
  if (a === 'all') { el.textContent = '全部账本'; $('#ledgerChip').firstChild.textContent = '📚 '; }
  else { const l = Store.getLedger(a); el.textContent = l ? l.name : '全部账本'; $('#ledgerChip').firstChild.textContent = (l && l.icon ? l.icon : '📒') + ' '; }
}

/* 数据分析：明细 / 统计 / 对比 三个子页合到一个标签下 */
function viewAnalysis() {
  const subs = [['detail', '📋 明细'], ['stats', '📊 统计'], ['compare', '📈 对比']];
  const bar = `<div class="subtab-bar">${subs.map(([k, n]) =>
    `<button class="subtab ${S.anaSub === k ? 'on' : ''}" data-sub="${k}">${n}</button>`).join('')}</div>`;
  const inner = S.anaSub === 'stats' ? viewStats() : S.anaSub === 'compare' ? viewCompare() : viewDetail();
  return bar + inner;
}
function bindAnalysis() {
  $$('.subtab[data-sub]').forEach(b => b.onclick = () => { S.anaSub = b.dataset.sub; render(); });
  if (S.anaSub === 'stats') bindStats();
  else if (S.anaSub === 'compare') bindCompare();
  else bindDetail();
}

/* 个人中心：我的（资料/授权/联系作者）+ 常规（原「数据」页）+ 分类管理 */
function viewSettings() {
  const subs = [['general', '⚙️ 常规'], ['category', '🏷️ 分类'], ['me', '👤 我的']];
  const bar = `<div class="subtab-bar">${subs.map(([k, n]) =>
    `<button class="subtab ${S.setSub === k ? 'on' : ''}" data-sub="${k}">${n}</button>`).join('')}</div>`;
  const inner = S.setSub === 'category' ? viewCategory() : S.setSub === 'general' ? viewData() : viewMe();
  return bar + inner;
}
function bindSettings() {
  $$('.subtab[data-sub]').forEach(b => b.onclick = () => { S.setSub = b.dataset.sub; render(); });
  if (S.setSub === 'category') bindCategory();
  else if (S.setSub === 'general') bindData();
  else bindMe();
}

/* ---------- 我的（资料 + 授权 + 联系作者）---------- */
function viewMe() {
  const p = Store.getSettings().profile || {};
  const licReq = License.required();
  return `
  <div class="card">
    <h3>👤 我的资料</h3>
    <div class="sub">存在本机、不上传，仅作标识用（不是账号登录，换设备靠备份文件迁移）。</div>
    <label class="fld">昵称</label>
    <input type="text" id="pfName" value="${esc(p.name || '')}" placeholder="给自己起个名字">
    <label class="fld">手机号（可选）</label>
    <input type="text" id="pfPhone" value="${esc(p.phone || '')}" placeholder="仅本机保存" inputmode="tel">
    <label class="fld">邮箱（可选）</label>
    <input type="text" id="pfEmail" value="${esc(p.email || '')}" placeholder="仅本机保存" inputmode="email">
    <button class="btn block" id="pfSave">保存资料</button>
  </div>

  <div class="card" id="licenseCard">
    <h3>🔑 授权状态</h3>
    <div id="licBody"><div class="sub" style="margin:0">读取中…</div></div>
  </div>

  <div class="card">
    <h3>📮 联系作者</h3>
    <div class="sub">授权获取使用权限、程序优化建议、问题反馈，都欢迎联系。</div>
    ${contactBoxHtml()}
  </div>`;
}

/* 联系作者二维码区（个人中心 和 授权闸门 共用） */
function contactBoxHtml() {
  return `
    <div class="contact-box">
      <img class="contact-qr" src="icons/creator-qr.png" alt="作者微信二维码"
           onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
      <div class="contact-fallback" style="display:none">还没放二维码图片<br>
        <span style="font-size:.72rem">把作者微信二维码存成 icons/creator-qr.png 就会显示在这里</span>
      </div>
      <div class="contact-tip">微信扫码添加作者<br><span>获取授权码 · 提优化建议 · 反馈问题</span></div>
    </div>`;
}

/* 联系作者弹窗（授权闸门里用——那时候用户还进不了个人中心）*/
async function openContactModal() {
  const body = document.createElement('div');
  body.innerHTML = contactBoxHtml();
  await Modal.open({ title: '📮 联系作者', body, showCancel: false, okText: '关闭', getValue: () => true });
}

function bindMe() {
  $('#pfSave').onclick = () => {
    Store.updateSettings({ profile: { name: $('#pfName').value.trim(), phone: $('#pfPhone').value.trim(), email: $('#pfEmail').value.trim() } });
    toast('资料已保存');
  };
  renderLicenseBox();
}

async function renderLicenseBox() {
  const box = $('#licBody');
  if (!box) return;
  const st = await License.status();
  if (!st.required) {
    box.innerHTML = `<div class="lic-ok">✅ 本设备免授权，可直接使用<div class="sub" style="margin:4px 0 0">网页版 / iPhone 加到主屏幕不需要授权码。</div></div>`;
    return;
  }
  if (st.ok) {
    box.innerHTML = `
      <div class="lic-ok">✅ 已授权，感谢支持！</div>
      <label class="fld">本机机器码</label>
      <div class="path-box">${st.mc}</div>
      <button class="btn ghost small" id="licCopyMc" style="margin-top:8px">复制机器码</button>`;
    $('#licCopyMc').onclick = () => copyText(st.mc);
    return;
  }
  box.innerHTML = `
    <div class="lic-warn">⚠️ 未授权。把下面「机器码」发给作者，换取「授权码」后粘贴激活（一次授权，终身使用）。</div>
    <label class="fld">本机机器码（发给作者）</label>
    <div class="path-box" id="licMc">${st.mc}</div>
    <button class="btn ghost small" id="licCopyMc" style="margin:8px 0">复制机器码</button>
    <label class="fld">粘贴授权码</label>
    <textarea id="licInput" placeholder="把作者发来的授权码整段粘贴到这里" style="min-height:70px"></textarea>
    <button class="btn block" id="licActivate">激活</button>`;
  $('#licCopyMc').onclick = () => copyText(st.mc);
  $('#licActivate').onclick = async () => {
    const code = $('#licInput').value.trim();
    if (!code) { toast('请先粘贴授权码'); return; }
    const ok = await License.activate(code);
    if (ok) { toast('激活成功 🎉'); render(); }
    else await Modal.alert('激活失败', '授权码和本机机器码不匹配，请确认：\n1）机器码是否复制完整\n2）授权码是否为这台设备生成的\n3）授权码是否整段粘贴。');
  };
}

function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(() => toast('已复制')).catch(() => toast('复制失败，请手动选中'));
  } else {
    const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('已复制'); } catch (e) { toast('复制失败，请手动选中'); }
    ta.remove();
  }
}

/* 跳转到数据分析的某个子页（供各处「查看明细」用） */
function goDetail(filter) {
  if (filter !== undefined) S.detailFilter = filter;
  S.tab = 'analysis'; S.anaSub = 'detail'; render();
}

/* 顶部账本切换 / 快速新建 */
async function openLedgerPicker() {
  const body = document.createElement('div');
  const active = Store.activeLedger();
  const paint = () => {
    const ledgers = Store.getLedgers();
    const row = (id, icon, name, on, editable) =>
      `<div class="ledger-row ${on ? 'on' : ''}" data-id="${id}" style="display:flex;align-items:center;gap:8px">
         <button class="lr-pick" data-id="${id}" style="flex:1;display:flex;align-items:center;gap:8px;background:none;border:0;cursor:pointer;text-align:left;padding:0;color:inherit;font:inherit">
           <span class="lr-ico">${icon}</span><span class="lr-name">${esc(name)}</span>${on ? '<span class="lr-ck">✓</span>' : ''}
         </button>
         ${editable ? `<button class="lr-edit" data-id="${id}" title="改名 / 换图标" style="background:none;border:0;cursor:pointer;font-size:1rem;padding:4px">✏️</button>` : ''}
       </div>`;
    body.innerHTML = `
      <div class="ledger-list">
        ${row('all', '📚', '全部账本（所有账目一起）', active === 'all', false)}
        ${ledgers.map(l => row(l.id, l.icon || '📒', l.name, active === l.id, true)).join('')}
      </div>
      <button class="btn ghost block" id="lpAdd">＋ 新建账本</button>
      <div class="sub" style="margin:8px 0 0">点账本名切换；点 ✏️ 可给账本改名、换图标。</div>`;
    body.querySelectorAll('.lr-pick').forEach(b => b.onclick = () => {
      Store.setActiveLedger(b.dataset.id);
      body._done(true);
    });
    body.querySelectorAll('.lr-edit').forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      const l = Store.getLedger(b.dataset.id);
      const res = await Modal.form('编辑账本', [
        { key: 'name', label: '账本名称', value: l.name },
        { key: 'icon', label: '图标（emoji）', value: l.icon || '📒', hint: '可从手机表情里挑一个，例如 💼 ✈️ 🏠 🐱' },
      ], { okText: '保存' });
      if (res && res.name.trim()) { Store.updateLedger(b.dataset.id, { name: res.name.trim(), icon: (res.icon || '').trim() || '📒' }); toast('账本已更新'); paint(); }
    });
    $('#lpAdd', body).onclick = async () => {
      const name = await Modal.prompt('新建账本', { placeholder: '例：生意账、旅行账、家庭账' });
      if (!name) return;
      const lg = Store.addLedger(name);
      Store.setActiveLedger(lg.id);
      body._done(true);
    };
  };
  paint();
  const changed = await Modal.open({
    title: '账本', body, showCancel: true, okText: '完成',
    getValue: () => true, onOpen: (m, done) => { body._done = done; },
  });
  if (changed) render();
}

/* 账户下拉选择器（记账页、编辑条目用）*/
function acctSelect(acctId, cls) {
  const accs = Store.getAccounts();
  let html = `<select class="${cls || ''}">`;
  for (const a of accs) html += `<option value="${a.id}" ${acctId === a.id ? 'selected' : ''}>${a.icon || '💼'} ${esc(a.name)}</option>`;
  return html + '</select>';
}

function catSelect(catId, type, cls) {
  const cats = Store.getCategories(type);
  let html = `<select class="${cls || ''}">`;
  html += `<option value="" ${!catId ? 'selected' : ''}>❓ 待归类</option>`;
  for (const c of cats) html += `<option value="${c.id}" ${catId === c.id ? 'selected' : ''}>${c.icon || ''} ${esc(c.name)}</option>`;
  return html + '</select>';
}

/* 记账时用哪个账户：只有一个账户就不折腾，返回 null（归到现金） */
function currentRecAcct() {
  const accs = Store.getAccounts();
  if (accs.length <= 1) return null;               // 单账户：维持原样，全部自动归现金
  const want = S.recordAcct || Store.getSettings().lastAcct || '__auto__';
  if (want === '__auto__') return '__auto__';
  return accs.some(a => a.id === want) ? want : '__auto__';
}
/* 多账户时按备注解析这笔该记到哪个账户。
   返回 {acctId, unassigned}：unassigned=true 表示没认出（暂记现金 + 标红提醒）。 */
function resolveAcctFor(note) {
  const sel = currentRecAcct();
  if (sel === null) return { acctId: null, unassigned: false };        // 单账户
  if (sel !== '__auto__') return { acctId: sel, unassigned: false };   // 手动指定了账户
  const m = Store.matchAccount(note);
  return m ? { acctId: m, unassigned: false } : { acctId: null, unassigned: true };
}
/* 记账页顶部的「记到账户」选择条：多于一个账户才显示 */
function acctPickerRow() {
  const accs = Store.getAccounts();
  if (accs.length <= 1) return '';
  const cur = currentRecAcct();
  const total = Store.accountsSnapshot().total;
  return `
  <div class="acct-pick card" style="padding:12px 16px;margin-bottom:12px;flex-wrap:wrap">
    <span style="font-size:.86rem;font-weight:600">记到账户</span>
    <select id="recAcct" style="flex:1;min-width:180px">
      <option value="__auto__" ${cur === '__auto__' ? 'selected' : ''}>🪄 自动识别（备注里写账户名）</option>
      ${accs.map(a => `<option value="${a.id}" ${cur === a.id ? 'selected' : ''}>${a.icon || '💼'} ${esc(a.name)}（余 ${fmtM(Store.accountBalance(a.id))}）</option>`).join('')}
    </select>
    <button class="btn ghost small" id="recTransfer">🔄 转账</button>
    <span style="flex-basis:100%;font-size:.74rem;color:var(--text-3);margin-top:4px">
      总余额 <b>${fmtM(total)}</b> · 自动识别时备注里写账户名（如「${esc(accs[1] ? accs[1].name : accs[0].name)}买菜 30」）就会记到那个账户；没写的暂记现金并标 <span style="color:var(--danger)">⚠ 未分账</span>
    </span>
  </div>`;
}

/* ============================================================
   财务管理页
============================================================ */
/* 存钱计划的节奏提示：要按时完成每月得存多少 / 按当前速度什么时候能到 */
/* 存钱计划的节奏提示：按剩余时间选合适的单位，别对着 14 天的目标报「每月要存 4000」 */
function goalPaceHint(g, p) {
  if (p.done) return '';
  const parts = [];
  if (g.targetDate) {
    const days = Math.ceil((new Date(g.targetDate + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 86400000);
    if (days > 0) {
      // 剩不到两个月还报「每月要存 X」会算出比目标本身还大的数，很荒唐 —— 按天/周说
      let need;
      if (days <= 14) need = `每天还需存 <b style="color:var(--income)">${fmtM(p.remain / days)}</b>`;
      else if (days <= 60) need = `每周还需存 <b style="color:var(--income)">${fmtM(p.remain / (days / 7))}</b>`;
      else need = `每月还需存 <b style="color:var(--income)">${fmtM(p.remain / (days / 30.4))}</b>`;
      parts.push(`要按时完成，${need}（还剩 ${days} 天）`);
    } else parts.push('<b style="color:var(--danger)">⚠️ 已过目标日期</b>');
  }
  const elapsed = Math.max(1, Math.ceil((new Date(todayStr() + 'T00:00:00') - new Date((g.startDate || todayStr()) + 'T00:00:00')) / 86400000));
  if (p.saved > 0 && elapsed >= 7) {
    const perDay = p.saved / elapsed;
    const need = Math.ceil(p.remain / perDay);
    if (isFinite(need) && need > 0 && need < 3650) parts.push(`按目前速度约 <b>${need}</b> 天达成`);
  }
  return parts.length ? `<div class="sub" style="margin:3px 0 0">${parts.join('　|　')}</div>` : '';
}

/* ---------- 财务管理：期间导航 ---------- */
function finRange() {
  const a = S.finAnchor;
  if (S.finPeriod === 'year') {
    const y = a.slice(0, 4);
    return { label: y + '年', months: Store.monthsOfYear(y), year: y, ym: null };
  }
  const ym = a.slice(0, 7);
  return { label: ym.replace('-', ' 年 ') + ' 月', months: [ym], year: ym.slice(0, 4), ym };
}
function finShift(n) {
  if (S.finPeriod === 'year') S.finAnchor = (+S.finAnchor.slice(0, 4) + n) + S.finAnchor.slice(4);
  else S.finAnchor = shiftYM(S.finAnchor.slice(0, 7), n) + '-15';
}

function viewFinance() {
  const subs = [['budget', '🎯 预算'], ['goals', '🐷 存钱计划'], ['accounts', '💼 账户']];
  const bar = `<div class="subtab-bar">${subs.map(([k, n]) =>
    `<button class="subtab ${S.finSub === k ? 'on' : ''}" data-fsub="${k}">${n}</button>`).join('')}</div>`;
  const inner = S.finSub === 'goals' ? viewFinGoals() : S.finSub === 'accounts' ? viewAccounts() : viewFinBudget();
  return bar + inner;
}
function bindFinance() {
  $$('.subtab[data-fsub]').forEach(b => b.onclick = () => { S.finSub = b.dataset.fsub; render(); });
  if (S.finSub === 'goals') bindFinGoals();
  else if (S.finSub === 'accounts') bindAccounts();
  else bindFinBudget();
}

/* ============================================================
   财务管理 · 子页1：预算与统计
============================================================ */
function viewFinBudget() {
  const R = finRange();
  const isMonth = S.finPeriod === 'month';
  const ps = Store.periodStats(R.months);
  const totalBudget = Store.getTotalBudget();
  const thisMonth = todayStr().slice(0, 7);

  /* ---- 期间导航 ---- */
  const nav = `
  <div class="pill-group">
    <button class="pill ${isMonth ? 'active' : ''}" data-fp="month">按月</button>
    <button class="pill ${!isMonth ? 'active' : ''}" data-fp="year">按年</button>
    <button class="pill" data-fp="today" style="margin-left:auto">回到当前</button>
  </div>
  <div class="period-nav">
    <button class="pn-btn" id="finPrev">‹</button>
    <button class="pn-label" id="finPick">${R.label} <span style="font-size:.72rem;opacity:.55">▾</span></button>
    <button class="pn-btn" id="finNext">›</button>
  </div>`;

  if (!R.months.length) {
    return nav + '<div class="card"><div class="empty"><div class="big">📭</div>这个时段还没有记账</div></div>';
  }

  /* ---- 收支总览（月/年通用；年视图给月均和中位数）---- */
  const overview = isMonth ? (() => {
    const ym = R.ym;
    const spent = ps.exp[0] || 0, income = ps.inc[0] || 0;
    const rate = income > 0 ? Math.round((income - spent) / income * 100) : 0;
    // 只有看「当月」时算日均预测才有意义；看历史月份就直接给实际值
    const isCur = ym === thisMonth;
    const dim = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
    const day = isCur ? +todayStr().slice(8, 10) : dim;
    const daysLeft = Math.max(0, dim - day);
    const projected = day > 0 ? Math.round(spent / day * dim * 100) / 100 : spent;
    return { spent, income, rate, dim, day, daysLeft, projected, isCur };
  })() : null;

  /* ---- 预算卡 ---- */
  let budgetCard = '';
  if (isMonth) {
    const o = overview;
    const over = totalBudget > 0 && o.spent > totalBudget;
    const pct = totalBudget > 0 ? Math.min(100, o.spent / totalBudget * 100) : 0;
    const projOver = totalBudget > 0 && o.projected > totalBudget;
    budgetCard = `
    <div class="card">
      <h3>🎯 ${R.label} 总预算</h3>
      ${totalBudget > 0 ? `
        <div class="budget-big">
          <div><span class="bb-spent ${over ? 'over' : ''}">${fmtM(o.spent)}</span> <span class="bb-of">/ ${fmtM(totalBudget)}</span></div>
          <div class="bb-remain">${over ? `已超支 ${fmtM(o.spent - totalBudget)}` : `还可花 ${fmtM(totalBudget - o.spent)}`}</div>
        </div>
        <div class="bar-bg" style="height:10px;margin:10px 0 6px"><div class="bar-fg" style="width:${pct}%;background:${over ? 'var(--danger)' : 'var(--brand)'}"></div></div>
        ${o.isCur && !over && o.daysLeft > 0 ? `<div class="tip-strong">本月还剩 <b>${o.daysLeft}</b> 天，接下来每天可花 <b style="color:var(--brand)">${fmtM((totalBudget - o.spent) / o.daysLeft)}</b> 才不超预算</div>` : ''}
        ${o.isCur && over ? `<div class="tip-strong danger">已经超预算 ${fmtM(o.spent - totalBudget)}，剩下 ${o.daysLeft} 天悠着点</div>` : ''}
      ` : '<div class="sub" style="margin:0">还没设总预算。设一个每月总额，下面就会告诉你每天还能花多少。</div>'}
      ${o.isCur && o.day > 2 ? `<div class="sub" style="margin:8px 0 0">按目前日均（${fmtM(o.spent / o.day)}/天），预计月末花 <b style="color:${projOver ? 'var(--danger)' : 'var(--brand)'}">${fmtM(o.projected)}</b>${projOver ? '，<b style="color:var(--danger)">会超预算</b>' : totalBudget > 0 ? '，在预算内 👍' : ''}</div>` : ''}
      <div class="row" style="margin-top:10px">
        <input type="number" id="finTotalBudget" value="${totalBudget || ''}" placeholder="每月总预算" step="1">
        <button class="btn small narrow" id="finSetTotal">保存</button>
      </div>
    </div>`;
  }

  /* ---- 速览：月视图给本月；年视图给月均/中位数 ---- */
  const overviewCard = isMonth ? `
    <div class="card">
      <h3>💡 ${R.label} 速览</h3>
      <div class="debt-strip">
        <div class="debt-box ${overview.rate >= 0 ? 'good' : 'bad'}"><div class="d-label">储蓄率</div><div class="d-val" style="color:${overview.rate >= 20 ? 'var(--brand)' : overview.rate >= 0 ? 'var(--text)' : 'var(--danger)'}">${overview.rate}%</div></div>
        <div class="debt-box"><div class="d-label">真实支出</div><div class="d-val amt-expense">${fmtM(overview.spent)}</div></div>
        <div class="debt-box"><div class="d-label">真实收入</div><div class="d-val amt-income">${fmtM(overview.income)}</div></div>
        <div class="debt-box ${ps.bal[0] >= 0 ? 'good' : 'bad'}"><div class="d-label">存下</div><div class="d-val" style="color:${ps.bal[0] >= 0 ? 'var(--brand)' : 'var(--danger)'}">${fmtM(ps.bal[0])}</div></div>
      </div>
      ${bigExpensesHtml(R.ym)}
    </div>` : `
    <div class="card">
      <h3>💡 ${R.label} 收支水平（共 ${R.months.length} 个月）</h3>
      <div class="sub">平均数容易被个别大额月份拉高，中位数更能代表「通常的一个月」。</div>
      <div class="table-scroll">
        <table class="simple"><thead><tr><th>口径</th><th>月平均</th><th>月中位数</th><th>全年合计</th></tr></thead>
        <tbody>
          <tr><td>支出</td><td class="amt-expense">${fmtM(ps.expAvg)}</td><td class="amt-expense">${fmtM(ps.expMed)}</td><td class="amt-expense">${fmtM(ps.exp.reduce((a, b) => a + b, 0))}</td></tr>
          <tr><td>收入</td><td class="amt-income">${fmtM(ps.incAvg)}</td><td class="amt-income">${fmtM(ps.incMed)}</td><td class="amt-income">${fmtM(ps.inc.reduce((a, b) => a + b, 0))}</td></tr>
          <tr><td>存下</td><td>${fmtM(ps.balAvg)}</td><td>${fmtM(ps.balMed)}</td><td>${fmtM(ps.bal.reduce((a, b) => a + b, 0))}</td></tr>
        </tbody></table>
      </div>
      <div class="chart-wrap" id="finPeriodChart" style="margin-top:10px"></div>
      <div class="legend">
        <span class="lg"><span class="dot" style="background:#f0524c"></span>支出</span>
        <span class="lg"><span class="dot" style="background:#2f7cf6"></span>收入</span>
        <span class="lg"><span class="dot" style="background:#f5a524;border-radius:0;height:2px;width:14px"></span>支出中位数</span>
      </div>
    </div>`;

  /* ---- 分类预算 vs 花销（额度使用对比）---- */
  const expCats = Store.getCategories('expense');
  const budRows = expCats.map(c => {
    const b = Store.getBudget(c.id);
    // 月视图比当月；年视图比「这一年月均」
    const sp = isMonth ? Store.catSpent(R.ym, c.id) : Store.catStat(c.id, 'expense', R.months).avg;
    return { c, b, sp };
  }).filter(r => r.b > 0 || r.sp > 0).sort((a, b) => (b.sp || b.b) - (a.sp || a.b));

  const catBudgetCard = `
  <div class="card">
    <h3>📊 分类额度使用
      <span style="float:right"><button class="btn ghost small" id="finAuto">按历史生成额度</button></span>
    </h3>
    <div class="sub">额度就是「每月标准」，可手动改。${isMonth ? '下面比的是本月实际花销。' : '年视图下比的是这一年的<b>月均</b>花销。'}
      点「按历史生成额度」可用中位数/平均数一键填好。</div>
    ${budRows.length ? `
      <div class="table-scroll" style="margin-bottom:6px">
        <table class="simple"><thead><tr><th>分类</th><th>${isMonth ? '本月已花' : '月均花销'}</th><th>月额度</th><th>用了</th><th>差额</th></tr></thead>
        <tbody>
          ${budRows.map(r => {
            const has = r.b > 0;
            const usePct = has ? Math.round(r.sp / r.b * 100) : null;
            const diff = has ? r.b - r.sp : null;
            const over = has && r.sp > r.b;
            return `<tr>
              <td>${r.c.icon || ''} ${esc(r.c.name)}</td>
              <td style="${over ? 'color:var(--danger);font-weight:700' : ''}">${fmtM(r.sp)}</td>
              <td>${has ? fmtM(r.b) : '—'}</td>
              <td style="${over ? 'color:var(--danger);font-weight:700' : ''}">${usePct === null ? '—' : usePct + '%'}</td>
              <td style="color:${!has ? 'var(--text-3)' : over ? 'var(--danger)' : 'var(--brand)'};font-weight:600">${!has ? '—' : (over ? '超 ' + fmtM(-diff) : '省 ' + fmtM(diff))}</td>
            </tr>`;
          }).join('')}
        </tbody></table>
      </div>
      ${budRows.map(r => `
        <div class="fbud-row" data-cid="${r.c.id}">
          <span class="fb-ico" style="background:color-mix(in srgb, ${r.c.color} 16%, transparent)">${r.c.icon || '🏷️'}</span>
          <span class="fb-mid">
            <span class="fb-name">${esc(r.c.name)} <span class="fb-num ${r.b > 0 && r.sp > r.b ? 'over' : ''}">${fmtM(r.sp)}${r.b > 0 ? ` / ${fmtM(r.b)}` : ''}</span></span>
            ${r.b > 0 ? `<div class="bar-bg" style="margin-top:4px"><div class="bar-fg" style="width:${Math.min(100, r.sp / r.b * 100)}%;background:${r.sp > r.b ? 'var(--danger)' : r.c.color}"></div></div>` : '<div class="fb-nobudget">未设额度</div>'}
          </span>
          <input class="fb-input" type="number" value="${r.b || ''}" placeholder="额度" step="1">
        </div>`).join('')}
    ` : '<div class="empty" style="padding:20px 0">这个时段没有支出记录</div>'}
  </div>`;

  /* ---- 分类中位数/平均数 + 图 ---- */
  const statCats = expCats.map(c => ({ c, st: Store.catStat(c.id, 'expense', R.months) }))
    .filter(x => x.st.active > 0).sort((a, b) => b.st.avg - a.st.avg);
  const statCard = `
  <div class="card">
    <div class="chart-tools">
      <b style="font-size:.95rem">📐 各分类每月中位数 / 平均数</b>
      <span class="spacer"></span>
      <span class="seg-mini">
        <button class="${S.finChart === 'bar' ? 'on' : ''}" data-fc="bar">柱状</button>
        <button class="${S.finChart === 'line' ? 'on' : ''}" data-fc="line">折线</button>
      </span>
    </div>
    <div class="sub" style="margin-top:0">统计范围：${R.months.length} 个月（${R.months[0]} ~ ${R.months[R.months.length - 1]}）。${isMonth ? '想看多个月的规律，切到「按年」。' : ''}</div>
    ${statCats.length ? `
      <div class="chart-wrap" id="finCatChart"></div>
      <div class="legend">
        <span class="lg"><span class="dot" style="background:#5b8def"></span>月平均</span>
        <span class="lg"><span class="dot" style="background:#f5a524"></span>月中位数</span>
      </div>
      <div class="table-scroll" style="margin-top:10px">
        <table class="simple"><thead><tr><th>分类</th><th>月平均</th><th>月中位数</th><th>最高月</th><th>有花销月数</th></tr></thead>
        <tbody>
          ${statCats.map(({ c, st }) => `<tr>
            <td>${c.icon || ''} ${esc(c.name)}</td>
            <td>${fmtM(st.avg)}</td><td>${fmtM(st.median)}</td><td>${fmtM(st.max)}</td>
            <td>${st.active}/${st.months}</td></tr>`).join('')}
        </tbody></table>
      </div>` : '<div class="empty" style="padding:20px 0">这个时段没有支出记录</div>'}
  </div>`;

  return nav + budgetCard + overviewCard + catBudgetCard + statCard;
}

/* ---------- 账本管理卡（放在存钱计划页下方）---------- */
function ledgerManageCard() {
  const ledgers = Store.getLedgers();
  return `
  <div class="card">
    <h3>📚 账本管理</h3>
    <div class="sub">多本账分开记（生活、生意、旅行…）。顶部标签可切换当前账本；选「全部」时所有账目一起看。</div>
    <div class="ledger-manage">
      ${ledgers.map(l => `
        <div class="lm-row" data-id="${l.id}">
          <span class="lm-ico">${l.icon || '📒'}</span>
          <span class="lm-name">${esc(l.name)}${l.builtin ? ' <i style="font-size:.7rem;color:var(--text-3)">默认</i>' : ''}</span>
          <span class="lm-cnt">${Store.getEntries().filter(e => Store.ledgerOf(e) === l.id).length} 笔</span>
          <button class="lm-edit" title="改名/图标">✏️</button>
          ${l.builtin ? '' : '<button class="lm-del" title="删除">🗑</button>'}
        </div>`).join('')}
    </div>
    <button class="btn ghost block" id="lmAdd">＋ 新建账本</button>
  </div>`;
}
function bindLedgerManage() {
  const lmAdd = $('#lmAdd');
  if (lmAdd) lmAdd.onclick = async () => {
    const name = await Modal.prompt('新建账本', { placeholder: '例：生意账、旅行账、家庭账' });
    if (name) { Store.addLedger(name); toast('账本已创建'); render(); }
  };
  $$('.lm-row').forEach(row => {
    const id = row.dataset.id;
    const editBtn = row.querySelector('.lm-edit');
    if (editBtn) editBtn.onclick = async () => {
      const l = Store.getLedger(id);
      const res = await Modal.form('编辑账本', [
        { key: 'name', label: '账本名称', value: l.name },
        { key: 'icon', label: '图标（emoji）', value: l.icon || '📒', hint: '可从手机表情里挑一个，例如 💼 ✈️ 🏠 🐱' },
      ], { okText: '保存' });
      if (res && res.name.trim()) { Store.updateLedger(id, { name: res.name.trim(), icon: res.icon.trim() || '📒' }); render(); }
    };
    const delBtn = row.querySelector('.lm-del');
    if (delBtn) delBtn.onclick = async () => {
      const l = Store.getLedger(id);
      const cnt = Store.getEntries().filter(e => Store.ledgerOf(e) === id).length;
      if (await Modal.confirm('删除账本', { text: `删除「${esc(l.name)}」？${cnt ? `它的 ${cnt} 笔记录会移到「日常账本」。` : ''}`, danger: true, okText: '删除' })) {
        Store.removeLedger(id); toast('已删除'); render();
      }
    };
  });
}

/* 本月最大几笔支出 */
function bigExpensesHtml(ym) {
  const bigs = Store.inMonth(ym).filter(e => e.type === 'expense' && !Store.debtKindOf(e))
    .sort((a, b) => b.amount - a.amount).slice(0, 5);
  if (!bigs.length) return '';
  return `<label class="fld">最大的 ${bigs.length} 笔支出（钱花哪了）</label>` + bigs.map(e => {
    const c = e.catId ? Store.getCat(e.catId) : null;
    return `<div class="entry" style="border-bottom:1px solid var(--line)">
      <span class="e-ico chip" style="background:color-mix(in srgb, ${c ? c.color : '#999'} 15%, transparent)">${c ? c.icon : '❓'}</span>
      <span class="e-mid"><div class="e-cat">${e.date.slice(5)} ${esc(c ? c.name : '未知')}</div><div class="e-note">${esc(e.note) || ''}</div></span>
      <span class="e-amt amt-expense">-${fmtM(e.amount)}</span></div>`;
  }).join('');
}

function bindFinBudget() {
  $$('.pill[data-fp]').forEach(b => b.onclick = () => {
    if (b.dataset.fp === 'today') S.finAnchor = todayStr();
    else S.finPeriod = b.dataset.fp;
    render();
  });
  $('#finPrev').onclick = () => { finShift(-1); render(); };
  $('#finNext').onclick = () => { finShift(1); render(); };
  $('#finPick').onclick = async () => {
    const d = await pickPeriod(S.finPeriod, S.finAnchor);
    if (d) { S.finAnchor = d; render(); }
  };
  $$('[data-fc]').forEach(b => b.onclick = () => { S.finChart = b.dataset.fc; render(); });

  const setTotal = $('#finSetTotal');
  if (setTotal) setTotal.onclick = () => { Store.setTotalBudget(parseFloat($('#finTotalBudget').value) || 0); toast('总预算已更新'); render(); };

  const auto = $('#finAuto');
  if (auto) auto.onclick = async () => {
    const basis = await Modal.choose('按历史生成每月额度', [
      { value: 'median', label: '按每月中位数', hint: '更稳，抗个别大额月份（推荐）' },
      { value: 'avg', label: '按每月平均数', hint: '含大额月份，数值偏高' },
    ], { hint: '会覆盖现有的分类额度，生成后仍可手动微调' });
    if (!basis) return;
    const n = Store.autoBudgets(basis);
    toast(`已按${basis === 'median' ? '中位数' : '平均数'}生成 ${n} 个分类额度`); render();
  };
  $$('.fbud-row').forEach(row => {
    const inp = row.querySelector('.fb-input');
    inp.onchange = () => { Store.setBudget(row.dataset.cid, parseFloat(inp.value) || 0); render(); };
  });

  /* ---- 图表 ---- */
  const R = finRange();
  if (!R.months.length) return;
  const ps = Store.periodStats(R.months);

  // 年视图：逐月收支柱 + 中位数参考线
  const pc = $('#finPeriodChart');
  if (pc) {
    const labels = R.months.map(m => +m.slice(5) + '月');
    pc.appendChild(Charts.barChart(labels, [
      { name: '支出', color: '#f0524c', values: ps.exp },
      { name: '收入', color: '#2f7cf6', values: ps.inc },
      { name: '支出中位数', color: '#f5a524', values: ps.exp.map(() => ps.expMed) },
    ], { height: 240 }));
  }

  // 分类平均 vs 中位数
  const cc = $('#finCatChart');
  if (cc) {
    const expCats = Store.getCategories('expense');
    const rows = expCats.map(c => ({ c, st: Store.catStat(c.id, 'expense', R.months) }))
      .filter(x => x.st.active > 0).sort((a, b) => b.st.avg - a.st.avg).slice(0, 12);
    if (rows.length) {
      const labels = rows.map(r => r.c.name);
      const series = [
        { name: '月平均', color: '#5b8def', values: rows.map(r => r.st.avg) },
        { name: '月中位数', color: '#f5a524', values: rows.map(r => r.st.median) },
      ];
      cc.appendChild(S.finChart === 'line'
        ? Charts.lineChart(labels, series, { height: 250 })
        : Charts.barChart(labels, series, { height: 250, width: Math.max(640, labels.length * 60 + 90) }));
    }
  }
}

/* ============================================================
   财务管理 · 子页2：存钱计划（+ 账本管理）
============================================================ */
function viewFinGoals() {
  const goal = Store.getMonthlyGoal();
  const thisMonth = todayStr().slice(0, 7);
  const surplus = Store.budgetSurplus(thisMonth);

  // 可选年份：有数据的年 + 今年，确保今年也能选
  const years = Array.from(new Set([...Store.years(), todayStr().slice(0, 4)])).sort();
  if (!years.includes(S.goalYear)) S.goalYear = years[years.length - 1];
  const yr = Store.goalYearSummary(S.goalYear);
  const streak = Store.goalYearStreak(S.goalYear);   // 所选年份内的最长连续达成
  const cur = yr.months.find(h => h.ym === thisMonth);
  const rate = goal > 0 && yr.dataMonths ? Math.round(yr.metCount / yr.dataMonths * 100) : 0;
  const totalPos = yr.total >= 0;

  /* ---- 每月储蓄目标 + 年度计划汇总 ---- */
  const yearGoal = goal * 12;                              // 年度目标 = 每月目标 × 12
  const yearMet = goal > 0 && yr.total >= yearGoal;
  const yearPct = yearGoal > 0 ? Math.min(100, Math.max(0, Math.round(yr.total / yearGoal * 100))) : 0;
  const monthlyCard = `
  <div class="card">
    <h3>📅 存钱计划（月度 & 年度）</h3>
    <div class="sub">存下 = 真实收入 − 真实支出，借来的钱不算存下。年度目标 = 每月目标 × 12。</div>

    <div class="pill-group" style="margin-top:6px">
      ${years.map(y => `<button class="pill yr ${S.goalYear === y ? 'active' : ''}" data-gy="${y}">${y}年</button>`).join('')}
    </div>

    <div class="hero" style="margin:12px 0 4px">
      <div class="h-label">${S.goalYear} 年累计存下（${yr.dataMonths} 个月${yr.adjust ? `，含手动校正 ${yr.adjust > 0 ? '+' : ''}${fmtM(yr.adjust)}` : ''}）</div>
      <div class="h-big" style="color:${totalPos ? '#eafff5' : '#ffe2da'}">¥ ${fmtM(yr.total)}</div>
      ${goal > 0 ? `
        <div class="h-label" style="margin-top:6px">年度目标 ${fmtM(yearGoal)} ·
          ${yearMet ? '🏆 已达标，超出 ' + fmtM(yr.total - yearGoal) : '还差 ' + fmtM(yearGoal - yr.total) + '（完成 ' + yearPct + '%）'}
        </div>
        <div class="bar-bg" style="height:8px;margin-top:8px;background:rgba(255,255,255,.25)">
          <div class="bar-fg" style="width:${yearPct}%;background:${yearMet ? '#ffd76a' : '#eafff5'}"></div>
        </div>` : `<div class="h-label">${totalPos ? '这一年净攒下的钱' : '这一年花得比挣得多，透支了'}</div>`}
    </div>
    <div class="row" style="justify-content:flex-end;margin:6px 0 10px">
      <button class="btn ghost small" id="mgCalib">⚖️ 校准实际存款</button>
    </div>

    ${goal > 0 ? `
      <div class="ach-strip">
        <div class="ach-box ${streak >= 3 ? 'hot' : ''}">
          <div class="ach-n">${streak}</div><div class="ach-l">${S.goalYear}年最长连续达成${streak >= 3 ? ' 🔥' : ''}</div>
        </div>
        <div class="ach-box"><div class="ach-n">${yr.metCount}/${yr.dataMonths}</div><div class="ach-l">${S.goalYear}年达成</div></div>
        <div class="ach-box ${rate >= 60 ? 'good' : ''}"><div class="ach-n">${rate}%</div><div class="ach-l">达成率</div></div>
      </div>
      ${cur ? (cur.met
        ? `<div class="ach-banner done">🎉 本月已达成！存下 ${fmtM(cur.saved)}，超出目标 ${fmtM(cur.saved - goal)}</div>`
        : `<div class="ach-banner warn">⚠️ 本月还差 <b>${fmtM(cur.gap)}</b> 才够目标（目前存下 ${fmtM(cur.saved)}）</div>`) : ''}
    ` : ''}

    <label class="fld">每月储蓄目标（存钱标准线，可随时调）</label>
    <div class="row">
      <input type="number" id="mgInput" value="${goal || ''}" placeholder="每月想存多少" step="100">
      <button class="btn small narrow" id="mgSave">保存</button>
    </div>

    ${goal > 0 ? `
      <label class="fld">${S.goalYear} 年各月：✅ 达标 · ⚠️ 存了但没够 · ❌ 入不敷出</label>
      <div class="sub" style="margin:0 0 6px">每格两行数：<b>存</b> = 当月存下多少（收入−支出）；<b>差</b> = 比每月目标多存/少存多少</div>
      <div class="month-grid">
        ${yr.months.filter(h => h.hasData).map(h => {
          const d = Math.round((h.saved - goal) * 100) / 100;
          // 三态：达标 ✅ / 有存但没到目标 ⚠️ / 入不敷出（存款为负）❌
          const state = h.met ? 'met' : (h.saved >= 0 ? 'warn' : 'miss');
          const ico = h.met ? '✅' : (h.saved >= 0 ? '⚠️' : '❌');
          const stateTxt = h.met ? '达标' : (h.saved >= 0 ? '存了但没到目标' : '入不敷出');
          return `
          <div class="mg-cell ${state}" title="${h.ym} 存下 ${fmtM(h.saved)} / 目标 ${fmtM(goal)} · ${stateTxt}（${d >= 0 ? '高于' : '低于'}标准线 ${fmtM(Math.abs(d))}）">
            <div class="mg-ym">${(+h.ym.slice(5)) + '月'}</div>
            <div class="mg-ico">${ico}</div>
            <div class="mg-v"><i style="font-style:normal;color:var(--text-3)">存</i> ${Charts.fmt(h.saved)}</div>
            <div class="mg-diff" style="color:${d >= 0 ? 'var(--brand)' : 'var(--danger)'}"><i style="font-style:normal;color:var(--text-3)">差</i> ${d >= 0 ? '+' : ''}${Charts.fmt(d)}</div>
          </div>`;
        }).join('') || '<div class="empty" style="padding:12px 0">这一年还没有记录</div>'}
      </div>
    ` : '<div class="sub" style="margin:10px 0 0">还没设目标。设一个，就能看到每月有没有存到钱、年度差多少。</div>'}
  </div>`;

  /* ---- 预算执行 → 省下多少（第一条线：靠守额度存钱）---- */
  const budgetCard = `
  <div class="card">
    <h3>🧮 本月靠守额度存下多少</h3>
    <div class="sub">把「分类额度 − 实际花销」的结余加起来，就是你靠控制花销多存下的钱。</div>
    <div class="debt-strip">
      <div class="debt-box good"><div class="d-label">省下（未超额度的分类）</div><div class="d-val" style="color:var(--brand)">${fmtM(surplus.saved)}</div></div>
      <div class="debt-box ${surplus.over > 0 ? 'bad' : ''}"><div class="d-label">超支（超额度的分类）</div><div class="d-val" style="color:${surplus.over > 0 ? 'var(--danger)' : 'var(--text-3)'}">${fmtM(surplus.over)}</div></div>
      <div class="debt-box ${surplus.saved - surplus.over >= 0 ? 'good' : 'bad'}"><div class="d-label">净效果</div><div class="d-val" style="color:${surplus.saved - surplus.over >= 0 ? 'var(--brand)' : 'var(--danger)'}">${surplus.saved - surplus.over >= 0 ? '+' : ''}${fmtM(surplus.saved - surplus.over)}</div></div>
    </div>
    ${surplus.saved === 0 && surplus.over === 0 ? '<div class="sub" style="margin:8px 0 0">还没设分类额度 —— 去「预算」子页设一下，这里就有数了。</div>' : ''}
    <button class="btn ghost block" id="mgGoBudget">去设置分类额度 →</button>
  </div>`;

  /* ---- 目标型存钱计划 ---- */
  const goals = Store.getSavingsGoals();
  const goalCard = `
  <div class="card">
    <h3>🐷 攒钱目标</h3>
    <div class="sub">定个目标金额，从建计划那天起，积蓄涨了多少就算存了多少。</div>
    ${goals.length ? goals.map(g => {
      const p = Store.goalProgress(g);
      return `
      <div class="goal-row ${p.done ? 'done' : ''}" data-id="${g.id}">
        <div class="goal-top">
          <b>${p.done ? '🏆 ' : ''}${esc(g.name)}</b>
          <span>${p.done ? '已完成' : `已存 ${fmtM(p.saved)} / ${fmtM(g.target)}`}</span>
          <button class="goal-del" title="删除">🗑</button>
        </div>
        <div class="bar-bg" style="height:9px;margin:6px 0 4px"><div class="bar-fg" style="width:${p.pct}%;background:${p.done ? 'var(--brand)' : 'var(--income)'}"></div></div>
        ${p.done
          ? `<div class="ach-banner done" style="margin:6px 0 0">🎉 目标达成！存够 ${fmtM(g.target)}，可以定个新的了</div>`
          : `<div class="sub" style="margin:0">还差 ${fmtM(p.remain)}${g.targetDate ? ' · 目标日 ' + g.targetDate : ''}</div>${goalPaceHint(g, p)}`}
      </div>`;
    }).join('') : '<div class="empty" style="padding:16px 0">还没有攒钱目标</div>'}
    <button class="btn ghost block" id="finAddGoal">＋ 新建攒钱目标</button>
  </div>`;

  return monthlyCard + budgetCard + goalCard + ledgerManageCard();
}

function bindFinGoals() {
  $('#mgSave').onclick = () => { Store.setMonthlyGoal(parseFloat($('#mgInput').value) || 0); toast('每月储蓄目标已更新'); render(); };
  $$('.pill.yr[data-gy]').forEach(b => b.onclick = () => { S.goalYear = b.dataset.gy; render(); });

  /* 校准某年「累计存下」：记账算的和实际存款对不上时手动修正（不改任何记账记录） */
  $('#mgCalib').onclick = async () => {
    const yr = Store.goalYearSummary(S.goalYear);
    const val = await Modal.prompt(`校准 ${S.goalYear} 年实际存款`, {
      value: String(yr.total),
      hint: `按记账流水算，这一年累计存下 <b>${fmtM(yr.rawTotal)}</b>${yr.adjust ? `（当前含手动校正 ${yr.adjust > 0 ? '+' : ''}${fmtM(yr.adjust)}）` : ''}。<br>填这一年<b>实际</b>存下的总额，系统会记一笔校正差额。<br>只影响这里的年度累计显示，<b>不改任何记账记录</b>；想复原就再校准回 ${fmtM(yr.rawTotal)}。`,
      okText: '下一步',
    });
    if (val === null) return;
    const actual = parseFloat(val);
    if (isNaN(actual)) { toast('请输入数字'); return; }
    const adj = Math.round((actual - yr.rawTotal) * 100) / 100;
    if (Math.abs(adj - yr.adjust) < 0.005) { toast('和当前显示一致，无需校准'); return; }
    const ok = await Modal.confirm('确认校准（请谨慎）', {
      text: `${S.goalYear} 年「累计存下」将显示为 ${fmtM(actual)}\n（记账计算 ${fmtM(yr.rawTotal)} ${adj >= 0 ? '+' : '−'} 校正 ${fmtM(Math.abs(adj))}）\n\n· 不改动任何记账记录和账户余额\n· 年度达标按校准后的数判断\n· 随时可以再次校准或改回`,
      okText: '确认校准', danger: true,
    });
    if (!ok) return;
    Store.setGoalYearAdjust(S.goalYear, adj);
    toast('已校准'); render();
  };
  const gb = $('#mgGoBudget');
  if (gb) gb.onclick = () => { S.finSub = 'budget'; render(); };
  const addGoal = $('#finAddGoal');
  if (addGoal) addGoal.onclick = async () => {
    const res = await Modal.form('新建攒钱目标', [
      { key: 'name', label: '目标名称', value: '', placeholder: '例：攒够 5 万应急金 / 换手机' },
      { key: 'target', label: '目标金额', type: 'number', value: '' },
      { key: 'targetDate', label: '目标日期（可选）', type: 'date', value: '' },
    ], { okText: '创建' });
    if (!res) return;
    const target = parseFloat(res.target) || 0;
    if (!res.name.trim() || target <= 0) { toast('请填名称和目标金额'); return; }
    Store.addSavingsGoal({ name: res.name.trim(), target, targetDate: res.targetDate });
    toast('计划已创建，从现在开始算进度'); render();
  };
  $$('.goal-del').forEach(b => b.onclick = async (ev) => {
    ev.stopPropagation();
    const id = b.closest('.goal-row').dataset.id;
    if (await Modal.confirm('删除目标', { text: '确定删除这个攒钱目标？', danger: true, okText: '删除' })) {
      Store.removeSavingsGoal(id); render();
    }
  });
  bindLedgerManage();
}

/* ============================================================
   账户页
============================================================ */
function kindName(k) { const x = Store.getAccountKinds().find(z => z.kind === k); return x ? x.name : '其他'; }

/* 期初负债输入的实时预览：告诉用户填了这个值后「当前欠款」会变成多少。
   解决困惑：有的账里还款记得比借入多（早期花呗付款没记「借」），
   填的期初负债会先被这个差额吸收，用户以为「填了没变化」。 */
function opDebtPreviewText(openingDebt) {
  const dt = Store.debtTotals(Store.getEntries());
  const raw = (Number(openingDebt) || 0) + dt.borrow - dt.repay;   // 未钳零的负债
  const shown = Math.max(raw, 0);
  const gap = dt.repay - dt.borrow;   // 还款比借入多多少
  if (gap > 0.005 && raw <= 0) {
    return `⚠️ 你的账里累计还款比借入多 <b>${fmtM(gap)}</b>（早期花呗付款常没记「借」）。要让净资产体现欠款，期初负债需填到 <b>${fmtM(gap)}</b> 以上；想让当前欠款显示为 X，就填 ${fmtM(gap)}+X。`;
  }
  return `按现在的填法，<b>当前欠款 = ${fmtM(shown)}</b>（期初 ${fmtM(Number(openingDebt) || 0)} ＋ 借入 ${fmtM(dt.borrow)} − 还款 ${fmtM(dt.repay)}）。`;
}

function viewAccounts() {
  const as = Store.assetsAsOf('9999-12-31');
  const snap = Store.accountsSnapshot();
  const dl = debtLabel(as.debt);
  const overpaid = netRepaid(as.debt);
  const dtAll = Store.debtTotals(Store.getEntries());   // 全部记录的借入/还款/借出/收回累计
  const curDebt = Math.max(as.debt, 0);
  return `
  <div class="hero">
    <div class="h-label">净资产 = 账户总余额 ＋ 别人欠我 − 我欠别人</div>
    <div class="h-big">¥ ${fmtM(as.net)}</div>
    <div class="h-row">
      <div class="h-item"><div class="h-label">账户总余额</div><div class="h-val">${fmtM(snap.total)}</div></div>
      <div class="h-item"><div class="h-label">我欠别人</div><div class="h-val">${dl.text}</div></div>
      <div class="h-item"><div class="h-label">别人欠我</div><div class="h-val">${fmtM(Math.max(as.credit, 0))}</div></div>
    </div>
  </div>
  ${overpaid > 0 ? `<div class="remind-bar" style="margin-bottom:14px"><span class="rb-ico">ℹ️</span><span class="rb-t">你的账里<b>还款比借入多了 ¥${fmtM(overpaid)}</b>（多半是早期用花呗付款时没记「借」，只记了「还」）。这不影响账户余额和收支统计。<br>如果开始记账前确实欠着这笔钱，往下拉在<b>「期初负债」</b>填 ${fmtM(overpaid)} 就对上了；如果没欠，忽略即可。</span></div>` : ''}

  <div class="card">
    <h3>💼 我的账户
      <span style="float:right;font-size:.82rem;font-weight:700">总余额 ${fmtM(snap.total)}</span>
    </h3>
    <div class="sub">记账时选对应账户，余额自动增减，形成闭环。没选账户的记录都算到「现金」名下。</div>
    <div class="acct-list">
      ${snap.rows.map(a => `
        <button class="acct-row" data-id="${a.id}">
          <span class="ar-ico" style="background:color-mix(in srgb, ${a.color} 16%, transparent)">${a.icon || '💼'}</span>
          <span class="ar-mid">
            <span class="ar-name">${esc(a.name)}${a.builtin || kindName(a.kind) === a.name ? '' : ` <i class="ar-kind">${kindName(a.kind)}</i>`}</span>
            <span class="ar-sub">期初 ${fmtM(a.opening)}</span>
          </span>
          <span class="ar-bal ${a.balance < 0 ? 'neg' : ''}">${fmtM(a.balance)}</span>
        </button>`).join('')}
    </div>
    <div class="row" style="margin-top:12px">
      <button class="btn" id="acAdd">＋ 新建账户</button>
      <button class="btn ghost" id="acTransfer">🔄 转账</button>
      <button class="btn ghost" id="acCalib">⚖️ 校准余额</button>
    </div>
    <div class="sub" style="margin-top:8px">余额和实际对不上时（期初填错 / 漏记），用「校准」把某账户改成实际余额，系统会自动补差、不影响收支统计。</div>
    ${Store.getAdjustLog().length ? `
    <details style="margin-top:10px">
      <summary style="cursor:pointer;font-size:.82rem;color:var(--text-3)">校准记录（${Store.getAdjustLog().length} 次）</summary>
      <div class="debt-ledger" style="margin-top:8px">
        ${Store.getAdjustLog().slice(0, 20).map(g => `<div class="dl-row"><span>${g.date || '—'} · ${esc(g.name)}</span><b>${fmtM(g.from)} → ${fmtM(g.to)}（${g.diff > 0 ? '+' : ''}${fmtM(g.diff)}）</b></div>`).join('')}
      </div>
    </details>` : ''}
  </div>

  <div class="card">
    <h3>🏦 负债明细</h3>
    <div class="sub">当前欠款 = 期初负债 ＋ 累计借入 − 累计还款（不会低于 0）</div>
    <div class="debt-ledger">
      <div class="dl-row"><span>期初负债（记账前就欠的）</span><b>${fmtM(Store.getSettings().openingDebt || 0)}</b></div>
      <div class="dl-row"><span>＋ 累计借入</span><b class="amt-expense">${fmtM(dtAll.borrow)}</b></div>
      <div class="dl-row"><span>− 累计还款</span><b class="amt-income">${fmtM(dtAll.repay)}</b></div>
      <div class="dl-row total"><span>＝ 当前欠款</span><b style="color:${curDebt > 0 ? 'var(--danger)' : 'var(--text-3)'}">${fmtM(curDebt)}</b></div>
      ${overpaid > 0 ? `<div class="sub" style="margin:6px 0 0">（还款比借入多 ${fmtM(overpaid)}，按 0 计；若记账前有欠款，下面填期初负债）</div>` : ''}
    </div>
    ${dtAll.lend || dtAll.collect || as.credit ? `
    <div class="debt-ledger" style="margin-top:10px">
      <div class="dl-row"><span>期初债权（别人欠我）</span><b>${fmtM(Store.getSettings().openingCredit || 0)}</b></div>
      <div class="dl-row"><span>＋ 累计借出</span><b>${fmtM(dtAll.lend)}</b></div>
      <div class="dl-row"><span>− 累计收回</span><b>${fmtM(dtAll.collect)}</b></div>
      <div class="dl-row total"><span>＝ 别人还欠我</span><b>${fmtM(Math.max(as.credit, 0))}</b></div>
    </div>` : ''}
  </div>

  <div class="card">
    <h3>🏦 负债与债权（期初）</h3>
    <div class="sub">开始记账<b>之前</b>就欠着的 / 别人欠你的。之后的借入还款按记账自动累计。<br>
      净资产 = 账户总余额 ＋ 别人欠我 − 我欠别人</div>
    <div class="set-row">
      <div class="sr-t"><b>期初负债（我欠别人）</b><span>花呗、分付、信用卡已用额度、跟人借的</span></div>
      <input type="number" id="opDebt" value="${Store.getSettings().openingDebt || 0}" step="0.01" style="flex:0 0 130px">
    </div>
    <div class="sub" id="opDebtPreview" style="margin:-4px 0 6px">${opDebtPreviewText(Store.getSettings().openingDebt || 0)}</div>
    <div class="set-row">
      <div class="sr-t"><b>期初债权（别人欠我）</b><span>记账前别人欠我的钱</span></div>
      <input type="number" id="opCredit" value="${Store.getSettings().openingCredit || 0}" step="0.01" style="flex:0 0 130px">
    </div>
    <div class="debt-strip" style="margin-top:12px">
      <div class="debt-box good"><div class="d-label">积蓄（账户总额）</div><div class="d-val">${fmtM(as.savings)}</div></div>
      <div class="debt-box ${as.debt > 0 ? 'bad' : ''}" title="${dl.tip}"><div class="d-label">负债</div><div class="d-val" style="color:${dl.color}">${dl.text}</div></div>
      <div class="debt-box ${as.credit > 0 ? 'warn' : ''}"><div class="d-label">债权</div><div class="d-val">${fmtM(Math.max(as.credit, 0))}</div></div>
      <div class="debt-box ${as.net >= 0 ? 'good' : 'bad'}"><div class="d-label">净资产</div><div class="d-val" style="color:${as.net >= 0 ? 'var(--brand)' : 'var(--danger)'}">${fmtM(as.net)}</div></div>
    </div>
  </div>`;
}

function bindAccounts() {
  $$('.acct-row').forEach(b => b.onclick = () => editAccount(b.dataset.id));
  $('#acAdd').onclick = () => editAccount(null);
  $('#acTransfer').onclick = doTransfer;
  const cb = $('#acCalib');
  if (cb) cb.onclick = calibrateBalance;
  const opd = $('#opDebt');
  if (opd) {
    opd.oninput = ev => { const p = $('#opDebtPreview'); if (p) p.innerHTML = opDebtPreviewText(parseFloat(ev.target.value) || 0); };
    opd.onchange = ev => { Store.updateSettings({ openingDebt: Math.round((parseFloat(ev.target.value) || 0) * 100) / 100 }); render(); };
  }
  $('#opCredit').onchange = ev => { Store.updateSettings({ openingCredit: Math.round((parseFloat(ev.target.value) || 0) * 100) / 100 }); render(); };
}

/* 校准某账户余额到实际值：慎重操作，强弹窗确认，显示会补的差额。 */
async function calibrateBalance() {
  const accs = Store.getAccounts();
  let acctId = accs[0].id;
  if (accs.length > 1) {
    const pick = await Modal.choose('校准哪个账户', accs.map(a => ({
      value: a.id, label: `${a.icon || '💼'} ${a.name}`, hint: `当前余额 ${fmtM(Store.accountBalance(a.id))}`,
    })), { hint: '选一个余额和实际对不上的账户' });
    if (!pick) return;
    acctId = pick;
  }
  const acc = Store.getAccount(acctId);
  const cur = Store.accountBalance(acctId);
  const val = await Modal.prompt(`校准「${acc.name}」余额`, {
    value: String(cur),
    hint: `系统当前算出的余额是 <b>${fmtM(cur)}</b>。<br>请填这个账户此刻的<b>实际余额</b>（银行卡/钱包里真实的数），系统会自动补上差额。`,
    okText: '下一步',
  });
  if (val === null) return;
  const actual = parseFloat(val);
  if (isNaN(actual)) { toast('请输入数字'); return; }
  const diff = Math.round((actual - cur) * 100) / 100;
  if (diff === 0) { toast('余额一致，无需校准'); return; }
  const ok = await Modal.confirm('确认校准（请谨慎）', {
    text: `「${acc.name}」余额将从 ${fmtM(cur)} 调整为 ${fmtM(actual)}。\n系统会补一笔 ${diff > 0 ? '增加' : '减少'} ${fmtM(Math.abs(diff))} 的差额到期初基准。\n\n· 不影响你的收支统计和已有记录\n· 会留一条校准记录（今天 ${todayStr()}）便于日后核对\n· 若只是暂时对不上，建议先查明原因再校准`,
    okText: '确认校准', danger: true,
  });
  if (!ok) return;
  const r = Store.calibrateAccount(acctId, actual, todayStr());
  toast(`已校准：${fmtM(r.from)} → ${fmtM(r.to)}`);
  render();
}

async function editAccount(id) {
  const acc = id ? Store.getAccount(id) : null;
  const kinds = Store.getAccountKinds();
  const body = document.createElement('div');
  body.innerHTML = `
    <label class="fld">账户名称</label>
    <input class="af-name" type="text" value="${acc ? esc(acc.name) : ''}" placeholder="例：招商银行卡、老婆的微信">
    <label class="fld">账户类型</label>
    <select class="af-kind">${kinds.map(k => `<option value="${k.kind}" ${(acc ? acc.kind : 'bank') === k.kind ? 'selected' : ''}>${k.icon} ${k.name}</option>`).join('')}</select>
    <label class="fld">${acc ? '期初余额（这个账户最初有多少钱）' : '当前余额（这个账户现在有多少钱）'}</label>
    <input class="af-open" type="number" step="0.01" value="${acc ? acc.opening : ''}" placeholder="0">
    ${acc ? `<div class="sub" style="margin:8px 0 0">当前余额 <b>${fmtM(Store.accountBalance(acc.id))}</b>（= 期初 ＋ 之后的进出）</div>` : ''}
    ${acc && !acc.builtin ? `<button class="btn danger block af-del" style="margin-top:14px">删除这个账户</button>` : ''}`;
  const res = await Modal.open({
    title: acc ? '编辑账户' : '新建账户', body, okText: acc ? '保存' : '创建',
    getValue: (m) => ({
      name: m.querySelector('.af-name').value.trim(),
      kind: m.querySelector('.af-kind').value,
      opening: m.querySelector('.af-open').value,
    }),
    onOpen: (m, done) => {
      const del = m.querySelector('.af-del');
      if (del) del.onclick = async () => {
        done(null);
        if (await Modal.confirm('删除账户', { text: `删除「${esc(acc.name)}」？该账户下的记录会转到「现金」名下，余额并入现金。`, danger: true, okText: '删除' })) {
          Store.removeAccount(acc.id); toast('已删除'); render();
        }
      };
    },
  });
  if (!res) return;
  if (!res.name) { toast('请填账户名称'); return; }
  const opening = Math.round((parseFloat(res.opening) || 0) * 100) / 100;
  if (acc) {
    const k = kinds.find(x => x.kind === res.kind) || kinds[0];
    const patch = { name: res.name, opening };
    if (res.kind !== acc.kind) { patch.kind = k.kind; patch.icon = k.icon; patch.color = k.color; }
    Store.updateAccount(id, patch);
    toast('已保存');
  } else {
    Store.addAccount(res.name, res.kind, opening);
    toast('账户已创建');
  }
  render();
}

async function doTransfer() {
  const accs = Store.getAccounts();
  if (accs.length < 2) { toast('先建两个以上账户才能转账'); return; }
  const opts = accs.map(a => ({ value: a.id, label: `${a.icon || '💼'} ${a.name}` }));
  const res = await Modal.form('转账（账户间挪钱，不计收支）', [
    { key: 'from', label: '从', type: 'select', value: accs[0].id, options: opts },
    { key: 'to', label: '到', type: 'select', value: accs[1].id, options: opts },
    { key: 'amount', label: '金额', type: 'number', value: '' },
    { key: 'date', label: '日期', type: 'date', value: todayStr() },
    { key: 'note', label: '备注（可选）', value: '' },
  ], { okText: '转账' });
  if (!res) return;
  const amt = Math.round((parseFloat(res.amount) || 0) * 100) / 100;
  if (!amt || amt <= 0) { toast('请输入金额'); return; }
  if (res.from === res.to) { toast('两个账户不能相同'); return; }
  Store.addTransfer({ date: res.date || todayStr(), amount: amt, acctId: res.from, toAcctId: res.to, note: res.note });
  toast('转账已记录');
  render();
}

/* ============================================================
   记账页
============================================================ */
function viewRecord() {
  const dayEntries = Store.byDate(S.recordDate);
  const t = Store.totals(dayEntries);
  const ym = S.recordDate.slice(0, 7);
  const mt = Store.totals(Store.inMonth(ym));
  return `
  <div class="hero">
    <div class="h-label">${+ym.slice(5)}月支出</div>
    <div class="h-big">¥ ${fmtM(mt.expense)}</div>
    <div class="h-row">
      <div class="h-item"><div class="h-label">本月收入</div><div class="h-val">${fmtM(mt.income)}</div></div>
      <div class="h-item"><div class="h-label">本月结余</div><div class="h-val">${fmtM(mt.balance)}</div></div>
      <div class="h-item"><div class="h-label">当日支出</div><div class="h-val">${fmtM(t.expense)}</div></div>
    </div>
  </div>
  ${acctPickerRow()}
  <div class="layout-wide">
  <div class="col">
  <div class="card">
    <h3>⚡ 快速记账
      <label style="float:right;display:inline-flex;align-items:center;gap:6px;font-size:.78rem;font-weight:600;color:var(--text-2);cursor:pointer">
        <input type="checkbox" id="aiRecEnable" ${AI.ready() && Store.getSettings().ai.enabled !== false ? 'checked' : ''}> AI 记账识别
      </label>
    </h3>
    <div class="sub">多笔收支写在一起，用逗号分开，自动拆分、判断收支并归类。日期可在下方修改。</div>
    <input type="date" id="recDate" value="${S.recordDate}" style="margin-bottom:10px">
    <textarea id="smartText" placeholder="例：咖啡 15，超市购物 68.5，工资收入 8000"></textarea>
    <button class="btn block" id="btnParse">解析</button>
    <button class="btn ghost block" id="btnAiShot" style="margin-top:8px">📷 截图记账（${AI.ready() && Store.getSettings().ai.enabled !== false ? 'AI 识别' : '本地识别，免配置'}）</button>
    <input type="file" id="aiShotFile" accept="image/*" hidden>
    <div class="sub" id="aiShotStatus" style="margin:6px 0 0"></div>
    <div class="parse-list" id="parseList">${renderParseList()}</div>
    ${S.parsed.length ? `<button class="btn block" id="btnSaveParsed">✔ 保存这 ${S.parsed.length} 笔</button>` : ''}
  </div>
  <div class="card">
    <h3>✏️ 手动记一笔</h3>
    <div class="row">
      <div class="seg narrow">
        <button id="mExp" class="${S.manualType === 'expense' ? 'on-expense' : ''}">支出</button>
        <button id="mInc" class="${S.manualType === 'income' ? 'on-income' : ''}">收入</button>
      </div>
      <input type="number" id="mAmt" placeholder="金额" step="0.01" min="0" inputmode="decimal">
    </div>
    <label class="fld">分类</label>
    ${catSelect('', S.manualType, 'm-cat')}
    <label class="fld">备注</label>
    <input type="text" id="mNote" placeholder="备注（填写后可自动匹配分类）">
    <button class="btn block" id="btnManualSave">保存</button>
  </div>
  </div>
  <div class="col grow">
  <div class="card fill">
    <h3>📋 当日已记（${S.recordDate}）
      <span style="float:right;font-size:.8rem;font-weight:400">
        <span class="amt-expense">支 ${fmtM(t.expense)}</span> ·
        <span class="amt-income">收 ${fmtM(t.income)}</span>
      </span>
    </h3>
    <div class="fill-body">
      ${dayEntries.length ? `<div class="day-list" style="box-shadow:none;border:1px solid var(--line)">${dayEntries.map(entryRow).join('')}</div>` : '<div class="empty"><div class="big">🍃</div>这一天还没有记账</div>'}
    </div>
  </div>
  </div>
  </div>`;
}

function renderParseList() {
  if (!S.parsed.length) return '';
  return S.parsed.map((p, i) => `
    <div class="parse-item" data-i="${i}">
      <button class="p-type ${p.type === 'expense' ? 't-expense' : 't-income'}">${p.type === 'expense' ? '支' : '收'}</button>
      <span class="p-note" title="${esc(p.note)}">${p.date && p.date !== S.recordDate ? `<i style="font-style:normal;font-size:.7rem;color:var(--text-3)">${p.date.slice(5)}</i> ` : ''}${esc(p.note)}</span>
      ${catSelect(p.catId, p.type, 'p-cat')}
      <input class="p-amt" type="number" step="0.01" value="${p.amount}">
      <button class="p-del">✕</button>
    </div>`).join('');
}

/* 是否需要显示账户标签（有多个账户时才有意义） */
function showAcct() { return Store.getAccounts().length > 1; }
function acctTag(e) {
  if (!showAcct()) return '';
  // 自动分账没认出账户的：标红提醒（余额暂由现金吸收），点 ✏️ 指定账户后标记消失
  if (e.unassigned && !e.acctId) {
    return `<span class="e-acct" style="color:var(--danger);border-color:var(--danger);font-weight:700" title="没认出支付账户，暂记在现金名下，点 ✏️ 指定账户">⚠ 未分账</span>`;
  }
  const a = e.acctId ? Store.getAccount(e.acctId) : Store.getAccount(Store.DEFAULT_ACCT);
  return a ? `<span class="e-acct">${a.icon || '💼'}${esc(a.name)}</span>` : '';
}

function entryRow(e) {
  if (e.type === 'transfer') return transferRow(e);
  const c = e.catId ? Store.getCat(e.catId) : null;
  const name = c ? c.name : '待归类';
  const color = c ? c.color : '#b0b8b5';
  const icon = c ? (c.icon || '🏷️') : '❓';
  if (S.editingId === e.id) return entryEditor(e);
  return `
  <div class="entry" data-id="${e.id}">
    <span class="e-ico chip" style="background:color-mix(in srgb, ${color} 15%, transparent)" title="点击编辑">${icon}</span>
    <span class="e-mid">
      <div class="e-cat ${c ? '' : 'unknown'}">${esc(name)}${acctTag(e)}</div>
      <div class="e-note">${esc(e.note) || '（无备注）'}</div>
    </span>
    <span class="e-amt ${e.type === 'expense' ? 'amt-expense' : 'amt-income'}">${e.type === 'expense' ? '-' : '+'}${fmtM(e.amount)}</span>
    <span class="e-ops"><button class="op-edit" title="编辑">✏️</button><button class="op-del" title="删除">🗑</button></span>
  </div>`;
}

function transferRow(e) {
  const from = Store.getAccount(e.acctId) || {}, to = Store.getAccount(e.toAcctId) || {};
  return `
  <div class="entry" data-id="${e.id}">
    <span class="e-ico chip" style="background:color-mix(in srgb, #7c8b99 15%, transparent)">🔄</span>
    <span class="e-mid">
      <div class="e-cat">转账 <span class="e-acct">${from.icon || '💼'}${esc(from.name || '?')}</span> → <span class="e-acct">${to.icon || '💼'}${esc(to.name || '?')}</span></div>
      <div class="e-note">${esc(e.note) || '账户间挪钱'}</div>
    </span>
    <span class="e-amt" style="color:var(--text-2)">${fmtM(e.amount)}</span>
    <span class="e-ops"><button class="op-del" title="删除">🗑</button></span>
  </div>`;
}

function entryEditor(e) {
  return `
  <div class="entry editing" data-id="${e.id}" style="flex-wrap:wrap">
    <div class="row" style="width:100%">
      <div class="seg narrow">
        <button class="ed-exp ${e.type === 'expense' ? 'on-expense' : ''}">支</button>
        <button class="ed-inc ${e.type === 'income' ? 'on-income' : ''}">收</button>
      </div>
      <input class="ed-amt" type="number" step="0.01" value="${e.amount}">
      ${catSelect(e.catId, e.type, 'ed-cat')}
    </div>
    <div class="row" style="width:100%;margin-top:6px">
      <input class="ed-note" type="text" value="${esc(e.note)}">
      <input class="ed-date narrow" type="date" value="${e.date}" style="flex:0 0 130px">
    </div>
    ${showAcct() ? `<div class="row" style="width:100%;margin-top:6px"><span style="flex:0 0 auto;font-size:.78rem;color:var(--text-3)">账户</span>${acctSelect(e.acctId || Store.DEFAULT_ACCT, 'ed-acct')}</div>` : ''}
    <div class="row" style="width:100%;margin-top:6px">
      <button class="btn small ed-save">保存</button>
      <button class="btn small ghost ed-cancel">取消</button>
    </div>
  </div>`;
}

function bindRecord() {
  const ra = $('#recAcct');
  if (ra) ra.onchange = (ev) => { S.recordAcct = ev.target.value; Store.updateSettings({ lastAcct: ev.target.value }); render(); };
  const rt = $('#recTransfer');
  if (rt) rt.onclick = doTransfer;
  $('#recDate').onchange = (ev) => { S.recordDate = ev.target.value || todayStr(); render(); };
  $('#btnParse').onclick = () => {
    const text = $('#smartText').value.trim();
    if (!text) { toast('请先输入内容'); return; }
    const items = Parser.parseText(text, incomeHints());
    if (!items.length) { toast('没有解析到金额，请检查格式'); return; }
    S.parsed = items.map(it => ({ ...it, catId: Store.categorize(it.note, it.type) }));
    S._smartText = text;
    render();
    $('#smartText').value = text;
  };
  /* AI 记账识别开关（在记账页上，勾了截图记账走 AI）：
     没配置模型时勾选 → 引导去配置并弹回；配置了 → 直接生效。 */
  const aiSw = $('#aiRecEnable');
  if (aiSw) aiSw.onchange = async (ev) => {
    if (ev.target.checked && !AI.ready()) {
      ev.target.checked = false;
      const go = await Modal.confirm('AI 记账识别需要先接入模型', {
        text: '勾选后，截图记账会用 AI 识别账单（比本地识别准很多）。\n先花一分钟接入一个模型（有免费的）：\n\n1. 去「个人中心 → 常规 → AI 模型接入」\n2. 服务商选「智谱 GLM」（glm-4v-flash 免费看图）\n3. 粘上你申请的 API Key，点「测试连接」\n\n数据只发给你自己选的服务商。不配置也能用本地识别。',
        okText: '去配置 →',
      });
      if (go) { S.tab = 'settings'; S.setSub = 'general'; render(); }
      return;
    }
    Store.updateSettings({ ai: { ...Store.getSettings().ai, enabled: ev.target.checked } });
    toast(ev.target.checked ? '截图记账将使用 AI 识别' : '截图记账将使用本地离线识别');
    render();   // 刷新截图按钮文案
  };

  /* 截图记账：选图 → 压缩 → AI（配置且勾选时）或本地离线识别 → 待确认列表。
     免配置也能用：本地识别不联网、不要密钥；配了 AI 并勾选就自动走 AI（更准）。 */
  const aiBtn = $('#btnAiShot');
  if (aiBtn) {
    const shotStatus = (msg) => { const el = $('#aiShotStatus'); if (el) el.innerHTML = msg; };
    aiBtn.onclick = () => $('#aiShotFile').click();
    $('#aiShotFile').onchange = async (ev) => {
      const f = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!f) return;
      aiBtn.disabled = true;
      const useAI = AI.ready() && Store.getSettings().ai.enabled !== false;
      try {
        shotStatus('⏳ 压缩图片…');
        const dataUrl = await AI.fileToDataUrl(f);
        let items;
        if (useAI) {
          shotStatus('⏳ AI 正在识别截图（多为几秒到半分钟）…');
          items = await AI.parseImage(dataUrl, todayStr());
        } else {
          const text = await OCR.recognize(dataUrl, shotStatus);
          items = OCR.parseBillText(text, todayStr());
        }
        // 归类：AI 给的分类名优先（精确→包含），认不出再按备注关键词
        const catByName = (name, type) => {
          if (!name) return null;
          const cats = Store.getCategories(type);
          const hit = cats.find(c => c.name === name) || cats.find(c => c.name.includes(name) || name.includes(c.name));
          return hit ? hit.id : null;
        };
        S.parsed = items.map(it => ({
          ...it,
          catId: catByName(it.category, it.type) || Store.categorize(it.note, it.type),
        }));
        S._smartText = '';
        toast(`识别出 ${items.length} 笔（${useAI ? 'AI' : '本地'}），请核对后保存`);
        render();
      } catch (err) {
        shotStatus('❌ ' + esc(err.message) + (useAI ? '' : '<br>本地识别对复杂截图有限，可在「个人中心→常规」接入 AI 模型提升效果。'));
        aiBtn.disabled = false;
      }
    };
  }

  const list = $('#parseList');
  if (list) list.addEventListener('click', (ev) => {
    const item = ev.target.closest('.parse-item'); if (!item) return;
    const i = +item.dataset.i;
    if (ev.target.classList.contains('p-del')) { S.parsed.splice(i, 1); render(); if (S._smartText) $('#smartText').value = S._smartText; }
    else if (ev.target.classList.contains('p-type')) {
      const p = S.parsed[i];
      p.type = p.type === 'expense' ? 'income' : 'expense';
      p.catId = Store.categorize(p.note, p.type);
      render(); if (S._smartText) $('#smartText').value = S._smartText;
    }
  });
  if (list) list.addEventListener('change', (ev) => {
    const item = ev.target.closest('.parse-item'); if (!item) return;
    const i = +item.dataset.i;
    if (ev.target.classList.contains('p-cat')) { S.parsed[i].catId = ev.target.value || null; S.parsed[i].manual = true; }
    if (ev.target.classList.contains('p-amt')) S.parsed[i].amount = parseFloat(ev.target.value) || 0;
  });
  const saveBtn = $('#btnSaveParsed');
  if (saveBtn) saveBtn.onclick = () => {
    const valid = S.parsed.filter(p => p.amount > 0);
    if (!valid.length) { toast('没有有效条目'); return; }
    let unassigned = 0;
    Store.addEntries(valid.map(p => {
      const r = resolveAcctFor(p.note);
      if (r.unassigned) unassigned++;
      // 截图记账解析出的条目自带日期（可能跨好几天），文本解析的用页面上选的日期
      return { date: p.date || S.recordDate, type: p.type, amount: p.amount, note: p.note, catId: p.catId, acctId: r.acctId, unassigned: r.unassigned, manual: !!p.manual };
    }));
    S.parsed = []; S._smartText = '';
    toast(unassigned > 0
      ? `已保存 ${valid.length} 笔 ✔ 其中 ${unassigned} 笔没认出账户（标了 ⚠），点该笔的 ✏️ 可指定账户`
      : `已保存 ${valid.length} 笔 ✔`);
    render();
  };
  // 手动
  $('#mExp').onclick = () => { S.manualType = 'expense'; render(); };
  $('#mInc').onclick = () => { S.manualType = 'income'; render(); };
  $('#mNote').addEventListener('input', (ev) => {
    const cid = Store.categorize(ev.target.value, S.manualType);
    if (cid) $('.m-cat').value = cid;
  });
  $('#btnManualSave').onclick = () => {
    const amt = parseFloat($('#mAmt').value);
    if (!amt || amt <= 0) { toast('请输入金额'); return; }
    const catId = $('.m-cat').value || null;
    const r = resolveAcctFor($('#mNote').value);
    Store.addEntry({ date: S.recordDate, type: S.manualType, amount: amt, note: $('#mNote').value, catId, acctId: r.acctId, unassigned: r.unassigned, manual: !!catId });
    toast(r.unassigned ? '已保存 ✔ 没认出账户（标了 ⚠），点 ✏️ 可指定' : '已保存 ✔'); render();
  };
  bindEntryOps($('#view'));
}

/* 条目通用操作（记账页 & 明细页共用） */
function bindEntryOps(root) {
  /* ⚠️ 幂等绑定：#view 是 index.html 里的固定元素，render() 只换它的 innerHTML、
     元素本身不变。每次 render 后都会调本函数，若直接 addEventListener 就会**层层累积**——
     用一会儿后点一次删除会同时触发十几个 handler、弹十几个叠加的 Modal，表现为「删不掉 + 卡死」。
     所以绑之前先摘掉上一次挂的 handler，保证任何时候 root 上只有一个。 */
  if (root._entryOpsHandler) root.removeEventListener('click', root._entryOpsHandler);
  /* 把某一行原地换成另一段 HTML，避免整页 render。
     以前点铅笔展开/取消都 render() 重建整月上百行 —— 桌面/慢机上明显卡顿，
     严重时点了半天没反应甚至白屏。现在只替换目标行，几乎零延迟。 */
  const swapRow = (row, html) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = html.trim();
    const fresh = tmp.firstElementChild;
    if (fresh) row.replaceWith(fresh);
    return fresh;
  };
  const handler = async (ev) => {
    const row = ev.target.closest('.entry'); if (!row) return;
    const id = row.dataset.id;
    const e = Store.getEntries().find(x => x.id === id); if (!e) return;
    if (ev.target.classList.contains('op-del')) {
      const ok = await Modal.confirm('删除这笔记录', {
        text: `${e.note || '（无备注）'}　${e.type === 'income' ? '+' : '-'}${e.amount}`,
        danger: true, okText: '删除',
      });
      if (ok) { Store.removeEntry(id); toast('已删除'); render(); }
    } else if (ev.target.classList.contains('op-edit') || ev.target.classList.contains('chip')) {
      swapRow(row, entryEditor(e));                       // 只展开这一行
    } else if (ev.target.classList.contains('ed-save')) {
      const type = row.querySelector('.ed-inc').classList.contains('on-income') ? 'income' : 'expense';
      const acctSel = row.querySelector('.ed-acct');
      const patch = {
        type,
        amount: parseFloat(row.querySelector('.ed-amt').value) || e.amount,
        note: row.querySelector('.ed-note').value,
        date: row.querySelector('.ed-date').value || e.date,
        catId: row.querySelector('.ed-cat').value || null,
        manual: true,
      };
      if (acctSel) patch.acctId = acctSel.value === Store.DEFAULT_ACCT ? null : acctSel.value;
      patch.unassigned = false;   // 用户亲手保存过 = 已确认账户归属，清掉「未分账」红标
      Store.updateEntry(id, patch);
      toast('已更新 ✔');
      // 日期/金额/分类变了会影响当日小计与筛选，整页 render 一次最稳（保存是低频操作）
      render();
    } else if (ev.target.classList.contains('ed-cancel')) {
      const fresh = Store.getEntries().find(x => x.id === id);
      swapRow(row, fresh ? entryRow(fresh) : '');         // 只收起这一行
    } else if (ev.target.classList.contains('ed-exp') || ev.target.classList.contains('ed-inc')) {
      /* 切换支/收：不再需要先保存。当场把分类下拉换成对应收/支的分类，
         并按备注自动归个类；金额框也跟着变收/支的颜色，一眼看出加减方向。 */
      const toIncome = ev.target.classList.contains('ed-inc');
      row.querySelector('.ed-exp').classList.toggle('on-expense', !toIncome);
      row.querySelector('.ed-inc').classList.toggle('on-income', toIncome);
      const newType = toIncome ? 'income' : 'expense';
      const noteVal = (row.querySelector('.ed-note') || {}).value || e.note || '';
      const guess = Store.categorize(noteVal, newType);
      const sel = row.querySelector('.ed-cat');
      if (sel) sel.outerHTML = catSelect(guess, newType, 'ed-cat');   // 立即换成新类型的分类
      const amt = row.querySelector('.ed-amt');
      if (amt) { amt.classList.toggle('amt-income', toIncome); amt.classList.toggle('amt-expense', !toIncome); }
    }
  };
  root._entryOpsHandler = handler;
  root.addEventListener('click', handler);
}

/* ============================================================
   明细页
============================================================ */
function viewDetail() {
  const all = Store.inMonth(S.detailMonth);
  const t = Store.totals(all);
  const dt = Store.debtTotals(all);
  // 月末的负债/债权累计余额
  const [dy, dm] = S.detailMonth.split('-').map(Number);
  const monthEnd = `${S.detailMonth}-${pad2(new Date(dy, dm, 0).getDate())}`;
  const bal = Store.balanceAsOf(monthEnd);
  // 月初负债 = 上月末负债（顺延）
  const openBal = Store.balanceAsOf(dateAdd(`${S.detailMonth}-01`, -1));
  const unknown = all.filter(e => !e.catId).length;
  let list = all;
  if (S.detailFilter === 'unknown') list = list.filter(e => !e.catId);
  else if (S.detailFilter === 'expense' || S.detailFilter === 'income') list = list.filter(e => e.type === S.detailFilter);
  else if (S.detailFilter === 'debt') list = list.filter(e => !!Store.debtKindOf(e));
  else if (S.detailFilter.startsWith('cat:')) { const cid = S.detailFilter.slice(4); list = list.filter(e => e.catId === cid); }
  if (S.detailSearch) list = list.filter(e => e.note.includes(S.detailSearch));

  // 按日期分组（倒序）
  const byDay = new Map();
  for (const e of list) { if (!byDay.has(e.date)) byDay.set(e.date, []); byDay.get(e.date).push(e); }
  const days = [...byDay.keys()].sort().reverse();

  const catsInMonth = new Set(all.map(e => e.catId).filter(Boolean));
  let catOpts = '';
  for (const c of Store.getCategories()) if (catsInMonth.has(c.id))
    catOpts += `<option value="cat:${c.id}" ${S.detailFilter === 'cat:' + c.id ? 'selected' : ''}>${esc(c.name)}</option>`;

  return `
  <div class="period-nav">
    <button class="pn-btn" id="dmPrev" title="上个月">‹</button>
    <button class="pn-label" id="dmPick" title="点这里选年月，或跳到某一天">
      ${S.detailMonth.replace('-', ' 年 ')} 月 <span style="font-size:.72rem;opacity:.55">▾</span>
    </button>
    <button class="pn-btn" id="dmNext" title="下个月">›</button>
    <button class="pn-btn" id="dmToday" title="回到本月" style="width:auto;padding:0 12px;font-size:.78rem;font-weight:600">今天</button>
  </div>
  <div class="row" style="margin-bottom:12px">
    <input type="date" id="dGoDate" value="${S.detailMonth}-01" title="选一天，直接跳过去">
    <button class="btn small narrow" id="dGo">跳到这天</button>
  </div>
  <div class="summary-strip">
    <div class="summary-box"><div class="s-label">本月支出</div><div class="s-val amt-expense">${fmtM(t.expense)}</div></div>
    <div class="summary-box"><div class="s-label">本月收入</div><div class="s-val amt-income">${fmtM(t.income)}</div></div>
    <div class="summary-box"><div class="s-label">结余</div><div class="s-val" style="color:${t.balance >= 0 ? 'var(--brand)' : 'var(--danger)'}">${t.balance >= 0 ? '+' : ''}${fmtM(t.balance)}</div></div>
    <div class="summary-box"><div class="s-label">真实结余</div><div class="s-val" style="color:${t.balanceReal >= 0 ? 'var(--brand)' : 'var(--danger)'}">${t.balanceReal >= 0 ? '+' : ''}${fmtM(t.balanceReal)}</div></div>
  </div>
  <div class="debt-strip">
    <div class="debt-box" title="${debtLabel(openBal.debt).tip}">
      <div class="d-label">月初负债（上月顺延）</div>
      <div class="d-val" style="color:${debtLabel(openBal.debt).color}">${debtLabel(openBal.debt).text}</div>
    </div>
    <div class="debt-box ${dt.debtChange > 0 ? 'warn' : ''}">
      <div class="d-label">本月借入 / 还款</div>
      <div class="d-val" style="font-size:.9rem">${fmtM(dt.borrow)} / ${fmtM(dt.repay)}</div>
    </div>
    <div class="debt-box ${bal.debt > 0 ? 'bad' : ''}" title="${debtLabel(bal.debt).tip}">
      <div class="d-label">月末负债</div>
      <div class="d-val" style="color:${debtLabel(bal.debt).color}">${debtLabel(bal.debt).text}</div>
    </div>
    <div class="debt-box ${bal.credit > 0 ? 'warn' : ''}">
      <div class="d-label">别人欠我</div>
      <div class="d-val">${fmtM(Math.max(bal.credit, 0))}</div>
    </div>
  </div>
  <div class="pill-group">
    <button class="pill ${S.detailFilter === 'all' ? 'active' : ''}" data-f="all">全部</button>
    <button class="pill ${S.detailFilter === 'unknown' ? 'active' : ''}" data-f="unknown">未知 ${unknown ? `<span class="badge">${unknown}</span>` : ''}</button>
    <button class="pill ${S.detailFilter === 'expense' ? 'active' : ''}" data-f="expense">支出</button>
    <button class="pill ${S.detailFilter === 'income' ? 'active' : ''}" data-f="income">收入</button>
    <button class="pill ${S.detailFilter === 'debt' ? 'active' : ''}" data-f="debt">借还款</button>
    <select id="dCatFilter" style="width:auto;padding:5px 8px;border-radius:20px;font-size:.8rem">
      <option value="">按分类…</option>${catOpts}
    </select>
  </div>
  <input type="text" id="dSearch" placeholder="🔍 搜索备注…" value="${esc(S.detailSearch)}" style="margin-bottom:12px">
  ${days.length ? days.map(d => {
    const es = byDay.get(d);
    const dt = Store.totals(es);
    return `<div class="day-group ${S._hitDate === d ? 'hit' : ''}" data-day="${d}">
      <div class="day-head"><b>${d}</b>&nbsp;周${weekdayCN(d)}
        <span><span class="amt-expense">支 ${fmtM(dt.expense)}</span> · <span class="amt-income">收 ${fmtM(dt.income)}</span></span>
      </div>
      <div class="day-list">${es.map(entryRow).join('')}</div>
    </div>`;
  }).join('') : '<div class="empty"><div class="big">📭</div>没有符合条件的记录</div>'}`;
}

function bindDetail() {
  $('#dmPrev').onclick = () => { S.detailMonth = shiftYM(S.detailMonth, -1); render(); };
  $('#dmNext').onclick = () => { S.detailMonth = shiftYM(S.detailMonth, 1); render(); };
  $('#dmToday').onclick = () => { S.detailMonth = todayStr().slice(0, 7); S._hitDate = null; render(); };
  $('#dmPick').onclick = async () => {
    const d = await pickPeriod('month', S.detailMonth + '-15');
    if (d) { S.detailMonth = d.slice(0, 7); S._hitDate = null; render(); }
  };
  const goDay = () => {
    const v = $('#dGoDate').value;
    if (!v) return;
    S.detailMonth = v.slice(0, 7);
    S._hitDate = v;                 // 渲染后滚过去并高亮
    S.detailFilter = 'all'; S.detailSearch = '';
    render();
  };
  $('#dGo').onclick = goDay;
  $('#dGoDate').onchange = goDay;
  $$('.pill[data-f]').forEach(b => b.onclick = () => { S.detailFilter = b.dataset.f; render(); });
  $('#dCatFilter').onchange = ev => { if (ev.target.value) { S.detailFilter = ev.target.value; render(); } };
  let t;
  $('#dSearch').addEventListener('input', ev => {
    clearTimeout(t); t = setTimeout(() => { S.detailSearch = ev.target.value.trim(); render(); const s = $('#dSearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 350);
  });
  bindEntryOps($('#view'));

  // 跳到某天：滚过去并高亮；那天没记账就提示一声
  if (S._hitDate) {
    const el = $(`.day-group[data-day="${S._hitDate}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else toast(`${S._hitDate} 这天没有记账`);
    S._hitDate = null;   // 只高亮这一次，避免每次重渲染都闪
  }
}
function shiftYM(ym, n) {
  let [y, m] = ym.split('-').map(Number);
  m += n; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
  return `${y}-${pad2(m)}`;
}

/* ============================================================
   统计页
============================================================ */
function statsRange() {
  const a = S.statsAnchor;
  switch (S.statsPeriod) {
    case 'day': return [a, a, a + ' 周' + weekdayCN(a)];
    case 'week': { const [s, e] = weekRange(a); return [s, e, `${s} ~ ${e.slice(5)}`]; }
    case 'month': { const ym = a.slice(0, 7); return [ym + '-01', ym + '-31', ym.replace('-', '年') + '月']; }
    case 'year': { const y = a.slice(0, 4); return [y + '-01-01', y + '-12-31', y + '年']; }
  }
}
function statsShift(n) {
  const a = S.statsAnchor;
  switch (S.statsPeriod) {
    case 'day': S.statsAnchor = dateAdd(a, n); break;
    case 'week': S.statsAnchor = dateAdd(a, n * 7); break;
    case 'month': S.statsAnchor = shiftYM(a.slice(0, 7), n) + '-15'; break; // 取 15 号做锚点，避免月末溢出
    case 'year': S.statsAnchor = (+a.slice(0, 4) + n) + a.slice(4); break;
  }
}

/* 当前时段内做趋势图用的切分粒度 */
function statsGrain() {
  return S.statsPeriod === 'year' ? 'month' : S.statsPeriod === 'month' ? 'day' : 'day';
}

function viewStats() {
  const [d1, d2, label] = statsRange();
  const list = Store.inRange(d1, d2);
  const t = Store.totals(list);
  const dt = Store.debtTotals(list);
  const bal = Store.balanceAsOf(d2);
  const openBal = Store.balanceAsOf(dateAdd(d1, -1));   // 期初负债 = 本期第一天前一天
  const rows = Store.catTotals(list, S.statsType);
  const hasDebt = dt.borrow || dt.repay || dt.lend || dt.collect || bal.debt || bal.credit || openBal.debt;
  return `
  <div class="pill-group">
    <button class="pill ${S.statsPeriod === 'day' ? 'active' : ''}" data-p="day">日</button>
    <button class="pill ${S.statsPeriod === 'week' ? 'active' : ''}" data-p="week">周</button>
    <button class="pill ${S.statsPeriod === 'month' ? 'active' : ''}" data-p="month">月</button>
    <button class="pill ${S.statsPeriod === 'year' ? 'active' : ''}" data-p="year">年</button>
    <button class="pill" data-p="today" style="margin-left:auto">回到今天</button>
  </div>
  <div class="period-nav">
    <button class="pn-btn" id="stPrev" title="上一个">‹</button>
    <button class="pn-label" id="stPick" title="点这里直接选日期">
      ${label} <span style="font-size:.72rem;opacity:.55">▾</span>
    </button>
    <button class="pn-btn" id="stNext" title="下一个">›</button>
  </div>
  <div class="summary-strip">
    <div class="summary-box"><div class="s-label">总支出</div><div class="s-val amt-expense">${fmtM(t.expense)}</div></div>
    <div class="summary-box"><div class="s-label">总收入</div><div class="s-val amt-income">${fmtM(t.income)}</div></div>
    <div class="summary-box"><div class="s-label">结余</div><div class="s-val" style="color:${t.balance >= 0 ? 'var(--brand)' : 'var(--danger)'}">${t.balance >= 0 ? '+' : ''}${fmtM(t.balance)}</div></div>
  </div>
  <div class="summary-strip">
    <div class="summary-box" title="${debtLabel(openBal.debt).tip}"><div class="s-label">期初负债</div><div class="s-val" style="color:${debtLabel(openBal.debt).color}">${debtLabel(openBal.debt).text}</div></div>
    <div class="summary-box"><div class="s-label">本期借入</div><div class="s-val" style="color:${dt.borrow > 0 ? 'var(--danger)' : 'var(--text-3)'}">${fmtM(dt.borrow)}</div></div>
    <div class="summary-box"><div class="s-label">本期还款</div><div class="s-val" style="color:${dt.repay > 0 ? 'var(--brand)' : 'var(--text-3)'}">${fmtM(dt.repay)}</div></div>
    <div class="summary-box" title="${debtLabel(bal.debt).tip}"><div class="s-label">期末负债</div><div class="s-val" style="color:${debtLabel(bal.debt).color}">${debtLabel(bal.debt).text}</div></div>
  </div>

  <div class="card">
    <div class="chart-tools">
      <span class="seg">
        <button id="stExp" class="${S.statsType === 'expense' ? 'on-expense' : ''}">支出</button>
        <button id="stInc" class="${S.statsType === 'income' ? 'on-income' : ''}">收入</button>
      </span>
      <span class="spacer"></span>
      <span class="seg-mini">
        <button class="${S.statsChart === 'pie' ? 'on' : ''}" data-sc="pie">🥧 扇形</button>
        <button class="${S.statsChart === 'bar' ? 'on' : ''}" data-sc="bar">📊 柱形</button>
        <button class="${S.statsChart === 'line' ? 'on' : ''}" data-sc="line">📈 折线</button>
      </span>
      <button class="btn ghost small" id="stExportPng">⬇ 存图</button>
    </div>
    ${rows.length ? `
      <div id="statsChartHere" class="chart-wrap"></div>
      <div style="margin-top:12px">
        ${rows.map(r => `
          <div class="cat-row cat-jump" data-cid="${r.catId}" style="cursor:pointer">
            <span class="c-ico" style="background:color-mix(in srgb, ${r.color} 15%, transparent)">${r.icon}</span>
            <span class="c-name">${esc(r.name)}<span class="c-cnt">（${r.count}笔）</span>
              <div class="bar-bg"><div class="bar-fg" style="width:${r.pct.toFixed(1)}%;background:${r.color}"></div></div>
            </span>
            <span class="c-amt">${fmtM(r.total)}</span>
            <span class="c-pct">${r.pct.toFixed(1)}%</span>
          </div>`).join('')}
      </div>` : '<div class="empty"><div class="big">🍂</div>该时段没有记录</div>'}
  </div>

  <div class="card">
    <h3>⚖️ 收支平衡
      <span style="float:right;font-size:.76rem;font-weight:400;color:var(--text-3)">柱：收入(上) / 支出(下)　虚线：结余</span>
    </h3>
    <div class="chart-wrap" id="balanceChart"></div>
  </div>

  ${S.statsPeriod === 'year' ? `
  <div class="card">
    <h3>🧮 各开销明细（分类 × 月份）
      <span style="float:right;font-size:.76rem;font-weight:400;color:var(--text-3)">每个分类下并排 12 个月</span>
    </h3>
    <div class="chart-wrap" id="matrixChart"></div>
    <div class="legend" id="matrixLegend"></div>
  </div>
  <div class="card">
    <h3>💰 积蓄与负债走势</h3>
    <div class="sub">积蓄 = 期初积蓄 ＋ 累计收入 − 累计支出，可在「账户」页设期初</div>
    <div class="chart-wrap" id="savingsChart"></div>
    <div class="legend">
      <span class="lg"><span class="dot" style="background:#0b8f66"></span>月末积蓄</span>
      <span class="lg"><span class="dot" style="background:#f0524c"></span>月末负债</span>
    </div>
    <div style="font-size:.76rem;color:var(--text-3);margin:12px 0 4px">每月结余（正=攒下，负=倒贴）</div>
    <div class="chart-wrap" id="netChart"></div>
  </div>` : ''}

  ${hasDebt ? `
  <div class="card">
    <h3>🏦 负债图谱</h3>
    <div class="debt-strip">
      <div class="debt-box" title="${debtLabel(openBal.debt).tip}">
        <div class="d-label">期初负债</div><div class="d-val" style="color:${debtLabel(openBal.debt).color}">${debtLabel(openBal.debt).text}</div>
      </div>
      <div class="debt-box"><div class="d-label">本期借入</div><div class="d-val" style="color:var(--danger)">${fmtM(dt.borrow)}</div></div>
      <div class="debt-box"><div class="d-label">本期还款</div><div class="d-val" style="color:var(--brand)">${fmtM(dt.repay)}</div></div>
      <div class="debt-box ${bal.debt > 0 ? 'bad' : 'good'}" title="${debtLabel(bal.debt).tip}">
        <div class="d-label">期末负债</div><div class="d-val" style="color:${debtLabel(bal.debt).color}">${debtLabel(bal.debt).text}</div>
      </div>
    </div>
    <div class="sub" style="margin:-4px 0 8px">期末 = 期初 ＋ 本期借入 − 本期还款；期初随上一期顺延</div>
    <div class="chart-wrap" id="debtChart"></div>
    <div class="legend">
      <span class="lg"><span class="dot" style="background:#c88a4a"></span>借入</span>
      <span class="lg"><span class="dot" style="background:#0b8f66"></span>还款</span>
      <span class="lg"><span class="dot" style="background:#f0524c"></span>负债余额</span>
    </div>
  </div>` : ''}`;
}

function bindStats() {
  $$('.pill[data-p]').forEach(b => b.onclick = () => {
    if (b.dataset.p === 'today') S.statsAnchor = todayStr();
    else S.statsPeriod = b.dataset.p;
    render();
  });
  $('#stPrev').onclick = () => { statsShift(-1); render(); };
  $('#stNext').onclick = () => { statsShift(1); render(); };
  $('#stPick').onclick = async () => {
    const d = await pickPeriod(S.statsPeriod, S.statsAnchor);
    if (d) { S.statsAnchor = d; render(); }
  };
  $('#stExp').onclick = () => { S.statsType = 'expense'; render(); };
  $('#stInc').onclick = () => { S.statsType = 'income'; render(); };
  $$('[data-sc]').forEach(b => b.onclick = () => { S.statsChart = b.dataset.sc; render(); });
  // 点分类行 → 跳到明细页按该分类筛选
  $$('.cat-jump').forEach(el => el.onclick = () => {
    const cid = el.dataset.cid;
    if (cid === '__unknown__') { S.detailFilter = 'unknown'; }
    else S.detailFilter = 'cat:' + cid;
    const [d1] = statsRange();
    S.detailMonth = d1.slice(0, 7);
    S.tab = 'analysis'; S.anaSub = 'detail'; render();
  });

  const [d1, d2] = statsRange();
  const list = Store.inRange(d1, d2);
  const rows = Store.catTotals(list, S.statsType);
  const grain = statsGrain();
  const bks = Store.buckets(d1, d2, grain);

  /* 主图：扇形 / 柱形 / 折线 */
  const host = $('#statsChartHere');
  if (host && rows.length) {
    if (S.statsChart === 'pie') {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;gap:18px;align-items:center;flex-wrap:wrap;justify-content:center';
      wrap.appendChild(Charts.pie(rows.map(r => ({ label: r.name, value: r.total, color: r.color }))));
      const lg = document.createElement('div');
      lg.className = 'legend';
      lg.style.cssText = 'flex:1;min-width:200px;margin-top:0';
      lg.innerHTML = rows.map(r => `<span class="lg"><span class="dot" style="background:${r.color}"></span>${esc(r.name)} ${r.pct.toFixed(0)}%</span>`).join('');
      wrap.appendChild(lg);
      host.appendChild(wrap);
    } else if (S.statsChart === 'bar') {
      // 分类金额排行（横向条）
      host.appendChild(Charts.hBar(rows.map(r => ({ label: r.name, value: r.total, color: r.color }))));
    } else {
      // 各分类随时间的走势
      const top = rows.slice(0, 6);
      const series = top.map(r => ({
        name: r.name, color: r.color,
        values: bks.map(b => Store.catTotals(Store.inRange(b.d1, b.d2), S.statsType).find(x => x.catId === r.catId)?.total || 0),
      }));
      host.appendChild(Charts.lineChart(bks.map(b => b.label), series, { height: 250 }));
      const lg = document.createElement('div');
      lg.className = 'legend';
      lg.innerHTML = series.map(s => `<span class="lg"><span class="dot" style="background:${s.color}"></span>${esc(s.name)}</span>`).join('')
        + (rows.length > 6 ? `<span class="lg" style="color:var(--text-3)">（仅显示金额前 6 的分类）</span>` : '');
      host.appendChild(lg);
    }
  }

  /* 收支平衡图 */
  const bc = $('#balanceChart');
  if (bc) {
    if (!list.length) bc.innerHTML = '<div class="empty">该时段没有记录</div>';
    else {
      const inc = [], exp = [];
      for (const b of bks) { const tt = Store.totals(Store.inRange(b.d1, b.d2)); inc.push(tt.income); exp.push(tt.expense); }
      bc.appendChild(Charts.balanceChart(bks.map(b => b.label), inc, exp));
    }
  }

  /* 年视图：分类 × 月份 矩阵图 + 积蓄走势 + 每月结余 */
  const mx = $('#matrixChart');
  if (mx) {
    const year = d1.slice(0, 4);
    const mat = Store.yearCatMatrix(year, S.statsType);
    const metaOf = (id) => id === '__unknown__'
      ? { name: '未知', color: '#b0b8b5' } : (Store.getCat(id) || { name: '已删分类', color: '#b0b8b5' });
    const cats = [...mat.entries()]
      .map(([id, arr]) => ({ id, arr, sum: arr.reduce((a, b) => a + b, 0), ...metaOf(id) }))
      .filter(c => c.sum > 0).sort((a, b) => b.sum - a.sum);
    if (!cats.length) mx.innerHTML = '<div class="empty">该年没有记录</div>';
    else {
      const MONTH_COLORS = ['#4f7fd9','#e8843c','#c9c93c','#8a6fc8','#3aa6a0','#d95f8f','#58a55c','#e05252','#5aa0c8','#b3845c','#7cb342','#9b6b6b'];
      mx.appendChild(Charts.matrixChart(
        cats.map(c => c.name),
        Array.from({ length: 12 }, (_, m) => ({
          name: (m + 1) + '月', color: MONTH_COLORS[m],
          values: cats.map(c => c.arr[m]),
        })), { height: 330 }));
      $('#matrixLegend').innerHTML = Array.from({ length: 12 }, (_, m) =>
        `<span class="lg"><span class="dot" style="background:${MONTH_COLORS[m]}"></span>${m + 1}月</span>`).join('');
    }
  }
  const sc = $('#savingsChart');
  if (sc) {
    const year = d1.slice(0, 4);
    const ser = Store.monthlySavingsSeries(year);
    const labels = Array.from({ length: 12 }, (_, i) => (i + 1) + '月');
    sc.appendChild(Charts.lineChart(labels, [
      { name: '月末积蓄', color: '#0b8f66', values: ser.map(s => s.savings) },
      { name: '月末负债', color: '#f0524c', values: ser.map(s => Math.max(s.debt, 0)) },
    ], { height: 220 }));
    const ms = Store.monthlySeries(year);
    $('#netChart').appendChild(Charts.divergingBars(labels, ms.map(m => m.balance), { height: 200 }));
  }

  /* 负债图谱：借入/还款柱 + 负债余额折线 */
  const dc = $('#debtChart');
  if (dc) {
    const borrow = [], repay = [], balSeries = [];
    for (const b of bks) {
      const tt = Store.debtTotals(Store.inRange(b.d1, b.d2));
      borrow.push(tt.borrow); repay.push(tt.repay);
      balSeries.push(Store.balanceAsOf(b.d2).debt);
    }
    const labels = bks.map(b => b.label);
    dc.appendChild(Charts.barChart(labels, [
      { name: '借入', color: '#c88a4a', values: borrow },
      { name: '还款', color: '#0b8f66', values: repay },
    ], { height: 200 }));
    const l2 = document.createElement('div');
    l2.style.cssText = 'font-size:.76rem;color:var(--text-3);margin:10px 0 4px';
    l2.textContent = '负债余额走势';
    dc.appendChild(l2);
    dc.appendChild(Charts.lineChart(labels, [{ name: '负债余额', color: '#f0524c', values: balSeries }], { height: 160 }));
  }

  /* 图谱导出 */
  const ex = $('#stExportPng');
  if (ex) ex.onclick = async () => {
    const svgs = $$('#view svg');
    if (!svgs.length) { toast('当前没有可导出的图表'); return; }
    try {
      const [dd1] = statsRange();
      let n = 0;
      for (const svg of svgs) {
        const blob = await Charts.svgToPng(svg, '', 2);
        await saveBlob(`记账图表-${dd1.slice(0, 7)}-${++n}.png`, blob, [{ name: 'PNG 图片', extensions: ['png'] }]);
      }
      toast(`已导出 ${n} 张图表`);
    } catch (err) { await Modal.alert('导出图片失败', err.message); }
  };
}

/* ============================================================
   对比页
============================================================ */
const YEAR_COLORS = ['#0f9d76', '#e08a3c', '#4f7fd9', '#d95f8f', '#8a6fc8', '#3aa6a0', '#b3845c'];

function viewCompare() {
  const years = Store.years();
  if (!S.cmpYears) S.cmpYears = new Set(years.slice(-2));
  const yrPills = years.length
    ? years.map(y => `<button class="pill yr ${S.cmpYears.has(y) ? 'active' : ''}" data-y="${y}">${y}年</button>`).join('')
    : '<span class="sub" style="margin:0">暂无数据</span>';

  return `
  <div class="pill-group">
    <button class="pill ${S.cmpMode === 'year' ? 'active' : ''}" data-m="year">📅 年度总览</button>
    <button class="pill ${S.cmpMode === 'expense' ? 'active' : ''}" data-m="expense">月度支出</button>
    <button class="pill ${S.cmpMode === 'income' ? 'active' : ''}" data-m="income">月度收入</button>
    <button class="pill ${S.cmpMode === 'catAll' ? 'active' : ''}" data-m="catAll">🔬 分类对比</button>
  </div>
  <div class="card">
    <h3>选择年份 <span style="float:right;font-size:.76rem;font-weight:400;color:var(--text-3)">可多选</span></h3>
    <div class="pill-group" style="margin:0">${yrPills}</div>
  </div>
  ${S.cmpMode === 'year' ? cmpYearView() : S.cmpMode === 'catAll' ? cmpCatAllView() : cmpMonthView()}`;
}

/* ---- 年度总览：各年总支出/收入/结余/负债 横向对比 ---- */
function cmpYearView() {
  return `
  <div class="card">
    <h3>各年度总览
      <button class="btn ghost small" id="cmpPng" style="float:right">⬇ 存图</button>
    </h3>
    <div class="chart-wrap" id="cmpYearChart"></div>
    <div class="legend">
      <span class="lg"><span class="dot" style="background:#f0524c"></span>总支出</span>
      <span class="lg"><span class="dot" style="background:#2f7cf6"></span>总收入</span>
      <span class="lg"><span class="dot" style="background:#0b8f66"></span>结余</span>
    </div>
  </div>
  <div class="card">
    <h3>年度对比明细</h3>
    <div class="table-scroll" id="cmpYearTable"></div>
  </div>
  <div class="card">
    <h3>各年份 · 分类支出结构</h3>
    <div class="sub">同一分类在不同年份的金额并排放，看哪些开销在涨、哪些在降</div>
    <div class="chart-wrap" id="cmpYearCatChart"></div>
    <div class="legend" id="cmpYearCatLegend"></div>
  </div>`;
}

/* ---- 月度对比（原有）---- */
function cmpMonthView() {
  return `
  <div class="card">
    <div class="chart-tools">
      <b style="font-size:.95rem">${S.cmpMode === 'expense' ? '各年份月度支出' : '各年份月度收入'}（元）</b>
      <span class="spacer"></span>
      <span class="seg-mini">
        <button class="${S.cmpChart === 'bar' ? 'on' : ''}" data-c="bar">柱状</button>
        <button class="${S.cmpChart === 'line' ? 'on' : ''}" data-c="line">折线</button>
      </span>
      <button class="btn ghost small" id="cmpPng">⬇ 存图</button>
    </div>
    <div class="chart-wrap" id="cmpChart"></div>
    <div class="legend" id="cmpLegend"></div>
  </div>
  <div class="card">
    <h3>数据表</h3>
    <div class="table-scroll" id="cmpTable"></div>
  </div>`;
}

/* ---- 分类对比：全部矩阵 ↔ 单项细看 ---- */
function cmpCatAllView() {
  const cats = Store.getCategories(S.cmpCatType);
  return `
  <div class="card">
    <div class="chart-tools">
      <span class="seg">
        <button id="caExp" class="${S.cmpCatType === 'expense' ? 'on-expense' : ''}">支出</button>
        <button id="caInc" class="${S.cmpCatType === 'income' ? 'on-income' : ''}">收入</button>
      </span>
      <span class="spacer"></span>
      <span class="seg-mini">
        <button class="${!S.cmpCat ? 'on' : ''}" data-scope="all">全部分类</button>
        <button class="${S.cmpCat ? 'on' : ''}" data-scope="one">单项细看</button>
      </span>
      <span class="seg-mini">
        <button class="${S.cmpMini === 'bar' ? 'on' : ''}" data-mini="bar">柱状</button>
        <button class="${S.cmpMini === 'line' ? 'on' : ''}" data-mini="line">折线</button>
      </span>
    </div>
    ${S.cmpCat ? `
      <label class="fld">选择分类</label>
      <select id="cmpCatSel">
        ${cats.map(c => `<option value="${c.id}" ${S.cmpCat === c.id ? 'selected' : ''}>${c.icon || ''} ${esc(c.name)}</option>`).join('')}
        <option value="__unknown__" ${S.cmpCat === '__unknown__' ? 'selected' : ''}>❓ 未知</option>
      </select>
      <div id="oneCatBox" style="margin-top:14px"></div>
    ` : `
      <div class="sub" style="margin-top:0">每个分类一张 12 个月走势图，按合计金额从大到小排。点分类名可跳到明细，点卡片可切到单项细看。</div>
      <div class="mini-grid" id="miniGrid"></div>
    `}
  </div>
  <div class="card">
    <h3>${S.cmpCat ? '该分类逐月明细' : '分类 × 年份 全量对比表'}</h3>
    <div class="sub">${S.cmpCat ? '各年份同月并排，看这项开销的季节性和同比变化' : '每个分类在各年份的合计与同比差额'}</div>
    <div class="table-scroll" id="catAllTable"></div>
  </div>`;
}

function bindCompare() {
  $$('.pill[data-m]').forEach(b => b.onclick = () => { S.cmpMode = b.dataset.m; render(); });
  $$('.pill.yr').forEach(b => b.onclick = () => {
    const y = b.dataset.y;
    if (S.cmpYears.has(y)) S.cmpYears.delete(y); else S.cmpYears.add(y);
    render();
  });
  $$('[data-c]').forEach(b => b.onclick = () => { S.cmpChart = b.dataset.c; render(); });
  $$('[data-mini]').forEach(b => b.onclick = () => { S.cmpMini = b.dataset.mini; render(); });
  $$('[data-scope]').forEach(b => b.onclick = () => {
    if (b.dataset.scope === 'all') S.cmpCat = '';
    else if (!S.cmpCat) S.cmpCat = Store.getCategories(S.cmpCatType)[0]?.id || '';
    render();
  });
  const ce = $('#caExp'), ci = $('#caInc');
  if (ce) ce.onclick = () => { S.cmpCatType = 'expense'; S.cmpCat = ''; render(); };
  if (ci) ci.onclick = () => { S.cmpCatType = 'income'; S.cmpCat = ''; render(); };
  const csel = $('#cmpCatSel');
  if (csel) csel.onchange = ev => { S.cmpCat = ev.target.value; render(); };

  const png = $('#cmpPng');
  if (png) png.onclick = async () => {
    const svg = $('#view svg');
    if (!svg) { toast('当前没有可导出的图表'); return; }
    try {
      const blob = await Charts.svgToPng(svg, '', 2);
      await saveBlob(`记账对比图-${todayStr()}.png`, blob, [{ name: 'PNG 图片', extensions: ['png'] }]);
      toast('图表已导出');
    } catch (err) { await Modal.alert('导出图片失败', err.message); }
  };

  const years = [...S.cmpYears].sort();
  if (!years.length) {
    const host = $('#cmpChart') || $('#cmpYearChart') || $('#miniGrid');
    if (host) host.innerHTML = '<div class="empty">请在上面勾选至少一个年份</div>';
    return;
  }
  if (S.cmpMode === 'year') bindCmpYear(years);
  else if (S.cmpMode === 'catAll') bindCmpCatAll(years);
  else bindCmpMonth(years);
}

/* ---- 年度总览 ---- */
function bindCmpYear(years) {
  const rows = years.map(y => {
    const t = Store.totals(Store.inYear(y));
    const d = Store.debtTotals(Store.inYear(y));
    return { y, ...t, ...d, debtEnd: Store.balanceAsOf(y + '-12-31').debt };
  });
  $('#cmpYearChart').appendChild(Charts.barChart(
    rows.map(r => r.y + '年'),
    [
      { name: '总支出', color: '#f0524c', values: rows.map(r => r.expense) },
      { name: '总收入', color: '#2f7cf6', values: rows.map(r => r.income) },
      { name: '结余', color: '#0b8f66', values: rows.map(r => Math.max(r.balance, 0)) },
    ], { height: 260, width: Math.max(420, rows.length * 130 + 90) }));

  // 明细表
  const f = (v) => v ? fmtM(v) : '—';
  let html = '<table class="simple"><thead><tr><th>项目</th>' + rows.map(r => `<th>${r.y}年</th>`).join('');
  if (rows.length >= 2) html += '<th>末年 − 首年</th>';
  html += '</tr></thead><tbody>';
  const lines = [
    ['总支出', r => r.expense, 'expense'],
    ['总收入', r => r.income, 'income'],
    ['结余', r => r.balance, 'balance'],
    ['真实支出（不含还款/借出）', r => r.expenseReal],
    ['真实收入（不含借入/收回）', r => r.incomeReal],
    ['真实结余', r => r.balanceReal, 'balance'],
    ['借入', r => r.borrow],
    ['还款', r => r.repay],
    ['年末负债余额', r => r.debtEnd, 'debt'],
    ['月均支出', r => Math.round(r.expense / 12 * 100) / 100],
  ];
  for (const [name, get, kind] of lines) {
    html += `<tr><td>${name}</td>` + rows.map(r => {
      const v = get(r);
      const cls = kind === 'expense' ? 'amt-expense' : kind === 'income' ? 'amt-income' : '';
      const st = kind === 'balance' ? `style="color:${v >= 0 ? 'var(--brand)' : 'var(--danger)'}"` : kind === 'debt' && v > 0 ? 'style="color:var(--danger)"' : '';
      return `<td class="${cls}" ${st}>${f(v)}</td>`;
    }).join('');
    if (rows.length >= 2) {
      const d = get(rows[rows.length - 1]) - get(rows[0]);
      // 支出涨了是红（不好），收入/结余涨了是绿（好）
      const bad = (kind === 'expense' || kind === 'debt') ? d > 0 : d < 0;
      html += `<td style="color:${d === 0 ? 'var(--text-3)' : bad ? 'var(--danger)' : 'var(--brand)'};font-weight:700">${d ? (d > 0 ? '+' : '') + fmtM(d) : '—'}</td>`;
    }
    html += '</tr>';
  }
  $('#cmpYearTable').innerHTML = html + '</tbody></table>';

  // 分类结构对比（各年份并排）
  const catIds = new Set();
  const perYear = years.map(y => {
    const m = new Map(Store.catTotals(Store.inYear(y), 'expense').map(r => [r.catId, r]));
    for (const k of m.keys()) catIds.add(k);
    return m;
  });
  const ordered = [...catIds].map(id => ({
    id,
    total: perYear.reduce((s, m) => s + (m.get(id)?.total || 0), 0),
    ref: perYear.find(m => m.get(id))?.get(id),
  })).sort((a, b) => b.total - a.total).slice(0, 14);
  if (ordered.length) {
    $('#cmpYearCatChart').appendChild(Charts.barChart(
      ordered.map(o => o.ref.name),
      years.map((y, i) => ({
        name: y + '年', color: YEAR_COLORS[i % YEAR_COLORS.length],
        values: ordered.map(o => perYear[i].get(o.id)?.total || 0),
      })), { height: 270, width: Math.max(640, ordered.length * years.length * 22 + 100) }));
    $('#cmpYearCatLegend').innerHTML = years.map((y, i) =>
      `<span class="lg"><span class="dot" style="background:${YEAR_COLORS[i % YEAR_COLORS.length]}"></span>${y}年</span>`).join('')
      + (catIds.size > 14 ? '<span class="lg" style="color:var(--text-3)">（仅显示金额前 14 的分类）</span>' : '');
  }
}

/* ---- 月度对比 ---- */
function bindCmpMonth(years) {
  const labels = Array.from({ length: 12 }, (_, i) => (i + 1) + '月');
  const series = years.map((y, i) => {
    const ms = Store.monthlySeries(y);
    return {
      name: y + '年', color: YEAR_COLORS[i % YEAR_COLORS.length],
      values: ms.map(m => S.cmpMode === 'expense' ? m.expense : m.income),
    };
  });
  const chart = S.cmpChart === 'line' ? Charts.lineChart(labels, series) : Charts.barChart(labels, series);
  $('#cmpChart').appendChild(chart);
  $('#cmpLegend').innerHTML = series.map(s => `<span class="lg"><span class="dot" style="background:${s.color}"></span>${s.name}</span>`).join('');

  let thead = '<tr><th>月份</th>' + series.map(s => `<th>${s.name}</th>`).join('');
  if (series.length === 2) thead += '<th>差额</th>';
  thead += '</tr>';
  let tbody = '';
  for (let m = 0; m < 12; m++) {
    tbody += `<tr><td>${m + 1}月</td>` + series.map(s => `<td>${s.values[m] ? fmtM(s.values[m]) : '—'}</td>`).join('');
    if (series.length === 2) {
      const diff = (series[1].values[m] || 0) - (series[0].values[m] || 0);
      tbody += `<td style="color:${diff > 0 ? 'var(--danger)' : 'var(--brand)'}">${diff ? (diff > 0 ? '+' : '') + fmtM(diff) : '—'}</td>`;
    }
    tbody += '</tr>';
  }
  let tfoot = `<tr style="font-weight:700"><td>合计</td>` + series.map(s => `<td>${fmtM(s.values.reduce((a, b) => a + b, 0))}</td>`).join('');
  if (series.length === 2) {
    const d = series[1].values.reduce((a, b) => a + b, 0) - series[0].values.reduce((a, b) => a + b, 0);
    tfoot += `<td style="color:${d > 0 ? 'var(--danger)' : 'var(--brand)'}">${(d > 0 ? '+' : '') + fmtM(d)}</td>`;
  }
  $('#cmpTable').innerHTML = `<table class="simple"><thead>${thead}</thead><tbody>${tbody}${tfoot}</tr></tbody></table>`;
}

/* ---- 分类对比：全部矩阵 / 单项细看 ---- */
function catMeta(id) {
  return id === '__unknown__'
    ? { name: '未知', color: '#b0b8b5', icon: '❓' }
    : (Store.getCat(id) || { name: '已删分类', color: '#b0b8b5', icon: '🏷️' });
}

function bindCmpCatAll(years) {
  const type = S.cmpCatType;
  const mats = years.map(y => Store.yearCatMatrix(y, type));
  const labels = Array.from({ length: 12 }, (_, i) => (i + 1) + '月');

  /* —— 单项细看 —— */
  if (S.cmpCat) {
    const r = catMeta(S.cmpCat);
    const perYear = mats.map(m => m.get(S.cmpCat) || new Array(12).fill(0));
    const sums = perYear.map(a => Math.round(a.reduce((x, y) => x + y, 0) * 100) / 100);
    const series = years.map((y, i) => ({ name: y + '年', color: YEAR_COLORS[i % YEAR_COLORS.length], values: perYear[i] }));
    const box = $('#oneCatBox');
    box.innerHTML = `
      <div class="debt-strip" style="margin-bottom:12px">
        ${years.map((y, i) => `
          <div class="debt-box" style="border-left-color:${YEAR_COLORS[i % YEAR_COLORS.length]}">
            <div class="d-label">${y}年合计</div><div class="d-val">${fmtM(sums[i])}</div>
            <div style="font-size:.68rem;color:var(--text-3);margin-top:2px">月均 ${Charts.fmt(sums[i] / 12)}</div>
          </div>`).join('')}
      </div>
      <div class="chart-wrap" id="oneCatChart"></div>
      <div class="legend">${series.map(s => `<span class="lg"><span class="dot" style="background:${s.color}"></span>${s.name}</span>`).join('')}</div>
      <button class="btn ghost small" id="oneCatDetail" style="margin-top:10px">查看「${esc(r.name)}」明细</button>`;
    const chart = S.cmpMini === 'line'
      ? Charts.lineChart(labels, series, { height: 260 })
      : Charts.barChart(labels, series, { height: 260 });
    $('#oneCatChart').appendChild(chart);
    $('#oneCatDetail').onclick = () => {
      S.detailFilter = S.cmpCat === '__unknown__' ? 'unknown' : 'cat:' + S.cmpCat;
      S.detailMonth = years[years.length - 1] + '-01';
      S.tab = 'analysis'; S.anaSub = 'detail'; render();
    };

    // 逐月明细表
    let h = '<table class="simple"><thead><tr><th>月份</th>' + years.map(y => `<th>${y}年</th>`).join('');
    if (years.length >= 2) h += '<th>末年 − 首年</th>';
    h += '</tr></thead><tbody>';
    for (let m = 0; m < 12; m++) {
      h += `<tr><td>${m + 1}月</td>` + perYear.map(a => `<td>${a[m] ? fmtM(a[m]) : '—'}</td>`).join('');
      if (years.length >= 2) {
        const d = perYear[perYear.length - 1][m] - perYear[0][m];
        const bad = type === 'expense' ? d > 0 : d < 0;
        h += `<td style="color:${d === 0 ? 'var(--text-3)' : bad ? 'var(--danger)' : 'var(--brand)'}">${d ? (d > 0 ? '+' : '') + fmtM(d) : '—'}</td>`;
      }
      h += '</tr>';
    }
    h += `<tr style="font-weight:800"><td>合计</td>` + sums.map(v => `<td>${fmtM(v)}</td>`).join('');
    if (years.length >= 2) {
      const d = sums[sums.length - 1] - sums[0];
      const bad = type === 'expense' ? d > 0 : d < 0;
      h += `<td style="color:${bad ? 'var(--danger)' : 'var(--brand)'}">${(d > 0 ? '+' : '') + fmtM(d)}</td>`;
    }
    $('#catAllTable').innerHTML = h + '</tr></tbody></table>';
    return;
  }

  /* —— 全部分类矩阵 —— */
  const catIds = new Set();
  for (const m of mats) for (const k of m.keys()) catIds.add(k);
  const rows = [...catIds].map(id => {
    const perYear = mats.map(m => m.get(id) || new Array(12).fill(0));
    const sums = perYear.map(a => Math.round(a.reduce((x, y2) => x + y2, 0) * 100) / 100);
    return { id, ...catMeta(id), perYear, sums, grand: sums.reduce((a, b) => a + b, 0) };
  }).filter(r => r.grand > 0).sort((a, b) => b.grand - a.grand);

  const grid = $('#miniGrid');
  if (!rows.length) { grid.innerHTML = '<div class="empty">所选年份没有该类型的记录</div>'; return; }

  grid.innerHTML = '';
  for (const r of rows) {
    const card = document.createElement('div');
    card.className = 'mini-card';
    card.style.cursor = 'pointer';
    const diff = r.sums.length >= 2 ? r.sums[r.sums.length - 1] - r.sums[0] : 0;
    const bad = type === 'expense' ? diff > 0 : diff < 0;
    card.innerHTML = `
      <div class="m-head">
        <span class="m-ico">${r.icon}</span>
        <span class="m-name" title="点分类名看明细，点卡片单项细看">${esc(r.name)}</span>
        ${r.sums.length >= 2 ? `<span class="m-diff" style="color:${diff === 0 ? 'var(--text-3)' : bad ? 'var(--danger)' : 'var(--brand)'}">${diff > 0 ? '+' : ''}${Charts.fmt(diff)}</span>` : ''}
      </div>
      <div class="m-vals">${years.map((y, i) =>
        `<span class="m-v"><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${YEAR_COLORS[i % YEAR_COLORS.length]};margin-right:3px"></span>${y.slice(2)}: <b>${Charts.fmt(r.sums[i])}</b></span>`).join('')}</div>`;
    const series = years.map((y, i) => ({ name: y + '年', color: YEAR_COLORS[i % YEAR_COLORS.length], values: r.perYear[i] }));
    card.appendChild(S.cmpMini === 'line' ? Charts.sparkLines(labels, series, { axis: true }) : Charts.sparkBars(labels, series, { axis: true }));
    // 点卡片 → 单项细看；点分类名 → 直接看明细
    card.onclick = () => { S.cmpCat = r.id; render(); };
    card.querySelector('.m-name').onclick = (e) => {
      e.stopPropagation();
      S.detailFilter = r.id === '__unknown__' ? 'unknown' : 'cat:' + r.id;
      S.detailMonth = years[years.length - 1] + '-01';
      S.tab = 'analysis'; S.anaSub = 'detail'; render();
    };
    grid.appendChild(card);
  }

  // 全量对比表
  let html = '<table class="simple"><thead><tr><th>分类</th>' + years.map(y => `<th>${y}年</th>`).join('');
  if (years.length >= 2) html += '<th>末年 − 首年</th><th>变化</th>';
  html += '</tr></thead><tbody>';
  for (const r of rows) {
    html += `<tr><td>${r.icon} ${esc(r.name)}</td>` + r.sums.map(v => `<td>${v ? fmtM(v) : '—'}</td>`).join('');
    if (years.length >= 2) {
      const d = r.sums[r.sums.length - 1] - r.sums[0];
      const base = r.sums[0];
      const pct = base ? (d / base * 100) : null;
      const bad = type === 'expense' ? d > 0 : d < 0;
      const color = d === 0 ? 'var(--text-3)' : bad ? 'var(--danger)' : 'var(--brand)';
      html += `<td style="color:${color};font-weight:700">${d ? (d > 0 ? '+' : '') + fmtM(d) : '—'}</td>`;
      html += `<td style="color:${color}">${pct === null ? '新增' : (pct > 0 ? '+' : '') + pct.toFixed(0) + '%'}</td>`;
    }
    html += '</tr>';
  }
  const totals = years.map((_, i) => rows.reduce((s, r) => s + r.sums[i], 0));
  html += `<tr style="font-weight:800"><td>合计</td>` + totals.map(v => `<td>${fmtM(v)}</td>`).join('');
  if (years.length >= 2) {
    const d = totals[totals.length - 1] - totals[0];
    const bad = type === 'expense' ? d > 0 : d < 0;
    html += `<td style="color:${bad ? 'var(--danger)' : 'var(--brand)'}">${(d > 0 ? '+' : '') + fmtM(d)}</td><td></td>`;
  }
  $('#catAllTable').innerHTML = html + '</tr></tbody></table>';
}

/* ============================================================
   分类页
============================================================ */
function viewCategory() {
  const unknown = Store.unknownCount();
  const cats = Store.getCategories(S.catType);
  // 每个分类的累计金额与笔数
  const stat = new Map();
  for (const e of Store.getEntries()) {
    if (!e.catId) continue;
    const s = stat.get(e.catId) || { total: 0, count: 0 };
    s.total += e.amount; s.count++; stat.set(e.catId, s);
  }
  const btn = (c) => {
    const s = stat.get(c.id) || { total: 0, count: 0 };
    const kwn = (c.keywords || []).length;
    return `
    <button class="cat-btn ${S.catOpen === c.id ? 'on' : ''}" data-cid="${c.id}">
      ${kwn ? `<span class="cb-kwn" title="${kwn} 个关键词">${kwn}词</span>` : ''}
      <span class="cb-ico" style="background:color-mix(in srgb, ${c.color} 16%, transparent)">${c.icon || '🏷️'}</span>
      <span class="cb-name">${esc(c.name)}</span>
      <span class="cb-sum">${s.count ? Charts.fmt(s.total) : '—'}</span>
    </button>`;
  };
  return `
  <div class="card">
    <h3>🤖 自动归类</h3>
    <div class="sub">当前有 <b style="color:var(--danger)">${unknown}</b> 笔「未知」记录。给分类补关键词后，可一键重新归类。</div>
    <div class="row">
      <button class="btn" id="btnReUnknown">归类未知记录</button>
      <button class="btn ghost" id="btnReAll">全部重新归类</button>
      ${unknown ? '<button class="btn ghost" id="btnGoUnknown">去处理未知</button>' : ''}
    </div>
    <div class="sub" style="margin:8px 0 0">「全部重新归类」只影响自动归类的记录，手动指定过分类的不会被改动。</div>
  </div>

  <div class="card">
    <div class="chart-tools">
      <span class="seg">
        <button id="ctExp" class="${S.catType === 'expense' ? 'on-expense' : ''}">支出分类</button>
        <button id="ctInc" class="${S.catType === 'income' ? 'on-income' : ''}">收入分类</button>
      </span>
      <span class="spacer"></span>
      <button class="btn ghost small" id="btnBatchCat">＋＋ 批量添加</button>
      <span style="font-size:.76rem;color:var(--text-3)">共 ${cats.length} 个 · 点击查看和编辑</span>
    </div>
    <div class="cat-grid">
      ${cats.map(btn).join('')}
      <button class="cat-btn cat-add-btn" id="btnAddCat">
        <span class="cb-ico" style="background:var(--track)">＋</span>
        <span class="cb-name">新建分类</span>
      </button>
    </div>
    ${S.catOpen ? catPanel(S.catOpen) : ''}
  </div>

  <div class="card">
    <button class="btn danger block" id="btnResetCats">恢复默认分类（不影响账目记录）</button>
  </div>`;
}

/* 常用图标，供分类选择（点一下即换，不用自己去表情面板找） */
const ICON_CHOICES = [
  '🍚','🍜','🍻','🛒','🍉','🍪','🧋','☕','🍰','🍗',
  '🏠','💡','📶','🚇','🚗','🚄','✈️','⛽','🅿️','🚲',
  '🧺','📦','👕','👟','👜','💄','💇','🧴','🛁','🧻',
  '💊','🏥','🦷','📚','✏️','🎓','🎮','🎬','🎤','🏀',
  '📱','💻','🎧','⌚','🔌','🐱','🐶','🌱','🎁','🧧',
  '💰','💳','🏦','📈','📉','💵','🪙','🤝','🔙','❤️',
  '👶','🍼','👨‍👩‍👧','🎂','🍭','🏖️','🛠️','🧾','🏷️','⭐',
];

/* 分类详情抽屉：改名/图标/颜色/关键词 + 最近记录 */
function catPanel(id) {
  const c = Store.getCat(id);
  if (!c) return '';
  const mine = Store.getEntries().filter(e => e.catId === id);
  const total = mine.reduce((s, e) => s + e.amount, 0);
  const recent = [...mine].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  const kws = c.keywords || [];
  const DEBT_OPTS = [
    ['', '普通收支'],
    ['borrow', '借入（钱进来但是欠的 → 负债+）'],
    ['repay', '还款（还出去 → 负债−）'],
    ['lend', '借出（借给别人 → 债权+）'],
    ['collect', '收回借出（别人还我 → 债权−）'],
  ];
  return `
  <div class="cat-panel" data-id="${id}">
    <div class="cp-head">
      <span class="cp-ico" style="background:color-mix(in srgb, ${c.color} 18%, transparent)">${c.icon || '🏷️'}</span>
      <span class="cp-t">
        <b>${esc(c.name)}</b>
        <div>${mine.length} 笔 · 累计 ${fmtM(total)} 元${c.debt ? ' · 往来款' : ''}</div>
      </span>
      <button class="btn ghost small" id="cpDetail">查看明细</button>
      <button class="cp-close" id="cpClose">✕</button>
    </div>

    <div class="row">
      <input class="cp-icon narrow" type="text" value="${esc(c.icon || '🏷️')}" maxlength="4" title="图标：可粘贴任意表情" style="flex:0 0 54px;text-align:center">
      <input class="cp-color narrow" type="color" value="${toHexColor(c.color)}" style="flex:0 0 44px;height:40px;padding:2px;border:1.5px solid var(--line);border-radius:11px;background:var(--card);cursor:pointer">
      <input class="cp-name" type="text" value="${esc(c.name)}" placeholder="分类名称">
      <button class="btn danger small narrow" id="cpDel">删除</button>
    </div>

    <label class="fld">选择图标（点一下即换，也可在左边框里粘贴任意表情）</label>
    <div class="icon-pick">
      ${ICON_CHOICES.map(ic => `<button type="button" class="ic-opt${ic === (c.icon || '') ? ' on' : ''}" data-ic="${ic}">${ic}</button>`).join('')}
    </div>

    <label class="fld">往来款属性（用于负债核算）</label>
    <select class="cp-debt">
      ${DEBT_OPTS.map(([v, t]) => `<option value="${v}" ${(c.debt || '') === v ? 'selected' : ''}>${t}</option>`).join('')}
    </select>

    <label class="fld">关键词（备注里出现这些词就自动归到本类）</label>
    <div class="kw-box">
      ${kws.length ? kws.map((k, i) => `<span class="kw-tag">${esc(k)}<button class="kw-del" data-i="${i}" title="删除">✕</button></span>`).join('')
        : '<span style="font-size:.74rem;color:var(--text-3);padding:3px">还没有关键词，下面添加</span>'}
    </div>
    <div class="row" style="margin-top:7px">
      <input class="cp-newkw" type="text" placeholder="输入关键词后回车添加，可用逗号一次加多个">
      <button class="btn small narrow" id="cpAddKw">添加</button>
    </div>

    <label class="fld">最近记录</label>
    ${recent.length ? `<div class="cp-recent">${recent.map(e => `
      <div class="entry" style="border-bottom:1px solid var(--line)">
        <span class="e-mid">
          <div class="e-cat" style="font-size:.78rem">${e.date}</div>
          <div class="e-note">${esc(e.note) || '（无备注）'}</div>
        </span>
        <span class="e-amt ${e.type === 'expense' ? 'amt-expense' : 'amt-income'}">${e.type === 'expense' ? '-' : '+'}${fmtM(e.amount)}</span>
      </div>`).join('')}</div>`
      : '<div style="font-size:.78rem;color:var(--text-3);padding:8px 2px">这个分类还没有记录</div>'}
  </div>`;
}

function toHexColor(c) {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  // hsl / 颜色名 -> hex（借 canvas 做转换）
  const ctx = toHexColor._ctx || (toHexColor._ctx = document.createElement('canvas').getContext('2d'));
  ctx.fillStyle = '#000'; ctx.fillStyle = c;
  return /^#[0-9a-f]{6}$/i.test(ctx.fillStyle) ? ctx.fillStyle : '#888888';
}

function bindCategory() {
  $('#btnReUnknown').onclick = () => { const n = Store.recategorize(true); toast(`已归类 ${n} 笔`); render(); };
  $('#btnReAll').onclick = async () => {
    if (!(await Modal.confirm('全部重新归类', { text: '按当前关键词重新匹配所有「自动归类」的记录。\n你手动指定过分类的记录不受影响。' }))) return;
    const n = Store.recategorize(false); toast(`已更新 ${n} 笔`); render();
  };
  const gu = $('#btnGoUnknown');
  if (gu) gu.onclick = () => { S.detailFilter = 'unknown'; S.tab = 'analysis'; S.anaSub = 'detail'; render(); };
  $('#btnResetCats').onclick = async () => {
    if (!(await Modal.confirm('恢复默认分类', {
      text: '自定义分类会被移除，这些分类下的记录变成「未知」（记录本身不会丢，可以重新归类）。',
      okText: '恢复默认', danger: true,
    }))) return;
    Store.resetCategoriesToDefault(); S.catOpen = null; toast('已恢复默认分类'); render();
  };
  $('#ctExp').onclick = () => { S.catType = 'expense'; S.catOpen = null; render(); };
  $('#ctInc').onclick = () => { S.catType = 'income'; S.catOpen = null; render(); };
  const typeName = () => S.catType === 'expense' ? '支出' : '收入';
  $('#btnAddCat').onclick = async () => {
    const name = await Modal.prompt(`新建${typeName()}分类`, {
      placeholder: '分类名称，例如：宠物',
      hint: '建好后可以点开它设置图标、颜色和关键词。',
    });
    if (!name) return;
    const c = Store.addCategory(S.catType, name);
    S.catOpen = c.id; render();
    toast(`已添加「${name}」`);
  };
  $('#btnBatchCat').onclick = async () => {
    const text = await Modal.promptMulti(`批量添加${typeName()}分类`, {
      rows: 8,
      placeholder: '宠物\n🐱 猫: 猫粮, 猫砂\n孩子教育: 学费, 补课, 兴趣班',
      hint: '一行一个分类。<br>· 想带关键词就写成 <b>分类名: 关键词1, 关键词2</b>（备注里出现关键词会自动归到这类）<br>· 想带图标就在名字前加个 emoji<br>· 已存在的同名分类会自动跳过',
    });
    if (!text) return;
    const res = Store.addCategories(S.catType, text);
    if (!res.added) { await Modal.alert('没有添加', '这些分类都已经存在了。'); return; }
    S.catOpen = res.cats[0].id;
    render();
    toast(`已添加 ${res.added} 个分类${res.skipped ? `，跳过 ${res.skipped} 个重名的` : ''}`);
  };
  $$('.cat-btn[data-cid]').forEach(b => b.onclick = () => {
    S.catOpen = S.catOpen === b.dataset.cid ? null : b.dataset.cid;
    render();
    const p = $('.cat-panel');
    if (p) p.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  const panel = $('.cat-panel');
  if (!panel) return;
  const id = panel.dataset.id;
  const c = Store.getCat(id);

  $('#cpClose').onclick = () => { S.catOpen = null; render(); };
  $('#cpDetail').onclick = () => { S.detailFilter = 'cat:' + id; S.tab = 'analysis'; S.anaSub = 'detail'; render(); };
  $('#cpDel').onclick = async () => {
    const n = Store.getEntries().filter(e => e.catId === id).length;
    if (!(await Modal.confirm(`删除分类「${c.name}」`, {
      text: n ? `这个分类下有 ${n} 笔记录，删掉分类后它们会变成「未知」（记录本身不会丢）。` : '这个分类还没有记录。',
      okText: '删除', danger: true,
    }))) return;
    Store.removeCategory(id); S.catOpen = null; toast('已删除分类'); render();
  };

  const save = (patch) => { Store.updateCategory(id, patch); render(); };
  panel.querySelector('.cp-name').onchange = ev => save({ name: ev.target.value.trim() || '未命名' });
  panel.querySelector('.cp-icon').onchange = ev => save({ icon: ev.target.value.trim() || '🏷️' });
  panel.querySelector('.cp-color').onchange = ev => save({ color: ev.target.value });

  /* 点选图标：就地更新，不整页 render（否则抽屉会跳回顶部、丢失滚动位置）*/
  const applyIcon = (icon) => {
    Store.updateCategory(id, { icon });
    panel.querySelector('.cp-icon').value = icon;
    const head = panel.querySelector('.cp-ico'); if (head) head.textContent = icon;
    $$('.ic-opt', panel).forEach(b => b.classList.toggle('on', b.dataset.ic === icon));
    const gridBtn = document.querySelector(`.cat-btn[data-cid="${id}"] .cb-ico`);
    if (gridBtn) gridBtn.textContent = icon;
  };
  $$('.ic-opt', panel).forEach(b => b.onclick = () => applyIcon(b.dataset.ic));
  panel.querySelector('.cp-debt').onchange = ev => save({ debt: ev.target.value || undefined });

  const addKw = () => {
    const input = panel.querySelector('.cp-newkw');
    const add = input.value.split(/[，,]/).map(s => s.trim()).filter(Boolean);
    if (!add.length) return;
    const kws = [...(c.keywords || [])];
    for (const k of add) if (!kws.includes(k)) kws.push(k);
    save({ keywords: kws });
  };
  $('#cpAddKw').onclick = addKw;
  panel.querySelector('.cp-newkw').onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); addKw(); } };
  $$('.kw-del', panel).forEach(b => b.onclick = () => {
    const kws = [...(c.keywords || [])];
    kws.splice(+b.dataset.i, 1);
    save({ keywords: kws });
  });
}

/* ============================================================
   数据页
============================================================ */
/* AI 服务商预设：选了自动填接口地址和推荐模型（都可再手改，选「自定义」全手填） */
const AI_PROVIDERS = [
  { id: 'zhipu',    name: '智谱 GLM（glm-4v-flash 免费看图）', url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v-flash' },
  { id: 'qwen',     name: '通义千问（阿里）',                   url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-plus' },
  { id: 'moonshot', name: 'Kimi（月之暗面）',                   url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k-vision-preview' },
  { id: 'deepseek', name: 'DeepSeek（暂无看图模型）',           url: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { id: 'openai',   name: 'OpenAI',                             url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'custom',   name: '自定义（任何 OpenAI 兼容接口）',     url: '', model: '' },
];
function aiProviderOf(ai) {
  const saved = (ai || {}).provider;
  if (saved && AI_PROVIDERS.some(p => p.id === saved)) return saved;
  const hit = AI_PROVIDERS.find(p => p.url && (ai || {}).url === p.url);
  return hit ? hit.id : ((ai || {}).url ? 'custom' : 'zhipu');
}

function viewData() {
  const n = Store.getEntries().length;
  const kb = (Store.storageSize() / 1024).toFixed(1);
  const years = Store.years();
  const cfg = Backup.getCfg();
  const plat = Backup.platform();
  const platName = { electron: '电脑版', android: '安卓版', web: '浏览器 / PWA' }[plat];
  const themes = Store.getThemes();
  const st = Store.getSettings();
  const cur = st.theme;
  const as = Store.assetsAsOf('9999-12-31');

  return `
  <div class="card">
    <h3>💼 资产与账户</h3>
    <div class="sub">净资产、各账户余额、期初负债/债权都在「账户」标签页管理。</div>
    <div class="debt-strip">
      <div class="debt-box good"><div class="d-label">净资产</div><div class="d-val" style="color:${as.net >= 0 ? 'var(--brand)' : 'var(--danger)'}">${fmtM(as.net)}</div></div>
      <div class="debt-box"><div class="d-label">账户总余额</div><div class="d-val">${fmtM(Store.accountsSnapshot().total)}</div></div>
    </div>
    <button class="btn ghost block" id="goAccounts" style="margin-top:10px">去「账户」页管理 →</button>
  </div>

  <div class="card-cols">
  <div class="card">
    <h3>🎨 主题配色</h3>
    <div class="sub">换个心情，所有页面和图表跟着变</div>
    <div class="theme-grid">
      ${themes.map(t => `
        <div class="theme-item ${cur === t.id ? 'on' : ''}" data-theme="${t.id}">
          <div class="t-swatch" style="background:linear-gradient(135deg, ${t.c1}, ${t.c2} 55%, ${t.c3})">${cur === t.id ? '✓' : ''}</div>
          <div class="t-name">${t.name}</div>
        </div>`).join('')}
    </div>
  </div>

  <div class="card">
    <h3>🤖 AI 模型接入（可选）</h3>
    <div class="sub">配好后「📷 截图记账」更聪明：账单截图直接变记账条目。<br>
      <b>不填 = 完全不联网</b>；填了也只发给你自己选的服务商。截图识别要用<b>支持看图的模型</b>。</div>
    <label class="fld">服务商</label>
    <select id="aiProvider">
      ${AI_PROVIDERS.map(p => `<option value="${p.id}" ${aiProviderOf(st.ai) === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
    </select>
    <label class="fld">接口地址</label>
    <input type="text" id="aiUrl" value="${esc((st.ai || {}).url || '')}" placeholder="选服务商自动填，或自定义">
    <label class="fld">模型 ID</label>
    <input type="text" id="aiModel" value="${esc((st.ai || {}).model || '')}" placeholder="例：glm-4v-flash（免费看图）">
    <label class="fld">API Key（密钥）</label>
    <input type="password" id="aiKey" value="${esc((st.ai || {}).key || '')}" placeholder="在服务商后台申请，粘到这里">
    <div class="sub" style="margin:8px 0 0">配置好后，去「记账」页勾选标题旁的「AI 记账识别」即可启用；不勾则用本地离线识别。</div>
    <div class="row" style="margin-top:10px;flex-wrap:wrap">
      <button class="btn small" id="aiSave">保存</button>
      <button class="btn ghost small" id="aiTest">测试连接</button>
      <button class="btn ghost small danger" id="aiClear">清除</button>
    </div>
    <div class="sub" id="aiStatus" style="margin:8px 0 0">${AI.ready() ? '✅ 已配置。记账页的「📷 截图记账」已启用 AI。' : '未配置（不影响其他功能）'}</div>
  </div>
  </div>

  <div class="card">
    <h3>⏰ 自动备份</h3>
    <div class="sub">当前环境：<b>${platName}</b>${plat === 'android' ? '（存到手机「文档」文件夹，可用文件管理器或网盘同步）' : ''}</div>
    <div id="bkCapHint"></div>
    <div id="bkAutoRows">
      <div class="set-row">
        <div class="sr-t"><b>改完就备（推荐）</b><span>只要账目有改动，${plat === 'electron' ? '关闭程序时' : '退出或切到后台时'}自动存一份，最不容易丢数据</span></div>
        <label class="switch"><input type="checkbox" id="bkExit" ${cfg.onExit ? 'checked' : ''}><span class="sl"></span></label>
      </div>
      <div class="set-row">
        <div class="sr-t"><b>定时备份</b><span>每天到点再备一次；错过的会在下次打开时补做</span></div>
        <label class="switch"><input type="checkbox" id="bkEnable" ${cfg.enabled ? 'checked' : ''}><span class="sl"></span></label>
      </div>
      <div class="set-row">
        <div class="sr-t"><b>备份时间</b><span>默认早 8 点、晚 8 点，可改成任意时间点</span></div>
        <input type="time" id="bkT1" value="${cfg.times[0] || '08:00'}" style="flex:0 0 110px">
        <input type="time" id="bkT2" value="${cfg.times[1] || '20:00'}" style="flex:0 0 110px">
      </div>
      <div class="set-row">
        <div class="sr-t"><b>保留份数</b><span>超出的旧备份会自动删除，避免占空间</span></div>
        <input type="number" id="bkKeep" value="${cfg.keep}" min="1" max="200" style="flex:0 0 78px">
      </div>
    </div>
    <div id="bkRemindRow"></div>
    <div class="set-row" style="flex-wrap:wrap">
      <div class="sr-t"><b>备份位置</b><span id="bkDirHint">读取中…</span></div>
      ${Backup.canPickDir() ? '<button class="btn ghost small" id="bkPick">选择文件夹</button>' : ''}
      ${plat === 'electron' ? '<button class="btn ghost small" id="bkOpen">打开目录</button>' : ''}
      <button class="btn small" id="bkNow">立即备份</button>
    </div>
    <div class="path-box" id="bkDir">—</div>
    <label class="fld">已有备份</label>
    <div id="bkList"><div class="sub" style="margin:0">读取中…</div></div>
  </div>

  <div class="card-cols">
  <div class="card">
    <h3>⬇️ 导出</h3>
    <div class="sub">表格（Excel）含明细、月度汇总、分类汇总、年度对比 4 张工作表；图谱会把「统计 / 对比」页的图表存成图片</div>
    <div class="row" style="flex-wrap:wrap">
      <button class="btn" id="btnExportXlsx">📊 导出表格 (Excel)</button>
      <button class="btn ghost" id="btnExportCsv">导出明细 (CSV)</button>
      <button class="btn ghost" id="btnExportJson">导出备份 (JSON)</button>
    </div>
    <div class="row" style="margin-top:9px;flex-wrap:wrap">
      <button class="btn ghost" id="btnExportCharts">🖼 导出图谱 (PNG)</button>
      <select id="chartYear" style="flex:0 0 120px">
        ${years.length ? years.slice().reverse().map(y => `<option value="${y}">${y}年</option>`).join('') : '<option value="">暂无数据</option>'}
      </select>
    </div>
  </div>

  <div class="card">
    <h3>⬆️ 导入</h3>
    <div class="sub">选文件就行，会自动认格式：
      <br>① <b>你原来的手写账单</b>（每月一张表、一行一天「1号：早餐 3，地铁 4」、带「支出合计」列）—— 自动逐日拆分归类
      <br>② <b>本 APP 导出的表格</b>（日期/类型/分类/金额/备注，顺序不限）
      <br>③ <b>其他记账 App 导出的表</b>（鲨鱼 / 喵喵 / 小贝 / 随手记等）—— 自动认出日期、金额、收支、分类、备注各在哪一列，导入前会让你确认
      <br>另外也支持 CSV 和 JSON 备份。已导入过的记录会自动跳过，可放心重复导入。</div>
    <div class="row" style="flex-wrap:wrap">
      <select id="impMode" style="flex:1 1 160px">
        <option value="merge">合并（保留现有记录）</option>
        <option value="replace">覆盖（替换全部数据）</option>
      </select>
      <button class="btn" id="btnImport">选择文件（.xlsx / .csv / .json）</button>
    </div>
    <input type="file" id="impFile" accept=".json,.csv,.xlsx" hidden>
  </div>
  </div>

  <div class="card-cols">
  <div class="card">
    <h3>📦 当前数据</h3>
    <div class="sub" style="margin-bottom:0">共 ${n} 笔记录，占用约 ${kb} KB${years.length ? '，覆盖年份：' + years.join('、') : ''}</div>
  </div>

  <div class="card">
    <h3>⚠️ 清空</h3>
    <button class="btn danger" id="btnClear">清空全部数据</button>
  </div>
  </div>`;
}

/* 统一的文件保存：电脑版走「另存为」对话框，其它端走浏览器下载 */
async function saveBlob(filename, blob, filters) {
  if (Backup.platform() === 'electron' && window.jzNative.saveAs) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    const p = await window.jzNative.saveAs(filename, btoa(bin), filters);
    return p || '';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  return filename;
}
function download(filename, text, mime) {
  return saveBlob(filename, new Blob([text], { type: mime || 'application/json' }));
}

/* ---------- 组装导出用的各张表 ---------- */
function buildSheets() {
  const cats = Store.getCategories();
  const expCats = Store.getCategories('expense');
  const incCats = Store.getCategories('income');
  const catName = (id) => id ? (Store.getCat(id)?.name || '已删分类') : '未知';

  // 1) 明细
  const detail = [['日期', '星期', '类型', '分类', '金额', '备注']];
  const sorted = [...Store.getEntries()].sort((a, b) => a.date.localeCompare(b.date));
  for (const e of sorted) {
    detail.push([e.date, '周' + weekdayCN(e.date), e.type === 'expense' ? '支出' : '收入', catName(e.catId), e.amount, e.note]);
  }

  // 2) 月度汇总（列结构对齐你原来的「汇总表格」）
  const months = [...new Set(sorted.map(e => e.date.slice(0, 7)))].sort();
  const mHead = ['月份', '支出合计', '入账合计', '结余', '真实支出', '真实收入', '真实结余', '借入', '还款', '月末负债', ...expCats.map(c => c.name), ...incCats.map(c => c.name)];
  const monthly = [mHead];
  for (const ym of months) {
    const list = Store.inMonth(ym);
    const t = Store.totals(list), d = Store.debtTotals(list);
    const [y, m] = ym.split('-').map(Number);
    const end = `${ym}-${pad2(new Date(y, m, 0).getDate())}`;
    const byCat = new Map();
    for (const e of list) { if (e.catId) byCat.set(e.catId, (byCat.get(e.catId) || 0) + e.amount); }
    monthly.push([
      ym, t.expense, t.income, t.balance, t.expenseReal, t.incomeReal, t.balanceReal,
      d.borrow, d.repay, Store.balanceAsOf(end).debt,
      ...expCats.map(c => Math.round((byCat.get(c.id) || 0) * 100) / 100),
      ...incCats.map(c => Math.round((byCat.get(c.id) || 0) * 100) / 100),
    ]);
  }

  // 3) 分类汇总
  const catSum = [['分类', '类型', '往来款属性', '笔数', '合计金额', '占同类比例', '关键词']];
  for (const type of ['expense', 'income']) {
    const rows = Store.catTotals(Store.getEntries(), type);
    for (const r of rows) {
      const c = r.catId === '__unknown__' ? null : Store.getCat(r.catId);
      catSum.push([
        r.name, type === 'expense' ? '支出' : '收入',
        c && c.debt ? { borrow: '借入', repay: '还款', lend: '借出', collect: '收回' }[c.debt] : '',
        r.count, r.total, Math.round(r.pct * 10) / 10 + '%',
        c ? (c.keywords || []).join('、') : '',
      ]);
    }
  }

  // 4) 年度对比
  const years = Store.years();
  const yHead = ['项目', ...years.map(y => y + '年')];
  const yRows = years.map(y => {
    const t = Store.totals(Store.inYear(y)), d = Store.debtTotals(Store.inYear(y));
    return { t, d, debtEnd: Store.balanceAsOf(y + '-12-31').debt };
  });
  const yearly = [yHead];
  const push = (label, get) => yearly.push([label, ...yRows.map(get)]);
  push('总支出', r => r.t.expense);
  push('总收入', r => r.t.income);
  push('结余', r => r.t.balance);
  push('真实支出', r => r.t.expenseReal);
  push('真实收入', r => r.t.incomeReal);
  push('真实结余', r => r.t.balanceReal);
  push('借入', r => r.d.borrow);
  push('还款', r => r.d.repay);
  push('年末负债余额', r => r.debtEnd);
  push('月均支出', r => Math.round(r.t.expense / 12 * 100) / 100);
  yearly.push([]);
  yearly.push(['分类支出', ...years.map(y => y + '年')]);
  for (const c of expCats) {
    const vals = years.map(y => {
      let s = 0;
      for (const e of Store.inYear(y)) if (e.catId === c.id) s += e.amount;
      return Math.round(s * 100) / 100;
    });
    if (vals.some(v => v)) yearly.push([c.name, ...vals]);
  }

  return [
    { name: '明细', rows: detail, widths: [12, 6, 6, 12, 11, 46] },
    { name: '月度汇总', rows: monthly, widths: [10, 11, 11, 11, 11, 11, 11, 10, 10, 11, ...cats.map(() => 10)] },
    { name: '分类汇总', rows: catSum, widths: [14, 6, 11, 7, 12, 10, 50] },
    { name: '年度对比', rows: yearly, widths: [22, ...years.map(() => 13)] },
  ];
}

/* ============================================================
   原始账单表格（每月一张表、一行一天的自由文本）识别与导入
   —— 就是你自己那几个「24/25/26年生活账单.xlsx」的格式
============================================================ */

/* 从工作表名里取月份：「1月」「2024.5」「2024.05」 */
function sheetMonth(name) {
  const s = String(name || '').trim();
  let m = /^(\d{1,2})\s*月$/.exec(s);
  if (m) return { month: +m[1] };
  m = /^(\d{4})[.\-/](\d{1,2})$/.exec(s);
  if (m) return { year: +m[1], month: +m[2] };
  m = /^(\d{1,2})$/.exec(s);
  if (m && +m[1] >= 1 && +m[1] <= 12) return { month: +m[1] };
  return null;
}

/* 从文件名里猜年份：「25年生活账单.xlsx」→2025、「2026账单(1).xlsx」→2026 */
function guessYear(filename) {
  const s = String(filename || '');
  let m = /(20\d{2})/.exec(s);
  if (m) return +m[1];
  m = /(\d{2})\s*年/.exec(s);
  if (m) return 2000 + +m[1];
  return null;
}

/* 这张表是不是「原始账单」格式？ */
function looksLikeRawBill(rows) {
  if (!rows.length) return false;
  const head = (rows[0] || []).map(c => String(c || '').trim());
  const hasTotalCol = head.some(h => /^(支出合计|入账合计|支出|收入)$/.test(h));
  // 行首形如「1号：」「1 号：」的天数行
  const dayRows = rows.slice(1).filter(r =>
    (r || []).some(c => /^\s*\d{1,2}\s*号/.test(String(c || '')))).length;
  return hasTotalCol && dayRows >= 3;
}

/* 解析一张「原始账单」工作表 → [{date,text,expense,income}] */
function parseRawBillSheet(rows, year, month) {
  const head = (rows[0] || []).map(c => String(c || '').trim());
  const find = (...names) => {
    for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; }
    return -1;
  };
  const colNo = find('编号');
  const colExp = find('支出合计', '支出');
  let colInc = find('入账合计', '收入');
  // 26 年那种没有「入账合计」的，收入 = 其他入账+主业+副业+投资 之和
  const incParts = colInc < 0 ? ['其他入账', '主业收入', '副业收入', '投资收入'].map(n => head.indexOf(n)).filter(i => i >= 0) : [];
  const colText = colNo >= 0 ? colNo + 1 : 0;
  const nDays = new Date(year, month, 0).getDate();

  const num = (v) => {
    if (typeof v === 'number' && isFinite(v)) return Math.round(v * 100) / 100;
    // 空单元格代表「这天该项为 0」
    if (v === undefined || v === null || String(v).trim() === '') return 0;
    let s = String(v).trim().replace(/[¥￥\s]/g, '');
    // 千分位逗号（后面必须正好 3 位数字）可以去掉；
    // 「1,13」这种逗号打成小数点的有歧义，不猜，交给正文解析
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    if (/^-?\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 100) / 100;
    // 「——」「未统计」等文字代表这天没统计，返回 null 表示不做校准
    return null;
  };

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const text = String(r[colText] == null ? '' : r[colText]).trim();
    let day = null;
    if (colNo >= 0 && typeof r[colNo] === 'number' && r[colNo] >= 1 && r[colNo] <= nDays) day = Math.round(r[colNo]);
    else {
      const m = /^\s*(\d{1,2})\s*号/.exec(text);
      if (m && +m[1] >= 1 && +m[1] <= nDays) day = +m[1];
    }
    if (day === null) continue;   // 「合计」「中位线」这些行跳过
    const expense = colExp >= 0 ? num(r[colExp]) : null;
    let income = null;
    if (colInc >= 0) income = num(r[colInc]);
    else if (incParts.length) {
      const vals = incParts.map(ci => num(r[ci])).filter(v => v !== null);
      income = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100 : null;
    }
    if (!text && expense === null && income === null) continue;
    const date = `${year}-${pad2(month)}-${pad2(day)}`;
    const prev = out.find(x => x.date === date);
    if (prev) {   // 同一天占了多行（比如「9号-10号」）就合并
      prev.text = [prev.text, text].filter(Boolean).join('，');
      for (const k of ['expense', 'income']) if (k in prev) {
        const add = k === 'expense' ? expense : income;
        if (add !== null) prev[k] = Math.round(((prev[k] || 0) + add) * 100) / 100;
      }
    } else out.push({ date, text, expense, income });
  }
  return out;
}

/* 导入整本原始账单工作簿 */
function importRawBill(sheets, year, mode) {
  const days = [];
  const usedSheets = [];
  for (const sh of sheets) {
    const sm = sheetMonth(sh.name);
    if (!sm) continue;                       // 「汇总表格」「分析报告总结」等跳过
    if (!looksLikeRawBill(sh.rows)) continue;
    const y = sm.year || year;
    if (!y) continue;
    const got = parseRawBillSheet(sh.rows, y, sm.month);
    if (got.length) { days.push(...got); usedSheets.push(sh.name); }
  }
  if (!days.length) throw new Error('没能从这个工作簿里读到按天记录的账单');
  if (mode === 'replace') Store.clearAll();
  const res = importHistory({ format: 'jz-history-v1', days });
  return Object.assign(res, { sheets: usedSheets });
}

/* 打开一个 xlsx：自动判断是「本 APP 导出的标准表」还是「原始账单」 */
async function importXlsxFile(file, mode) {
  const sheets = await XLSX.parseAll(await file.arrayBuffer());
  const rawSheets = sheets.filter(sh => sheetMonth(sh.name) && looksLikeRawBill(sh.rows));

  // 不是「按月分表的原始账单」→ 走智能认列，能吃各家记账软件导出的表
  if (!rawSheets.length) {
    // 选行数最多的那张表来解析
    const best = sheets.slice().sort((a, b) => (b.rows ? b.rows.length : 0) - (a.rows ? a.rows.length : 0))[0];
    if (!best || !best.rows || !best.rows.length) throw new Error('这个工作簿是空的，没读到数据。');
    const res = await importTable(best.rows, mode);
    if (res.cancelled) return;
    toast(`导入完成：新增 ${res.added} 笔`
      + (res.dup ? `，跳过重复 ${res.dup} 笔` : '')
      + (res.bad ? `，忽略无效 ${res.bad} 行` : ''));
    return;
  }

  // 原始账单：确定年份
  let year = guessYear(file.name);
  const fromSheet = rawSheets.map(s => sheetMonth(s.name)).find(m => m && m.year);
  if (fromSheet) year = fromSheet.year;
  if (!year) {
    const v = await Modal.prompt('这是哪一年的账单？', {
      placeholder: '例如 2026', value: String(new Date().getFullYear()),
      hint: `从文件名「${esc(file.name)}」里没认出年份。这个工作簿按月分表（${rawSheets.map(s => s.name).join('、')}），请告诉我年份。`,
    });
    if (!v) return;
    year = parseInt(v, 10);
    if (!year || year < 1990 || year > 2100) throw new Error('年份不对：' + v);
  } else {
    const okGo = await Modal.confirm('识别到原始账单格式', {
      text: `按 ${year} 年导入，共 ${rawSheets.length} 张月份表：${rawSheets.map(s => s.name).join('、')}\n\n`
        + '会逐日拆分文本、自动归类，并按原表的「支出合计 / 入账合计」校准差额。\n已有记录的日期会自动跳过。',
      okText: '开始导入',
    });
    if (!okGo) return;
  }
  const res = importRawBill(sheets, year, mode);
  await Modal.alert('导入完成', `${year} 年：读取 ${res.sheets.length} 张月份表、${res.days} 天\n新增 ${res.added} 笔记录`
    + (res.skipped ? `\n跳过已有记录的 ${res.skipped} 天` : ''));
}

/* 把一格转成 YYYY-MM-DD；认不出返回 '' */
function toDateStr(v) {
  if (v instanceof Date) return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  let s = String(v == null ? '' : v).trim();
  // 「2026/1/5 12:30」「2026.01.05」「2026年1月5日」都能吃
  s = s.replace(/[年月]/g, '-').replace(/日/g, '').replace(/[/.]/g, '-');
  const m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  return m ? `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}` : '';
}
function toAmount(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[,，¥￥$\s元]/g, ''));
  return isFinite(n) ? n : NaN;
}

/* 智能认列：不管表头叫什么（鲨鱼/喵喵/小贝/随手记等各家都不同），
   靠「表头关键词 + 抽样看列内容」认出 日期/金额/收支/分类/备注/账户 各是哪一列。 */
function detectColumns(head, dataRows) {
  const H = head.map(h => String(h || '').trim().toLowerCase());
  const sample = dataRows.slice(0, Math.min(dataRows.length, 30));
  const col = (i) => sample.map(r => (r || [])[i]);
  const findByName = (kws, exclude = []) => {
    for (let i = 0; i < H.length; i++) {
      if (exclude.includes(i)) continue;
      if (kws.some(k => H[i].includes(k))) return i;
    }
    return -1;
  };
  const ratio = (i, test) => { const c = col(i).filter(x => String(x ?? '').trim()); return c.length ? c.filter(test).length / c.length : 0; };

  // 日期列：先按名字，认不出再按「多数格子像日期」
  let iDate = findByName(['日期', '时间', 'date', '交易时间', '记账时间', '账单时间', '消费时间']);
  if (iDate < 0) for (let i = 0; i < H.length; i++) if (ratio(i, x => toDateStr(x)) > 0.6) { iDate = i; break; }

  // 收支类型列：名字含收支/类型/方向，且值多为 收/支/income/expense
  let iType = -1;
  for (const cand of [findByName(['收支', '收入支出', '类型', 'type', '方向', '收/支']), ...H.map((_, i) => i)]) {
    if (cand < 0 || cand === iDate) continue;
    if (ratio(cand, x => /^(收入?|支出?|income|expense|inc|exp|\+|-)$/i.test(String(x).trim())) > 0.6) { iType = cand; break; }
  }

  // 先判断是不是「收入、支出分成两列」（随手记等）。分列存在时就不再另找单金额列，
  // 否则内容猜测会把「收入」这类分列误当成唯一金额列。
  let iIncome = findByName(['收入金额', '收入', '入账'], [iDate, iType]);
  let iExpense = findByName(['支出金额', '支出', '出账'], [iDate, iType, iIncome]);
  let iAmt = -1;
  if (!(iIncome >= 0 && iExpense >= 0)) {
    iIncome = -1; iExpense = -1;
    iAmt = findByName(['金额', '数额', '钱数', 'amount', 'money', '价格', '消费金额', '收支金额', '发生额'], [iDate, iType]);
    if (iAmt < 0) for (let i = 0; i < H.length; i++) if (i !== iDate && i !== iType && ratio(i, x => !isNaN(toAmount(x)) && String(x).trim() !== '') > 0.7) { iAmt = i; break; }
  }

  const used = [iDate, iType, iAmt, iIncome, iExpense];
  const iCat = findByName(['分类', '类别', '类目', 'category', '账目', '一级分类', '子分类', '标签'], used);
  const iNote = findByName(['备注', '说明', '描述', 'note', 'remark', '摘要', '商品', '交易对方', '对方', '内容', '事项'], [...used, iCat]);
  const iAcct = findByName(['账户', '账户名', '支付方式', 'account', '钱包', '资产'], [...used, iCat, iNote]);
  return { iDate, iAmt, iType, iCat, iNote, iAcct, iIncome, iExpense };
}

/* 从二维表格数据导入（CSV / XLSX 共用）。智能认列，能吃各家记账软件导出的表。 */
async function importTable(rows, mode, opts = {}) {
  if (!rows.length) throw new Error('表格是空的');
  // 找表头行：前 12 行里，选「非空格子最多」的一行当表头（容忍上方有标题/说明）
  let hi = 0, best = -1;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const cells = (rows[i] || []).filter(c => String(c ?? '').trim()).length;
    const looksHead = (rows[i] || []).some(c => /日期|时间|金额|收支|类型|分类|备注|date|amount/i.test(String(c || '')));
    const score = cells + (looksHead ? 100 : 0);
    if (score > best) { best = score; hi = i; }
  }
  const head = (rows[hi] || []).map(c => String(c || '').trim());
  const dataRows = rows.slice(hi + 1);
  const C = detectColumns(head, dataRows);
  if (C.iDate < 0 || (C.iAmt < 0 && C.iIncome < 0 && C.iExpense < 0)) {
    throw new Error('没认出「日期」和「金额」列。\n请确认表格里有日期列，以及金额列（或分开的收入/支出列）。');
  }

  // 导入前给用户看认列结果，确认无误再导（除非调用方 opts.silent）
  if (!opts.silent) {
    const nm = (i) => i >= 0 ? `第 ${i + 1} 列「${head[i] || '(空)'}」` : '未识别';
    const okGo = await Modal.confirm('识别到表格格式', {
      text: `共 ${dataRows.length} 行数据，识别结果：\n`
        + `· 日期：${nm(C.iDate)}\n`
        + `· 金额：${C.iAmt >= 0 ? nm(C.iAmt) : `收入=${nm(C.iIncome)}，支出=${nm(C.iExpense)}`}\n`
        + `· 收支类型：${nm(C.iType)}\n`
        + `· 分类：${nm(C.iCat)}\n`
        + `· 备注：${nm(C.iNote)}\n\n`
        + '没有分类的会按备注自动归类；已有记录的日期不会重复。',
      okText: '确认导入',
    });
    if (!okGo) return { added: 0, bad: 0, cancelled: true };
  }

  const catByName = new Map(Store.getCategories().map(c => [c.name, c]));
  // 单金额列、又没有收支列时：若该列出现过负数，说明用正负区分收支（负=支出，正=收入）；
  // 若全是非负数，则默认都是支出（多数导出把支出记成正数）。
  const signedAmt = C.iAmt >= 0 && C.iType < 0 && dataRows.some(r => toAmount((r || [])[C.iAmt]) < 0);
  const batch = [];
  let bad = 0;
  for (const r of dataRows) {
    if (!r || !r.some(c => String(c ?? '').trim())) continue;
    const date = toDateStr(r[C.iDate]);
    if (!date) { if (String(r[C.iDate] ?? '').trim()) bad++; continue; }

    // 定金额与收支
    let amt, type;
    if (C.iAmt >= 0) {
      const raw = toAmount(r[C.iAmt]);
      if (isNaN(raw)) { bad++; continue; }
      const typeStr = C.iType >= 0 ? String(r[C.iType] || '').trim() : '';
      if (typeStr) type = /收|入|income|inc|\+/i.test(typeStr) ? 'income' : 'expense';
      else if (signedAmt) type = raw < 0 ? 'expense' : 'income';
      else type = 'expense';
      amt = Math.abs(raw);
    } else {
      const inc = C.iIncome >= 0 ? toAmount(r[C.iIncome]) : NaN;
      const exp = C.iExpense >= 0 ? toAmount(r[C.iExpense]) : NaN;
      if (!isNaN(inc) && inc > 0) { amt = inc; type = 'income'; }
      else if (!isNaN(exp) && exp > 0) { amt = exp; type = 'expense'; }
      else { bad++; continue; }
    }
    if (!amt || !isFinite(amt)) { bad++; continue; }

    const note = C.iNote >= 0 ? String(r[C.iNote] ?? '').trim() : '';
    const catStr = C.iCat >= 0 ? String(r[C.iCat] || '').trim() : '';
    let catId;
    if (catStr && catStr !== '未知' && catByName.has(catStr)) {
      const c = catByName.get(catStr);
      catId = c.type === type ? c.id : Store.categorize(note, type);
    } else if (catStr && catStr !== '未知' && catStr.length <= 8) {
      const c = Store.addCategory(type, catStr);   // 表里有新分类就自动建
      catByName.set(catStr, c);
      catId = c.id;
    } else {
      catId = Store.categorize(note, type);
    }
    batch.push({ date, type, amount: amt, note, catId, manual: !!catStr && catStr !== '未知' });
  }
  if (!batch.length) throw new Error('没有解析到有效数据行（认出了列，但每行都缺日期或金额）');
  if (mode === 'replace') Store.clearAll();
  // 跳过已存在（同日期+金额+备注）的记录，可放心重复导入
  const seen = new Set(Store.getEntries().map(e => `${e.date}|${e.amount}|${e.note}`));
  const fresh = batch.filter(b => { const k = `${b.date}|${b.amount}|${b.note}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const dup = batch.length - fresh.length;
  for (let i = 0; i < fresh.length; i += 500) Store.addEntries(fresh.slice(i, i + 500));
  return { added: fresh.length, bad, dup };
}

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim()));
}

function bindData() {
  /* 主题 */
  $$('[data-theme]').forEach(el => el.onclick = () => { Theme.set(el.dataset.theme); render(); });

  /* 去账户页（已并入财务管理） */
  const ga = $('#goAccounts');
  if (ga) ga.onclick = () => { S.tab = 'finance'; S.finSub = 'accounts'; render(); };

  /* AI 模型接入（四要素：服务商 / 接口地址 / 模型 ID / 密钥） */
  const aiSave = $('#aiSave');
  if (aiSave) {
    const status = (msg) => { const el = $('#aiStatus'); if (el) el.innerHTML = msg; };
    const collect = () => ({
      provider: $('#aiProvider').value,
      url: $('#aiUrl').value.trim(),
      key: $('#aiKey').value.trim(),
      model: $('#aiModel').value.trim(),
      enabled: (Store.getSettings().ai || {}).enabled !== false,   // 开关在记账页，这里保留原状态
    });
    $('#aiProvider').onchange = (ev) => {
      const p = AI_PROVIDERS.find(x => x.id === ev.target.value);
      if (!p) return;
      if (p.id !== 'custom') {
        $('#aiUrl').value = p.url;
        if (!$('#aiModel').value.trim() || AI_PROVIDERS.some(x => x.model === $('#aiModel').value.trim())) $('#aiModel').value = p.model;
      }
      status(p.id === 'custom' ? '自定义模式：接口地址和模型 ID 都自己填。' : `已填入 ${p.name.split('（')[0]} 的接口地址和推荐模型，粘上密钥即可。`);
    };
    aiSave.onclick = () => {
      Store.updateSettings({ ai: collect() });
      status(AI.ready() ? '✅ 已保存。建议点「测试连接」确认能通。' : '已保存，但地址/模型/密钥没填全，AI 功能不会启用。');
      toast('AI 配置已保存');
    };
    $('#aiTest').onclick = async () => {
      // 先把当前输入保存再测，避免「改了没存」测的是旧配置
      Store.updateSettings({ ai: collect() });
      if (!AI.ready()) { status('⚠️ 接口地址、模型 ID、密钥三项都要填'); return; }
      status('⏳ 正在连接模型…');
      try {
        const out = await AI.testConn();
        status(`✅ 连接成功！模型回复：「${esc(out)}」。可以去记账页用「📷 截图记账」了。`);
      } catch (err) { status('❌ 连接失败：' + esc(err.message)); }
    };
    $('#aiClear').onclick = async () => {
      if (!(await Modal.confirm('清除 AI 配置', { text: '清掉接口地址、密钥和模型名，恢复完全不联网。', okText: '清除', danger: true }))) return;
      Store.updateSettings({ ai: { provider: '', url: '', key: '', model: '' } });
      toast('已清除'); render();
    };
  }

  /* 自动备份设置 */
  const refreshBackupUI = async () => {
    const dir = await Backup.currentDir();
    const dirEl = $('#bkDir'), hint = $('#bkDirHint');
    if (!dirEl) return;

    /* 关键：这个环境到底能不能无人值守写文件。
       写不了就别摆自动备份的开关误导人，如实说明并改走「提醒」。 */
    const auto = await Backup.canAutoWrite();
    const capHint = $('#bkCapHint');
    const autoRows = $('#bkAutoRows');
    const remindRow = $('#bkRemindRow');
    if (!auto) {
      if (autoRows) autoRows.style.display = 'none';
      if (capHint) capHint.innerHTML = `
        <div class="remind-bar" style="margin:0 0 12px">
          <span class="rb-ico">ℹ️</span>
          <span class="rb-t">这台设备<b>做不到自动备份</b>。${Backup.canPickDir()
            ? '点下面「选择文件夹」授权一个位置，就能自动备份了。'
            : '苹果的 Safari 不允许网页在你没点击的情况下写文件（iPhone / iPad 都是这样）。<br>改为：有改动又太久没备份时提醒你，点一下存到「文件」或 iCloud 云盘。'}</span>
        </div>`;
      const cfg2 = Backup.getCfg();
      if (remindRow) remindRow.innerHTML = `
        <div class="set-row">
          <div class="sr-t"><b>没备份就提醒</b><span>有改动且超过这个天数没备份时，顶部显示提醒条；填 0 关闭</span></div>
          <input type="number" id="bkRemind" value="${cfg2.remindDays ?? 3}" min="0" max="60" style="flex:0 0 78px">
          <span style="flex:0 0 auto;font-size:.78rem;color:var(--text-3)">天</span>
        </div>
        <div class="set-row">
          <div class="sr-t"><b>上次备份</b><span>${cfg2.lastOkAt ? new Date(cfg2.lastOkAt).toLocaleString('zh-CN') : '还没备份过'}</span></div>
        </div>`;
      const rin = $('#bkRemind');
      if (rin) rin.onchange = ev => {
        Backup.saveCfg({ remindDays: Math.max(0, Math.min(60, +ev.target.value || 0)) });
        S._remindHidden = false;
        toast('提醒设置已更新'); render();
      };
    } else {
      if (autoRows) autoRows.style.display = '';
      if (capHint) capHint.innerHTML = '';
      if (remindRow) remindRow.innerHTML = '';
    }

    if (dir) { dirEl.textContent = dir; if (hint) hint.textContent = '备份文件存放的位置'; }
    else if (Backup.canPickDir()) {
      dirEl.textContent = '未选择 —— 点右边「选择文件夹」指定位置';
      if (hint) hint.textContent = '还没有指定位置';
    } else {
      dirEl.textContent = '每次点「立即备份」时，由你选择存到哪（文件 / iCloud 云盘 / 下载）';
      if (hint) hint.textContent = '此环境不能固定位置';
    }
    const list = await Backup.list();
    const le = $('#bkList');
    if (!le) return;
    le.innerHTML = list.length
      ? `<div class="cp-recent" style="max-height:180px;overflow-y:auto;background:var(--input-bg);border-radius:11px">
          ${list.slice(0, 20).map(f => `
          <div class="entry" style="padding:7px 11px">
            <span class="e-mid"><div class="e-note" style="font-size:.75rem;color:var(--text-2)">${esc(f.name)}</div></span>
            <span style="font-size:.7rem;color:var(--text-3)">${(f.size / 1024).toFixed(0)}KB</span>
            <button class="btn ghost small bk-restore" data-n="${esc(f.name)}">恢复</button>
          </div>`).join('')}
         </div>`
      : '<div class="sub" style="margin:0">还没有备份文件</div>';
    $$('.bk-restore').forEach(b => b.onclick = async () => {
      if (!(await Modal.confirm('恢复备份', { text: `用备份「${b.dataset.n}」覆盖当前全部数据？\n当前数据会被替换，建议先「立即备份」。`, okText: '覆盖恢复', danger: true }))) return;
      try {
        const txt = await Backup.read(b.dataset.n);
        const cnt = Store.importBackup(JSON.parse(txt), 'replace');
        Theme.init();
        toast(`已恢复，共 ${cnt} 笔记录`); render();
      } catch (err) { await Modal.alert('恢复失败', err.message); }
    });
  };
  refreshBackupUI();

  /* 开备份前先确保有个存放位置，否则备了也不知道去哪了 */
  const ensureDir = async () => {
    if (!Backup.canPickDir()) return true;         // 安卓固定目录，网页不支持选就退化成下载
    if (await Backup.currentDir()) return true;
    try { await Backup.pickDir(); } catch { /* 取消也允许开 */ }
    return true;
  };
  $('#bkExit').onchange = async (ev) => {
    const on = ev.target.checked;
    if (on) await ensureDir();
    Backup.saveCfg({ onExit: on });
    toast(on ? '改完就备已开启' : '改完就备已关闭');
    render();
  };
  $('#bkEnable').onchange = async (ev) => {
    const on = ev.target.checked;
    if (on) await ensureDir();
    Backup.saveCfg({ enabled: on });
    toast(on ? '定时备份已开启' : '定时备份已关闭');
    if (on) Backup.tick();
    render();
  };
  const saveTimes = () => {
    const t1 = $('#bkT1').value || '08:00', t2 = $('#bkT2').value || '20:00';
    Backup.saveCfg({ times: [...new Set([t1, t2])], lastRun: {} });
    toast('备份时间已更新');
  };
  $('#bkT1').onchange = saveTimes;
  $('#bkT2').onchange = saveTimes;
  $('#bkKeep').onchange = ev => {
    Backup.saveCfg({ keep: Math.max(1, Math.min(200, +ev.target.value || 14)) });
    toast('保留份数已更新');
  };
  const pick = $('#bkPick');
  if (pick) pick.onclick = async () => {
    try {
      const d = await Backup.pickDir();
      if (d) { toast('备份位置已设置'); refreshBackupUI(); }
    } catch (err) { if (err.name !== 'AbortError') await Modal.alert('选择失败', err.message); }
  };
  const openBtn = $('#bkOpen');
  if (openBtn) openBtn.onclick = () => Backup.openDir();
  $('#bkNow').onclick = async () => {
    try {
      const res = await Backup.run({ interactive: true });
      toast(res.ok ? `备份完成 → ${res.where}` : '备份未完成');
      refreshBackupUI();
    } catch (err) { await Modal.alert('备份失败', err.message); }
  };

  /* 导出 */
  $('#btnExportXlsx').onclick = async () => {
    try {
      const blob = XLSX.build(buildSheets());
      const p = await saveBlob(`生活账单-${todayStr()}.xlsx`, blob, [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]);
      if (p) toast('表格已导出（4 张工作表）');
    } catch (err) { await Modal.alert('导出失败', err.message); }
  };
  $('#btnExportCsv').onclick = async () => {
    const rows = buildSheets()[0].rows;
    const csv = '﻿' + rows.map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    await saveBlob(`记账明细-${todayStr()}.csv`, new Blob([csv], { type: 'text/csv' }), [{ name: 'CSV 表格', extensions: ['csv'] }]);
    toast('CSV 已导出');
  };
  $('#btnExportJson').onclick = async () => {
    await download(`记账备份-${todayStr()}.json`, JSON.stringify(Store.exportAll(), null, 1));
    toast('备份已导出');
  };
  $('#btnExportCharts').onclick = async () => {
    const year = $('#chartYear').value;
    if (!year) { toast('还没有数据'); return; }
    try {
      const svgs = buildYearCharts(year);
      let n = 0;
      for (const { name, svg } of svgs) {
        const blob = await Charts.svgToPng(svg, '', 2);
        const p = await saveBlob(`${year}年-${name}.png`, blob, [{ name: 'PNG 图片', extensions: ['png'] }]);
        if (!p) break;
        n++;
      }
      toast(n ? `已导出 ${n} 张图谱` : '已取消');
    } catch (err) { await Modal.alert('导出图谱失败', err.message); }
  };

  /* 导入 */
  $('#btnImport').onclick = () => $('#impFile').click();
  $('#impFile').onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    ev.target.value = '';
    const mode = $('#impMode').value;
    if (mode === 'replace' && !(await Modal.confirm('覆盖导入', { text: '会先清空当前全部数据，再导入这个文件。确定吗？', okText: '确定覆盖', danger: true }))) return;
    try {
      if (/\.json$/i.test(f.name)) {
        const obj = JSON.parse(await f.text());
        if (obj.format === 'jz-history-v1') {
          if (mode === 'replace') Store.clearAll();
          const res = importHistory(obj);
          toast(`导入完成：新增 ${res.added} 笔（${res.days} 天）`);
        } else {
          const n = Store.importBackup(obj, mode);
          Theme.init();
          toast(`导入完成，现有 ${n} 笔记录`);
        }
      } else if (/\.csv$/i.test(f.name)) {
        const res = await importTable(parseCsv(await f.text()), mode);
        if (!res.cancelled) toast(`导入完成：新增 ${res.added} 笔`
          + (res.dup ? `，跳过重复 ${res.dup} 笔` : '')
          + (res.bad ? `，忽略无效 ${res.bad} 行` : ''));
      } else if (/\.xlsx$/i.test(f.name)) {
        await importXlsxFile(f, mode);
      } else {
        await Modal.alert('不支持的文件', '只认 .xlsx / .csv / .json 三种文件。');
        return;
      }
      render();
    } catch (err) { await Modal.alert('导入失败', err.message); }
  };
  $('#btnClear').onclick = async () => {
    if (!(await Modal.confirm('清空全部数据', {
      text: '会删掉所有记账记录和自定义分类，且无法撤销。\n建议先「立即备份」或导出一份 JSON。',
      okText: '我确定要清空', danger: true,
    }))) return;
    Store.clearAll(); S.catOpen = null; toast('已清空'); render();
  };
}

/* 导出图谱：离屏生成该年度的几张关键图表 */
function buildYearCharts(year) {
  const out = [];
  const ms = Store.monthlySeries(year);
  const labels = ms.map((_, i) => (i + 1) + '月');
  out.push({
    name: '每月收支', svg: Charts.barChart(labels, [
      { name: '支出', color: '#f0524c', values: ms.map(s => s.expense) },
      { name: '收入', color: '#2f7cf6', values: ms.map(s => s.income) },
    ]),
  });
  out.push({ name: '收支平衡', svg: Charts.balanceChart(labels, ms.map(s => s.income), ms.map(s => s.expense)) });
  const rows = Store.catTotals(Store.inYear(year), 'expense');
  if (rows.length) {
    out.push({ name: '支出分类占比', svg: Charts.pie(rows.map(r => ({ label: r.name, value: r.total, color: r.color })), { size: 300 }) });
    out.push({ name: '支出分类排行', svg: Charts.hBar(rows.map(r => ({ label: r.name, value: r.total, color: r.color }))) });
  }
  const inc = Store.catTotals(Store.inYear(year), 'income');
  if (inc.length) out.push({ name: '收入分类占比', svg: Charts.pie(inc.map(r => ({ label: r.name, value: r.total, color: r.color })), { size: 300 }) });
  const ds = Store.monthlyDebtSeries(year);
  if (ds.some(d => d.borrow || d.repay || d.debtBalance)) {
    out.push({
      name: '负债走势', svg: Charts.barChart(labels, [
        { name: '借入', color: '#c88a4a', values: ds.map(d => d.borrow) },
        { name: '还款', color: '#0b8f66', values: ds.map(d => d.repay) },
      ]),
    });
    out.push({ name: '负债余额', svg: Charts.lineChart(labels, [{ name: '负债余额', color: '#f0524c', values: ds.map(d => d.debtBalance) }]) });
  }
  return out;
}

/* 历史账单导入：逐日解析文本 + 按原表合计校准差额 */
function importHistory(obj) {
  if (!obj || obj.format !== 'jz-history-v1' || !Array.isArray(obj.days)) throw new Error('不是有效的 history.json 文件');
  let added = 0, days = 0, skipped = 0;
  const hints = incomeHints();
  const batch = [];
  for (const day of obj.days) {
    if (!day.date) continue;
    if (Store.byDate(day.date).length) { skipped++; continue; }
    days++;
    const items = day.text ? Parser.parseText(day.text, hints) : [];
    // 原表的「支出合计 / 入账合计」不含还款、借款等往来款，
    // 所以校准时也只跟非往来款的部分对账，否则会倒推出一大笔负数把占比算乱
    let ex = 0, inc = 0;
    for (const it of items) {
      const catId = it.catId !== undefined ? it.catId : Store.categorize(it.note, it.type);
      it.catId = catId;
      const isDebt = catId && (Store.getCat(catId) || {}).debt;
      if (isDebt) continue;
      if (it.type === 'expense') ex += it.amount; else inc += it.amount;
    }
    for (const it of items) batch.push({ date: day.date, type: it.type, amount: it.amount, note: it.note, catId: it.catId });
    // 按原表合计校准（差额记为「未知」，方便事后手动归类）
    if (typeof day.expense === 'number' && isFinite(day.expense)) {
      const diff = Math.round((day.expense - ex) * 100) / 100;
      if (Math.abs(diff) > 0.01) batch.push({ date: day.date, type: 'expense', amount: diff, note: `（导入校准：原表支出合计 ${day.expense}）`, catId: null });
    }
    if (typeof day.income === 'number' && isFinite(day.income)) {
      const diff = Math.round((day.income - inc) * 100) / 100;
      if (Math.abs(diff) > 0.01) batch.push({ date: day.date, type: 'income', amount: diff, note: `（导入校准：原表入账合计 ${day.income}）`, catId: null });
    }
  }
  // 分块保存避免一次性太大
  for (let i = 0; i < batch.length; i += 500) Store.addEntries(batch.slice(i, i + 500));
  added = batch.length;
  return { added, days, skipped };
}

/* ---------- 启动 ---------- */
/* 判断是不是装成 APP 在跑：是的话给 body 打标记，让顶栏让开状态栏/刘海 */
(function detectShell() {
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    || (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches)
    || navigator.standalone === true;   // iOS 加到主屏幕
  const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (native) document.body.classList.add('native-shell');
  else if (standalone) document.body.classList.add('pwa-standalone');
})();

$$('.tab').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; S.editingId = null; render(); });
$('#ledgerChip').onclick = openLedgerPicker;
Theme.init();
render();
/* 自动备份完成后提示一下，并刷新设置页的备份列表 */
window.onBackupDone = (res, time) => {
  toast(`⏰ ${time} 自动备份完成 → ${res.where}`);
  if (S.tab === 'settings' && S.setSub === 'general') render();
};
Backup.start();

/* ---------- 授权闸门（电脑版/安卓未授权时挡住主界面）---------- */
async function licenseGate() {
  const st = await License.status();
  const existing = document.getElementById('gateMask');
  if (!st.required || st.ok) { if (existing) existing.remove(); return; }
  if (existing) return;   // 已经挡着了
  const mask = document.createElement('div');
  mask.id = 'gateMask';
  mask.className = 'gate-mask';
  mask.innerHTML = `
    <div class="gate-card">
      <h2>🔑 富财记 · 授权</h2>
      <div class="sub">感谢使用！电脑版 / 安卓版需要授权码激活（一次授权，终身使用）。<br>
        把下面「机器码」发给作者换取授权码，或在「个人中心 → 联系作者」扫码。</div>
      <label class="fld">本机机器码（发给作者）</label>
      <div class="path-box" id="gateMc">${st.mc}</div>
      <button class="btn ghost small" id="gateCopy" style="margin:8px 0">复制机器码</button>
      <label class="fld">粘贴授权码</label>
      <textarea id="gateInput" placeholder="把作者发来的授权码整段粘贴到这里" style="min-height:70px"></textarea>
      <button class="btn block" id="gateOk">激活并进入</button>
      <button class="btn ghost block" id="gateContact">📮 联系作者获取授权码</button>
    </div>`;
  document.body.appendChild(mask);
  $('#gateCopy').onclick = () => copyText(st.mc);
  $('#gateContact').onclick = openContactModal;
  $('#gateOk').onclick = async () => {
    const code = $('#gateInput').value.trim();
    if (!code) { toast('请先粘贴授权码'); return; }
    if (await License.activate(code)) { mask.remove(); toast('激活成功 🎉'); render(); }
    else await Modal.alert('激活失败', '授权码和本机机器码不匹配。请确认机器码复制完整、授权码为这台设备生成、且整段粘贴。');
  };
}
licenseGate();
