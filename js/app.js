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
/* 负债余额的显示：负数意味着记录到的还款多于借入（多见于早期数据没记借入），
   直接显示负数没人看得懂，换成「净还款」并提示去填期初负债 */
function debtLabel(v) {
  if (v > 0) return { text: fmtM(v), color: 'var(--danger)', tip: '' };
  if (v === 0) return { text: '0.00', color: 'var(--text-3)', tip: '' };
  return { text: '净还 ' + fmtM(-v), color: 'var(--brand)', tip: '记录到的还款比借入多，可在「数据」页填写期初负债' };
}
/* 收入分类关键词作为解析提示（排除与支出分类重复的词，避免误判） */
function incomeHints() {
  const expKws = new Set(Store.getCategories('expense').flatMap(c => c.keywords || []));
  return Store.getCategories('income').flatMap(c => c.keywords || []).filter(kw => !expKws.has(kw));
}

/* ---------- 全局状态 ---------- */
const S = {
  tab: 'record',
  recordDate: todayStr(),
  parsed: [],
  manualType: 'expense',
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
  const v = $('#view');
  switch (S.tab) {
    case 'record': v.innerHTML = viewRecord(); bindRecord(); break;
    case 'detail': v.innerHTML = viewDetail(); bindDetail(); break;
    case 'stats': v.innerHTML = viewStats(); bindStats(); break;
    case 'compare': v.innerHTML = viewCompare(); bindCompare(); break;
    case 'category': v.innerHTML = viewCategory(); bindCategory(); break;
    case 'data': v.innerHTML = viewData(); bindData(); break;
  }
  const kb = Store.storageSize();
  $('#storageHint').textContent = `${Store.getEntries().length} 笔 · ${(kb / 1024).toFixed(0)}KB`;
}

function catSelect(catId, type, cls) {
  const cats = Store.getCategories(type);
  let html = `<select class="${cls || ''}">`;
  html += `<option value="" ${!catId ? 'selected' : ''}>❓ 待归类</option>`;
  for (const c of cats) html += `<option value="${c.id}" ${catId === c.id ? 'selected' : ''}>${c.icon || ''} ${esc(c.name)}</option>`;
  return html + '</select>';
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
  <div class="layout-wide">
  <div class="col">
  <div class="card">
    <h3>⚡ 快速记账</h3>
    <div class="sub">多笔收支写在一起，用逗号分开，自动拆分、判断收支并归类。日期可在下方修改。</div>
    <input type="date" id="recDate" value="${S.recordDate}" style="margin-bottom:10px">
    <textarea id="smartText" placeholder="例：咖啡 15，超市购物 68.5，工资收入 8000"></textarea>
    <button class="btn block" id="btnParse">解析</button>
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
      <span class="p-note" title="${esc(p.note)}">${esc(p.note)}</span>
      ${catSelect(p.catId, p.type, 'p-cat')}
      <input class="p-amt" type="number" step="0.01" value="${p.amount}">
      <button class="p-del">✕</button>
    </div>`).join('');
}

function entryRow(e) {
  const c = e.catId ? Store.getCat(e.catId) : null;
  const name = c ? c.name : '待归类';
  const color = c ? c.color : '#b0b8b5';
  const icon = c ? (c.icon || '🏷️') : '❓';
  if (S.editingId === e.id) return entryEditor(e);
  return `
  <div class="entry" data-id="${e.id}">
    <span class="e-ico chip" style="background:color-mix(in srgb, ${color} 15%, transparent)" title="点击编辑">${icon}</span>
    <span class="e-mid">
      <div class="e-cat ${c ? '' : 'unknown'}">${esc(name)}</div>
      <div class="e-note">${esc(e.note) || '（无备注）'}</div>
    </span>
    <span class="e-amt ${e.type === 'expense' ? 'amt-expense' : 'amt-income'}">${e.type === 'expense' ? '-' : '+'}${fmtM(e.amount)}</span>
    <span class="e-ops"><button class="op-edit" title="编辑">✏️</button><button class="op-del" title="删除">🗑</button></span>
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
    <div class="row" style="width:100%;margin-top:6px">
      <button class="btn small ed-save">保存</button>
      <button class="btn small ghost ed-cancel">取消</button>
    </div>
  </div>`;
}

function bindRecord() {
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
    Store.addEntries(valid.map(p => ({ date: S.recordDate, type: p.type, amount: p.amount, note: p.note, catId: p.catId, manual: !!p.manual })));
    S.parsed = []; S._smartText = '';
    toast(`已保存 ${valid.length} 笔 ✔`);
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
    Store.addEntry({ date: S.recordDate, type: S.manualType, amount: amt, note: $('#mNote').value, catId, manual: !!catId });
    toast('已保存 ✔'); render();
  };
  bindEntryOps($('#view'));
}

/* 条目通用操作（记账页 & 明细页共用） */
function bindEntryOps(root) {
  root.addEventListener('click', (ev) => {
    const row = ev.target.closest('.entry'); if (!row) return;
    const id = row.dataset.id;
    const e = Store.getEntries().find(x => x.id === id); if (!e) return;
    if (ev.target.classList.contains('op-del')) {
      if (confirm('删除这笔记录？\n' + (e.note || '') + ' ' + e.amount)) { Store.removeEntry(id); toast('已删除'); render(); }
    } else if (ev.target.classList.contains('op-edit')) {
      S.editingId = id; render();
    } else if (ev.target.classList.contains('chip')) {
      S.editingId = id; render();
    } else if (ev.target.classList.contains('ed-save')) {
      const type = row.querySelector('.ed-inc').classList.contains('on-income') ? 'income' : 'expense';
      Store.updateEntry(id, {
        type,
        amount: parseFloat(row.querySelector('.ed-amt').value) || e.amount,
        note: row.querySelector('.ed-note').value,
        date: row.querySelector('.ed-date').value || e.date,
        catId: row.querySelector('.ed-cat').value || null,
        manual: true,
      });
      S.editingId = null; toast('已更新 ✔'); render();
    } else if (ev.target.classList.contains('ed-cancel')) {
      S.editingId = null; render();
    } else if (ev.target.classList.contains('ed-exp')) {
      row.querySelector('.ed-exp').classList.add('on-expense');
      row.querySelector('.ed-inc').classList.remove('on-income');
    } else if (ev.target.classList.contains('ed-inc')) {
      row.querySelector('.ed-inc').classList.add('on-income');
      row.querySelector('.ed-exp').classList.remove('on-expense');
    }
  });
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
    <div class="summary-box" title="${debtLabel(bal.debt).tip}"><div class="s-label">月末负债</div><div class="s-val" style="color:${debtLabel(bal.debt).color}">${debtLabel(bal.debt).text}</div></div>
  </div>
  <div class="debt-strip">
    <div class="debt-box ${t.balanceReal >= 0 ? 'good' : 'bad'}">
      <div class="d-label">真实结余（不含借还款）</div>
      <div class="d-val" style="color:${t.balanceReal >= 0 ? 'var(--brand)' : 'var(--danger)'}">${t.balanceReal >= 0 ? '+' : ''}${fmtM(t.balanceReal)}</div>
    </div>
    <div class="debt-box ${dt.debtChange > 0 ? 'warn' : ''}">
      <div class="d-label">本月借入 / 还款</div>
      <div class="d-val" style="font-size:.9rem">${fmtM(dt.borrow)} / ${fmtM(dt.repay)}</div>
    </div>
    <div class="debt-box ${bal.credit > 0 ? 'warn' : ''}">
      <div class="d-label">别人欠我（债权）</div>
      <div class="d-val">${fmtM(bal.credit)}</div>
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
  const rows = Store.catTotals(list, S.statsType);
  const hasDebt = dt.borrow || dt.repay || dt.lend || dt.collect || bal.debt || bal.credit;
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
    <div class="sub">积蓄 = 期初积蓄 ＋ 累计收入 − 累计支出，可在「数据」页设期初</div>
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
      <div class="debt-box ${bal.debt > 0 ? 'bad' : 'good'}" title="${debtLabel(bal.debt).tip}">
        <div class="d-label">期末负债余额</div><div class="d-val" style="color:${debtLabel(bal.debt).color}">${debtLabel(bal.debt).text}</div>
      </div>
      <div class="debt-box"><div class="d-label">本期借入</div><div class="d-val" style="color:var(--danger)">${fmtM(dt.borrow)}</div></div>
      <div class="debt-box"><div class="d-label">本期还款</div><div class="d-val" style="color:var(--brand)">${fmtM(dt.repay)}</div></div>
      <div class="debt-box ${bal.credit > 0 ? 'warn' : ''}"><div class="d-label">别人欠我</div><div class="d-val">${fmtM(bal.credit)}</div></div>
    </div>
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
    S.tab = 'detail'; render();
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
    } catch (err) { alert('导出图片失败：' + err.message); }
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
    } catch (err) { alert('导出图片失败：' + err.message); }
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
      S.tab = 'detail'; render();
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
    card.appendChild(S.cmpMini === 'line' ? Charts.sparkLines(labels, series) : Charts.sparkBars(labels, series));
    // 点卡片 → 单项细看；点分类名 → 直接看明细
    card.onclick = () => { S.cmpCat = r.id; render(); };
    card.querySelector('.m-name').onclick = (e) => {
      e.stopPropagation();
      S.detailFilter = r.id === '__unknown__' ? 'unknown' : 'cat:' + r.id;
      S.detailMonth = years[years.length - 1] + '-01';
      S.tab = 'detail'; render();
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
  if (gu) gu.onclick = () => { S.detailFilter = 'unknown'; S.tab = 'detail'; render(); };
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
  $('#cpDetail').onclick = () => { S.detailFilter = 'cat:' + id; S.tab = 'detail'; render(); };
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
  <div class="hero">
    <div class="h-label">净资产</div>
    <div class="h-big">¥ ${fmtM(as.net)}</div>
    <div class="h-row">
      <div class="h-item"><div class="h-label">当前积蓄</div><div class="h-val">${fmtM(as.savings)}</div></div>
      <div class="h-item"><div class="h-label">当前负债</div><div class="h-val">${debtLabel(as.debt).text}</div></div>
      <div class="h-item"><div class="h-label">别人欠我</div><div class="h-val">${fmtM(as.credit)}</div></div>
    </div>
  </div>
  ${as.debt < 0 ? '<div class="sub" style="margin:-6px 2px 14px">负债显示「净还」说明记录到的还款比借入多（早期用花呗付款时没记「借」），把下面的期初负债填上就对了。</div>' : ''}

  <div class="card">
    <h3>💼 期初资产</h3>
    <div class="sub">开始记账<b>之前</b>的家底。填了它，上面的「积蓄」和「负债」才是真实数字。<br>
      积蓄 = 期初积蓄 ＋ 累计收入 − 累计支出　｜　负债 = 期初负债 ＋ 累计借入 − 累计还款　｜　净资产 = 积蓄 ＋ 别人欠我 − 我欠别人</div>
    <div class="set-row">
      <div class="sr-t"><b>期初积蓄</b><span>记账前手头有的钱：存款＋余额宝＋现金等</span></div>
      <input type="number" id="opBalance" value="${st.openingBalance || 0}" step="0.01" style="flex:0 0 130px">
    </div>
    <div class="set-row">
      <div class="sr-t"><b>期初负债</b><span>记账前就欠着的：花呗、分付、信用卡已用额度、跟人借的</span></div>
      <input type="number" id="opDebt" value="${st.openingDebt || 0}" step="0.01" style="flex:0 0 130px">
    </div>
    <div class="set-row">
      <div class="sr-t"><b>期初债权</b><span>记账前别人欠我的</span></div>
      <input type="number" id="opCredit" value="${st.openingCredit || 0}" step="0.01" style="flex:0 0 130px">
    </div>
  </div>

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
    <div class="sub">两种表格都能直接吃，选文件就行，会自动认格式：
      <br>① <b>你原来的手写账单</b>（每月一张表、一行一天「1号：早餐 3，地铁 4」、带「支出合计」列）—— 自动逐日拆分归类
      <br>② <b>本 APP 导出的表格</b>（有「日期、类型、分类、金额、备注」列，顺序不限）
      <br>另外也支持 CSV 和 JSON 备份。</div>
    <div class="row" style="flex-wrap:wrap">
      <select id="impMode" style="flex:1 1 160px">
        <option value="merge">合并（保留现有记录）</option>
        <option value="replace">覆盖（替换全部数据）</option>
      </select>
      <button class="btn" id="btnImport">选择文件（.xlsx / .csv / .json）</button>
    </div>
    <input type="file" id="impFile" accept=".json,.csv,.xlsx" hidden>
  </div>

  <div class="card">
    <h3>📦 当前数据</h3>
    <div class="sub" style="margin-bottom:0">共 ${n} 笔记录，占用约 ${kb} KB${years.length ? '，覆盖年份：' + years.join('、') : ''}</div>
  </div>

  <div class="card">
    <h3>⚠️ 清空</h3>
    <button class="btn danger" id="btnClear">清空全部数据</button>
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
  // 标准格式：任意一张表里有「日期」表头
  const std = sheets.find(sh => (sh.rows.slice(0, 10)).some(r => (r || []).some(c => /^\s*日期\s*$/.test(String(c || '')))));
  const rawSheets = sheets.filter(sh => sheetMonth(sh.name) && looksLikeRawBill(sh.rows));

  if (std && !rawSheets.length) {
    const res = importTable(std.rows, mode);
    toast(`导入完成：新增 ${res.added} 笔${res.bad ? `，跳过 ${res.bad} 行` : ''}`);
    return;
  }
  if (!rawSheets.length) {
    throw new Error('这个表格既不是本 APP 导出的格式（需要有「日期」列），\n也不像按月分表的原始账单（需要有「支出合计」列和「N号：」这样的行）。');
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

/* 从二维表格数据导入（CSV / XLSX 共用） */
function importTable(rows, mode) {
  if (!rows.length) throw new Error('表格是空的');
  // 找表头行（前 10 行内找带「日期」的那行，容忍表格上面有标题）
  let hi = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if ((rows[i] || []).some(c => /^\s*日期\s*$/.test(String(c || '')))) { hi = i; break; }
  }
  if (hi < 0) throw new Error('没找到表头，需要包含「日期」列');
  const head = rows[hi].map(c => String(c || '').trim());
  const idx = (...names) => {
    for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; }
    return -1;
  };
  const iDate = idx('日期'), iType = idx('类型'), iCat = idx('分类'), iAmt = idx('金额'), iNote = idx('备注');
  if (iDate < 0 || iAmt < 0) throw new Error('表头必须至少包含「日期」和「金额」两列');

  const catByName = new Map(Store.getCategories().map(c => [c.name, c]));
  const batch = [];
  let bad = 0;
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    let date = r[iDate];
    if (date instanceof Date) date = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    date = String(date == null ? '' : date).trim().replace(/[/.]/g, '-');
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(date);
    if (!m) { if (String(r[iDate] || '').trim()) bad++; continue; }
    date = `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
    const amt = Math.abs(parseFloat(String(r[iAmt]).replace(/[,，¥\s]/g, '')));
    if (!amt || !isFinite(amt)) { bad++; continue; }
    const typeStr = iType >= 0 ? String(r[iType] || '').trim() : '';
    const type = /收|入账|进账|\+/.test(typeStr) ? 'income' : 'expense';
    const note = iNote >= 0 ? String(r[iNote] == null ? '' : r[iNote]).trim() : '';
    const catStr = iCat >= 0 ? String(r[iCat] || '').trim() : '';
    let catId;
    if (catStr && catStr !== '未知' && catByName.has(catStr)) {
      const c = catByName.get(catStr);
      catId = c.type === type ? c.id : Store.categorize(note, type);
    } else if (catStr && catStr !== '未知') {
      const c = Store.addCategory(type, catStr);   // 表里有新分类就自动建
      catByName.set(catStr, c);
      catId = c.id;
    } else {
      catId = Store.categorize(note, type);
    }
    batch.push({ date, type, amount: amt, note, catId, manual: !!catStr && catStr !== '未知' });
  }
  if (!batch.length) throw new Error('没有解析到有效数据行');
  if (mode === 'replace') Store.clearAll();
  for (let i = 0; i < batch.length; i += 500) Store.addEntries(batch.slice(i, i + 500));
  return { added: batch.length, bad };
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

  /* 期初资产 */
  const setOpening = (key, label) => (ev) => {
    Store.updateSettings({ [key]: Math.round((parseFloat(ev.target.value) || 0) * 100) / 100 });
    toast(label + '已更新'); render();
  };
  $('#opBalance').onchange = setOpening('openingBalance', '期初积蓄');
  $('#opDebt').onchange = setOpening('openingDebt', '期初负债');
  $('#opCredit').onchange = setOpening('openingCredit', '期初债权');

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
      if (!confirm(`用备份「${b.dataset.n}」覆盖当前全部数据？\n当前数据会被替换，建议先「立即备份」。`)) return;
      try {
        const txt = await Backup.read(b.dataset.n);
        const cnt = Store.importBackup(JSON.parse(txt), 'replace');
        Theme.init();
        toast(`已恢复，共 ${cnt} 笔记录`); render();
      } catch (err) { alert('恢复失败：' + err.message); }
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
    } catch (err) { if (err.name !== 'AbortError') alert('选择失败：' + err.message); }
  };
  const openBtn = $('#bkOpen');
  if (openBtn) openBtn.onclick = () => Backup.openDir();
  $('#bkNow').onclick = async () => {
    try {
      const res = await Backup.run({ interactive: true });
      toast(res.ok ? `备份完成 → ${res.where}` : '备份未完成');
      refreshBackupUI();
    } catch (err) { alert('备份失败：' + err.message); }
  };

  /* 导出 */
  $('#btnExportXlsx').onclick = async () => {
    try {
      const blob = XLSX.build(buildSheets());
      const p = await saveBlob(`生活账单-${todayStr()}.xlsx`, blob, [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]);
      if (p) toast('表格已导出（4 张工作表）');
    } catch (err) { alert('导出失败：' + err.message); }
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
    } catch (err) { alert('导出图谱失败：' + err.message); }
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
        const res = importTable(parseCsv(await f.text()), mode);
        toast(`导入完成：新增 ${res.added} 笔${res.bad ? `，跳过 ${res.bad} 行无效数据` : ''}`);
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
$$('.tab').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; S.editingId = null; render(); });
Theme.init();
render();
/* 自动备份完成后提示一下，并刷新数据页的备份列表 */
window.onBackupDone = (res, time) => {
  toast(`⏰ ${time} 自动备份完成 → ${res.where}`);
  if (S.tab === 'data') render();
};
Backup.start();
