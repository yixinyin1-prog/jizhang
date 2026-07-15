/* ===== 自建弹窗 =====
   Electron 不支持 window.prompt()，会静默失败；安卓 WebView 的原生弹窗也很丑。
   这里统一用自己的弹窗，三端表现一致。
*/
'use strict';

const Modal = (() => {

  function build({ title, body, okText = '确定', cancelText = '取消', showCancel = true, danger = false }) {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal-box" role="dialog" aria-modal="true">
        <div class="modal-head">${title || ''}</div>
        <div class="modal-body"></div>
        <div class="modal-foot">
          ${showCancel ? `<button class="btn ghost" data-act="cancel">${cancelText}</button>` : ''}
          <button class="btn ${danger ? 'danger' : ''}" data-act="ok">${okText}</button>
        </div>
      </div>`;
    mask.querySelector('.modal-body').append(body);
    document.body.appendChild(mask);
    requestAnimationFrame(() => mask.classList.add('show'));
    return mask;
  }

  function close(mask) {
    mask.classList.remove('show');
    setTimeout(() => mask.remove(), 160);
  }

  /* 通用：返回 Promise，resolve(值) 或 resolve(null) 表示取消 */
  function open(opts) {
    return new Promise((resolve) => {
      const mask = build(opts);
      const done = (v) => { close(mask); resolve(v); };
      mask.querySelector('[data-act=ok]').onclick = () => done(opts.getValue ? opts.getValue(mask) : true);
      const c = mask.querySelector('[data-act=cancel]');
      if (c) c.onclick = () => done(null);
      mask.onclick = (e) => { if (e.target === mask) done(null); };
      const onKey = (e) => {
        if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); done(null); }
      };
      document.addEventListener('keydown', onKey);
      if (opts.onOpen) opts.onOpen(mask, done);
    });
  }

  /* 单行输入，替代 window.prompt */
  function prompt(title, { placeholder = '', value = '', hint = '', okText = '确定' } = {}) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      ${hint ? `<div class="modal-hint">${hint}</div>` : ''}
      <input type="text" class="modal-input" placeholder="${placeholder}" value="${value}">`;
    return open({
      title, body: wrap, okText,
      getValue: (m) => {
        const v = m.querySelector('.modal-input').value.trim();
        return v || null;
      },
      onOpen: (m, done) => {
        const inp = m.querySelector('.modal-input');
        inp.focus(); inp.select();
        inp.onkeydown = (e) => { if (e.key === 'Enter') done(inp.value.trim() || null); };
      },
    });
  }

  /* 多行输入 */
  function promptMulti(title, { placeholder = '', hint = '', okText = '确定', rows = 6 } = {}) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      ${hint ? `<div class="modal-hint">${hint}</div>` : ''}
      <textarea class="modal-input" rows="${rows}" placeholder="${placeholder}" style="min-height:${rows * 22}px"></textarea>`;
    return open({
      title, body: wrap, okText,
      getValue: (m) => m.querySelector('.modal-input').value.trim() || null,
      onOpen: (m) => m.querySelector('.modal-input').focus(),
    });
  }

  /* 确认框（Electron 的 confirm 可用，但样式不统一，这里也自己做） */
  function confirm(title, { text = '', okText = '确定', danger = false } = {}) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="modal-text">${text}</div>`;
    return open({ title, body: wrap, okText, danger, getValue: () => true })
      .then(v => v === true);
  }

  /* 提示框 */
  function alert(title, text = '') {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="modal-text">${text}</div>`;
    return open({ title, body: wrap, showCancel: false, okText: '知道了', getValue: () => true });
  }

  /* 从若干选项里选一个，options: [{value,label,hint}] */
  function choose(title, options, { hint = '' } = {}) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      ${hint ? `<div class="modal-hint">${hint}</div>` : ''}
      <div class="modal-choices">
        ${options.map((o, i) => `
          <label class="modal-choice">
            <input type="radio" name="mc" value="${o.value}" ${i === 0 ? 'checked' : ''}>
            <span><b>${o.label}</b>${o.hint ? `<i>${o.hint}</i>` : ''}</span>
          </label>`).join('')}
      </div>`;
    return open({
      title, body: wrap,
      getValue: (m) => (m.querySelector('input[name=mc]:checked') || {}).value || null,
    });
  }

  /* 自定义表单：fields: [{key,label,type,value,placeholder,hint,options}] */
  function form(title, fields, { okText = '确定' } = {}) {
    const wrap = document.createElement('div');
    wrap.innerHTML = fields.map(f => {
      if (f.type === 'select') {
        return `<label class="fld">${f.label}</label>
          <select class="modal-f" data-k="${f.key}">
            ${f.options.map(o => `<option value="${o.value}" ${o.value === f.value ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>${f.hint ? `<div class="modal-hint" style="margin:4px 0 0">${f.hint}</div>` : ''}`;
      }
      return `<label class="fld">${f.label}</label>
        <input class="modal-f" data-k="${f.key}" type="${f.type || 'text'}" value="${f.value ?? ''}" placeholder="${f.placeholder || ''}">
        ${f.hint ? `<div class="modal-hint" style="margin:4px 0 0">${f.hint}</div>` : ''}`;
    }).join('');
    return open({
      title, body: wrap, okText,
      getValue: (m) => {
        const out = {};
        for (const el of m.querySelectorAll('.modal-f')) out[el.dataset.k] = el.value;
        return out;
      },
      onOpen: (m) => { const f = m.querySelector('.modal-f'); if (f) f.focus(); },
    });
  }

  return { open, prompt, promptMulti, confirm, alert, choose, form };
})();
