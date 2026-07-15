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
    r.setProperty('--grad', `linear-gradient(135deg, ${t.c1} 0%, ${t.c2} 55%, ${t.c3} 100%)`);
    r.setProperty('--btn-shadow', `${shade(t.c2, .9)}47`);
    // 浅色底纹：按钮次要态、选中态背景
    r.setProperty('--brand-soft', shade(t.c1, 1.86));
    r.setProperty('--brand-soft-2', shade(t.c1, 1.72));

    document.body.classList.toggle('theme-dark', !!t.dark);
    if (t.dark) {
      r.setProperty('--bg', '#161b1f');
      r.setProperty('--card', '#1f262c');
      r.setProperty('--text', '#e8edea');
      r.setProperty('--text-2', '#a5b1ac');
      r.setProperty('--text-3', '#78857f');
      r.setProperty('--line', '#2e373e');
      r.setProperty('--brand-soft', '#2a343b');
      r.setProperty('--brand-soft-2', '#323d45');
      r.setProperty('--input-bg', '#252d34');
      r.setProperty('--track', '#2b343b');
    } else {
      r.removeProperty('--bg'); r.removeProperty('--card');
      r.removeProperty('--text'); r.removeProperty('--text-2'); r.removeProperty('--text-3');
      r.removeProperty('--line'); r.removeProperty('--input-bg'); r.removeProperty('--track');
    }
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', t.c2);
  }

  function init() { apply(Store.getSettings().theme); }
  function set(id) { Store.updateSettings({ theme: id }); apply(id); }

  return { apply, init, set, shade };
})();
