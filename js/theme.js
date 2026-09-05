/* ===== 主题色：把选中的配色写进 CSS 变量 ===== */
'use strict';

const Theme = (() => {
  /* 把 #rrggbb 调暗/调亮，k<1 变暗、k>1 变亮 */
  function shade(hex, k) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v =>
      Math.max(0, Math.min(255, Math.round(k <= 1 ? v * k : v + (255 - v) * (k - 1)))));
    return '#' + ch.map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function apply(themeId) {
    const themes = Store.getThemes();
    const t = themes.find(x => x.id === themeId) || themes[0];
    const r = document.documentElement.style;
    r.setProperty('--brand', t.c2);
    r.setProperty('--brand-2', t.c1);
    r.setProperty('--brand-deep', t.c3);
    r.setProperty('--grad', `linear-gradient(135deg, ${t.c2} 0%, ${t.c3} 100%)`);
    r.setProperty('--header-grad', `linear-gradient(112deg, ${t.c3} 0%, ${shade(t.c3, 1.12)} 58%, ${shade(t.c2, .78)} 100%)`);
    r.setProperty('--btn-shadow', `${shade(t.c2, .82)}32`);
    r.setProperty('--brand-soft', `color-mix(in srgb, ${t.c1} 10%, ${t.card || '#fff'})`);
    r.setProperty('--brand-soft-2', `color-mix(in srgb, ${t.c1} 18%, ${t.card || '#fff'})`);
    r.setProperty('--metal', t.metal || '#b39a70');
    r.setProperty('--bg', t.bg || '#f1f3f6');
    r.setProperty('--card', t.card || '#fbfbfa');
    r.setProperty('--text', t.text || '#242a33');
    r.setProperty('--text-2', t.text2 || '#5e6878');
    r.setProperty('--text-3', t.text3 || '#8c96a5');
    r.setProperty('--line', t.line || '#dfe4ea');
    r.setProperty('--input-bg', t.input || '#f5f6f8');
    r.setProperty('--track', t.track || '#e8ebef');

    document.body.classList.toggle('theme-dark', !!t.dark);
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', t.c3);
  }

  function init() {
    const saved = Store.getSettings().theme;
    const themes = Store.getThemes();
    /* 视觉 3.0：旧默认绿色只迁移主题选择，不触碰任何账目或业务设置。 */
    const id = themes.some(t => t.id === saved) ? saved : themes[0].id;
    if (id !== saved) Store.updateSettings({ theme: id });
    apply(id);
  }
  function set(id) { Store.updateSettings({ theme: id }); apply(id); }

  return { apply, init, set, shade };
})();
