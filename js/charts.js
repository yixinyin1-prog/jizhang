/* ===== 轻量 SVG 图表：柱状图 / 折线图 / 环形图（零依赖，离线可用） ===== */
'use strict';

const Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const fmt = (n) => n >= 10000 ? (n / 10000).toFixed(1) + '万' : (Math.round(n * 100) / 100).toLocaleString('zh-CN');

  function el(tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /* 分组柱状图 labels: ['1月',...], series: [{name,color,values:[...]}] */
  function barChart(labels, series, opts = {}) {
    const W = Math.max(opts.width || 640, labels.length * series.length * 14 + 80);
    const H = opts.height || 260;
    const P = { l: 46, r: 10, t: 14, b: 28 };
    const cw = W - P.l - P.r, ch = H - P.t - P.b;
    const max = Math.max(1, ...series.flatMap(s => s.values));
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', style: `min-width:${Math.min(W, 640)}px` });

    // y 轴网格
    for (let i = 0; i <= 4; i++) {
      const y = P.t + ch - ch * i / 4;
      svg.appendChild(el('line', { x1: P.l, y1: y, x2: W - P.r, y2: y, stroke: '#e7ecea', 'stroke-width': 1 }));
      svg.appendChild(el('text', { x: P.l - 5, y: y + 4, 'text-anchor': 'end', 'font-size': 10, fill: '#8a968f' }, fmt(max * i / 4)));
    }
    const groupW = cw / labels.length;
    const barW = Math.min(22, groupW * 0.7 / series.length);
    labels.forEach((lb, i) => {
      const gx = P.l + groupW * i + groupW / 2;
      series.forEach((s, si) => {
        const v = s.values[i] || 0;
        const h = ch * v / max;
        const x = gx - barW * series.length / 2 + si * barW;
        const rect = el('rect', { x, y: P.t + ch - h, width: barW - 1.5, height: Math.max(h, 0), rx: 2, fill: s.color });
        const t = el('title', {}, `${lb} ${s.name}: ${fmt(v)}`);
        rect.appendChild(t); svg.appendChild(rect);
      });
      svg.appendChild(el('text', { x: gx, y: H - 10, 'text-anchor': 'middle', 'font-size': 10, fill: '#8a968f' }, lb));
    });
    return svg;
  }

  /* 折线图，参数同 barChart */
  function lineChart(labels, series, opts = {}) {
    const W = opts.width || 640, H = opts.height || 260;
    const P = { l: 46, r: 14, t: 14, b: 28 };
    const cw = W - P.l - P.r, ch = H - P.t - P.b;
    const max = Math.max(1, ...series.flatMap(s => s.values));
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', style: 'min-width:480px' });
    for (let i = 0; i <= 4; i++) {
      const y = P.t + ch - ch * i / 4;
      svg.appendChild(el('line', { x1: P.l, y1: y, x2: W - P.r, y2: y, stroke: '#e7ecea' }));
      svg.appendChild(el('text', { x: P.l - 5, y: y + 4, 'text-anchor': 'end', 'font-size': 10, fill: '#8a968f' }, fmt(max * i / 4)));
    }
    const step = cw / Math.max(labels.length - 1, 1);
    labels.forEach((lb, i) => {
      if (labels.length <= 14 || i % 2 === 0)
        svg.appendChild(el('text', { x: P.l + step * i, y: H - 10, 'text-anchor': 'middle', 'font-size': 10, fill: '#8a968f' }, lb));
    });
    for (const s of series) {
      let d = '';
      s.values.forEach((v, i) => {
        const x = P.l + step * i, y = P.t + ch - ch * (v || 0) / max;
        d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
      });
      svg.appendChild(el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }));
      s.values.forEach((v, i) => {
        const x = P.l + step * i, y = P.t + ch - ch * (v || 0) / max;
        const c = el('circle', { cx: x, cy: y, r: 3.2, fill: s.color });
        c.appendChild(el('title', {}, `${labels[i]} ${s.name}: ${fmt(v || 0)}`));
        svg.appendChild(c);
      });
    }
    return svg;
  }

  /* 环形图 items: [{label,value,color}] */
  function donut(items, opts = {}) {
    const size = opts.size || 190, R = size / 2, r0 = R * 0.62, r1 = R * 0.95;
    items = items.filter(x => x.value > 0);
    const total = items.reduce((s, x) => s + x.value, 0) || 1;
    const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, width: opts.cssSize || '170', height: opts.cssSize || '170' });
    let a = -Math.PI / 2;
    for (const it of items) {
      const frac = it.value / total;
      const a2 = a + frac * Math.PI * 2;
      const large = frac > 0.5 ? 1 : 0;
      const p = (ang, r) => `${(R + r * Math.cos(ang)).toFixed(2)} ${(R + r * Math.sin(ang)).toFixed(2)}`;
      // 避免 100% 时弧线闭合消失
      const aEnd = frac >= 0.999 ? a2 - 0.0001 : a2;
      const d = `M ${p(a, r1)} A ${r1} ${r1} 0 ${large} 1 ${p(aEnd, r1)} L ${p(aEnd, r0)} A ${r0} ${r0} 0 ${large} 0 ${p(a, r0)} Z`;
      const path = el('path', { d, fill: it.color });
      path.appendChild(el('title', {}, `${it.label}: ${fmt(it.value)} (${(frac * 100).toFixed(1)}%)`));
      svg.appendChild(path);
      a = a2;
    }
    svg.appendChild(el('text', { x: R, y: R - 4, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: '#23312c' }, fmt(total)));
    svg.appendChild(el('text', { x: R, y: R + 14, 'text-anchor': 'middle', 'font-size': 10, fill: '#8a968f' }, opts.centerLabel || '合计'));
    return svg;
  }

  /* 饼图（实心），items: [{label,value,color}]
     负值/零值画不出有意义的扇区（会画成反向重叠），直接跳过 */
  function pie(items, opts = {}) {
    const size = opts.size || 200, R = size / 2, r1 = R * 0.95;
    items = items.filter(x => x.value > 0);
    if (!items.length) return el('svg', { viewBox: `0 0 ${size} ${size}`, width: opts.cssSize || '190', height: opts.cssSize || '190' });
    const total = items.reduce((s, x) => s + x.value, 0) || 1;
    const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, width: opts.cssSize || '190', height: opts.cssSize || '190' });
    let a = -Math.PI / 2;
    for (const it of items) {
      const frac = it.value / total;
      const a2 = a + frac * Math.PI * 2;
      const p = (ang, r) => `${(R + r * Math.cos(ang)).toFixed(2)} ${(R + r * Math.sin(ang)).toFixed(2)}`;
      let path;
      if (frac >= 0.999) {
        path = el('circle', { cx: R, cy: R, r: r1, fill: it.color });
      } else {
        const d = `M ${R} ${R} L ${p(a, r1)} A ${r1} ${r1} 0 ${frac > 0.5 ? 1 : 0} 1 ${p(a2, r1)} Z`;
        path = el('path', { d, fill: it.color, stroke: '#fff', 'stroke-width': 1 });
      }
      path.appendChild(el('title', {}, `${it.label}: ${fmt(it.value)} (${(frac * 100).toFixed(1)}%)`));
      svg.appendChild(path);
      // 占比大于 6% 才标注百分比，避免拥挤
      if (frac > 0.06) {
        const mid = (a + a2) / 2, lr = R * 0.62;
        svg.appendChild(el('text', {
          x: R + lr * Math.cos(mid), y: R + lr * Math.sin(mid) + 4,
          'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: '#fff',
        }, (frac * 100).toFixed(0) + '%'));
      }
      a = a2;
    }
    return svg;
  }

  /* 横向条形图（分类排行），items: [{label,value,color,icon}] */
  function hBar(items, opts = {}) {
    const rowH = opts.rowH || 26, W = opts.width || 620;
    const H = Math.max(items.length * rowH + 16, 40);
    const labelW = opts.labelW || 92, valW = 74;
    const cw = W - labelW - valW - 12;
    const max = Math.max(1, ...items.map(i => Math.abs(i.value)));
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', style: 'min-width:420px' });
    items.forEach((it, i) => {
      const y = 8 + i * rowH;
      svg.appendChild(el('text', { x: labelW - 8, y: y + rowH / 2 + 3, 'text-anchor': 'end', 'font-size': 11.5, fill: '#5b6b64' },
        (it.label.length > 6 ? it.label.slice(0, 6) + '…' : it.label)));
      svg.appendChild(el('rect', { x: labelW, y: y + 3, width: cw, height: rowH - 12, rx: 4, fill: '#f0f3f1' }));
      const w = cw * Math.abs(it.value) / max;
      // 负值（多为冲抵/退款）用斜纹描边区分，避免和正值看起来一样
      const bar = el('rect', {
        x: labelW, y: y + 3, width: Math.max(w, 1.5), height: rowH - 12, rx: 4,
        fill: it.value < 0 ? 'none' : it.color,
        stroke: it.value < 0 ? it.color : 'none',
        'stroke-width': it.value < 0 ? 1.5 : 0,
        'stroke-dasharray': it.value < 0 ? '3 2' : 'none',
      });
      bar.appendChild(el('title', {}, `${it.label}: ${fmt(it.value)}${it.value < 0 ? '（冲抵）' : ''}`));
      svg.appendChild(bar);
      svg.appendChild(el('text', { x: W - 4, y: y + rowH / 2 + 3, 'text-anchor': 'end', 'font-size': 11, 'font-weight': 600, fill: '#1c2a24' }, fmt(it.value)));
    });
    return svg;
  }

  /* 收支平衡图：正值向上（收入）、负值向下（支出），叠加结余折线 */
  function balanceChart(labels, income, expense, opts = {}) {
    const W = Math.max(opts.width || 660, labels.length * 30 + 70);
    const H = opts.height || 280;
    const P = { l: 50, r: 12, t: 16, b: 30 };
    const cw = W - P.l - P.r, ch = H - P.t - P.b;
    const max = Math.max(1, ...income, ...expense);
    const zero = P.t + ch / 2;
    const half = ch / 2;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', style: `min-width:${Math.min(W, 620)}px` });
    // 网格
    for (let i = -2; i <= 2; i++) {
      const y = zero - half * i / 2;
      svg.appendChild(el('line', { x1: P.l, y1: y, x2: W - P.r, y2: y, stroke: i === 0 ? '#c8d2ce' : '#eef2f0', 'stroke-width': i === 0 ? 1.2 : 1 }));
      svg.appendChild(el('text', { x: P.l - 5, y: y + 4, 'text-anchor': 'end', 'font-size': 9.5, fill: '#93a19a' }, fmt(Math.abs(max * i / 2))));
    }
    const gw = cw / labels.length, bw = Math.min(15, gw * 0.34);
    labels.forEach((lb, i) => {
      const gx = P.l + gw * i + gw / 2;
      const hi = half * (income[i] || 0) / max;
      const he = half * (expense[i] || 0) / max;
      const rIn = el('rect', { x: gx - bw - 1, y: zero - hi, width: bw, height: Math.max(hi, 0), rx: 2, fill: '#2f7cf6' });
      rIn.appendChild(el('title', {}, `${lb} 收入: ${fmt(income[i] || 0)}`));
      const rEx = el('rect', { x: gx + 1, y: zero, width: bw, height: Math.max(he, 0), rx: 2, fill: '#f0524c' });
      rEx.appendChild(el('title', {}, `${lb} 支出: ${fmt(expense[i] || 0)}`));
      svg.appendChild(rIn); svg.appendChild(rEx);
      if (labels.length <= 16 || i % 3 === 0)
        svg.appendChild(el('text', { x: gx, y: H - 10, 'text-anchor': 'middle', 'font-size': 9.5, fill: '#93a19a' }, lb));
    });
    // 结余折线
    let d = '';
    labels.forEach((_, i) => {
      const bal = (income[i] || 0) - (expense[i] || 0);
      const x = P.l + gw * i + gw / 2;
      const y = zero - half * bal / max;
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
    });
    svg.appendChild(el('path', { d, fill: 'none', stroke: '#f5a524', 'stroke-width': 2, 'stroke-dasharray': '4 3' }));
    labels.forEach((lb, i) => {
      const bal = (income[i] || 0) - (expense[i] || 0);
      const c = el('circle', { cx: P.l + gw * i + gw / 2, cy: zero - half * bal / max, r: 2.6, fill: '#f5a524' });
      c.appendChild(el('title', {}, `${lb} 结余: ${fmt(bal)}`));
      svg.appendChild(c);
    });
    return svg;
  }

  /* 迷你折线图（对比页分类矩阵用），series: [{name,color,values}] */
  function sparkLines(labels, series, opts = {}) {
    const W = opts.width || 210, H = opts.height || 62;
    const P = { l: 3, r: 3, t: 6, b: 3 };
    const cw = W - P.l - P.r, ch = H - P.t - P.b;
    const max = Math.max(1, ...series.flatMap(s => s.values));
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H });
    const step = cw / Math.max(labels.length - 1, 1);
    for (const s of series) {
      let d = '';
      s.values.forEach((v, i) => {
        const x = P.l + step * i, y = P.t + ch - ch * (v || 0) / max;
        d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
      });
      const path = el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 1.8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
      path.appendChild(el('title', {}, `${s.name}: 合计 ${fmt(s.values.reduce((a, b) => a + b, 0))}`));
      svg.appendChild(path);
    }
    return svg;
  }

  /* 迷你分组柱（对比页分类矩阵用） */
  function sparkBars(labels, series, opts = {}) {
    const W = opts.width || 210, H = opts.height || 62;
    const P = { l: 3, r: 3, t: 6, b: 3 };
    const cw = W - P.l - P.r, ch = H - P.t - P.b;
    const max = Math.max(1, ...series.flatMap(s => s.values));
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H });
    const gw = cw / labels.length, bw = Math.max(1.2, gw * 0.72 / series.length);
    labels.forEach((lb, i) => {
      series.forEach((s, si) => {
        const v = s.values[i] || 0;
        const h = ch * v / max;
        const x = P.l + gw * i + gw * 0.14 + si * bw;
        const r = el('rect', { x, y: P.t + ch - h, width: Math.max(bw - 0.4, 0.8), height: Math.max(h, 0), rx: 0.8, fill: s.color });
        r.appendChild(el('title', {}, `${lb} ${s.name}: ${fmt(v)}`));
        svg.appendChild(r);
      });
    });
    return svg;
  }

  /* 矩阵柱状图：X 轴分类多、系列多（如 12 个月），标签斜排避免重叠。
     对应你原表里「各开销明细」那张图。 */
  function matrixChart(labels, series, opts = {}) {
    const rotate = opts.rotate !== false;
    const P = { l: 52, r: 12, t: 14, b: rotate ? 74 : 32 };
    const perGroup = Math.max(opts.groupWidth || 0, series.length * 5 + 14);
    const W = Math.max(opts.width || 660, labels.length * perGroup + P.l + P.r);
    const H = opts.height || 320;
    const cw = W - P.l - P.r, ch = H - P.t - P.b;
    const max = Math.max(1, ...series.flatMap(s => s.values.map(v => v || 0)));
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', style: `min-width:${Math.min(W, 640)}px` });

    for (let i = 0; i <= 5; i++) {
      const y = P.t + ch - ch * i / 5;
      svg.appendChild(el('line', { x1: P.l, y1: y, x2: W - P.r, y2: y, stroke: '#e7ecea' }));
      svg.appendChild(el('text', { x: P.l - 5, y: y + 3.5, 'text-anchor': 'end', 'font-size': 9.5, fill: '#93a19a' }, fmt(max * i / 5)));
    }
    const gw = cw / labels.length;
    const bw = Math.max(1.6, gw * 0.78 / series.length);
    labels.forEach((lb, i) => {
      const gx0 = P.l + gw * i + gw * 0.11;
      series.forEach((s, si) => {
        const v = s.values[i] || 0;
        const h = ch * v / max;
        const r = el('rect', {
          x: gx0 + si * bw, y: P.t + ch - h, width: Math.max(bw - 0.5, 1),
          height: Math.max(h, 0), rx: 1, fill: s.color,
        });
        r.appendChild(el('title', {}, `${lb} · ${s.name}: ${fmt(v)}`));
        svg.appendChild(r);
      });
      const cx = P.l + gw * i + gw / 2;
      if (rotate) {
        const t = el('text', { x: cx, y: H - P.b + 14, 'font-size': 10, fill: '#5b6b64', 'text-anchor': 'end' }, lb);
        t.setAttribute('transform', `rotate(-38 ${cx} ${H - P.b + 14})`);
        svg.appendChild(t);
      } else {
        svg.appendChild(el('text', { x: cx, y: H - 10, 'text-anchor': 'middle', 'font-size': 10, fill: '#5b6b64' }, lb));
      }
    });
    return svg;
  }

  /* 正负柱状图：结余/存款这类有正有负的（对应原表「存款负债表」） */
  function divergingBars(labels, values, opts = {}) {
    const W = Math.max(opts.width || 640, labels.length * 26 + 70);
    const H = opts.height || 240;
    const P = { l: 52, r: 12, t: 14, b: 26 };
    const cw = W - P.l - P.r, ch = H - P.t - P.b;
    const maxV = Math.max(0, ...values), minV = Math.min(0, ...values);
    const span = (maxV - minV) || 1;
    const zero = P.t + ch * (maxV / span);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', style: `min-width:${Math.min(W, 620)}px` });
    for (let i = 0; i <= 4; i++) {
      const v = maxV - span * i / 4;
      const y = P.t + ch * i / 4;
      svg.appendChild(el('line', { x1: P.l, y1: y, x2: W - P.r, y2: y, stroke: '#eef2f0' }));
      svg.appendChild(el('text', { x: P.l - 5, y: y + 3.5, 'text-anchor': 'end', 'font-size': 9.5, fill: '#93a19a' }, fmt(v)));
    }
    svg.appendChild(el('line', { x1: P.l, y1: zero, x2: W - P.r, y2: zero, stroke: '#c8d2ce', 'stroke-width': 1.2 }));
    const gw = cw / labels.length, bw = Math.min(20, gw * 0.6);
    labels.forEach((lb, i) => {
      const v = values[i] || 0;
      const h = Math.abs(ch * v / span);
      const cx = P.l + gw * i + gw / 2;
      const r = el('rect', {
        x: cx - bw / 2, y: v >= 0 ? zero - h : zero, width: bw, height: Math.max(h, 0), rx: 2,
        fill: v >= 0 ? (opts.posColor || '#0b8f66') : (opts.negColor || '#f0524c'),
      });
      r.appendChild(el('title', {}, `${lb}: ${fmt(v)}`));
      svg.appendChild(r);
      if (labels.length <= 16 || i % 2 === 0)
        svg.appendChild(el('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': 9.5, fill: '#93a19a' }, lb));
    });
    return svg;
  }

  /* 把页面上的 SVG 导出成 PNG（图谱导出用） */
  function svgToPng(svg, filename, scale) {
    return new Promise((resolve, reject) => {
      const clone = svg.cloneNode(true);
      const vb = (clone.getAttribute('viewBox') || '0 0 640 300').split(/\s+/).map(Number);
      const w = vb[2], h = vb[3];
      clone.setAttribute('width', w); clone.setAttribute('height', h);
      // 白底，避免透明 PNG 在相册里看不清
      const bg = el('rect', { x: 0, y: 0, width: w, height: h, fill: '#ffffff' });
      clone.insertBefore(bg, clone.firstChild);
      const xml = new XMLSerializer().serializeToString(clone);
      const img = new Image();
      const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      img.onload = () => {
        const k = scale || 2;
        const cv = document.createElement('canvas');
        cv.width = w * k; cv.height = h * k;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob(b => b ? resolve(b) : reject(new Error('导出图片失败')), 'image/png');
      };
      img.onerror = () => reject(new Error('图表渲染失败'));
      img.src = svgUrl;
    });
  }

  return {
    barChart, lineChart, donut, pie, hBar, balanceChart,
    matrixChart, divergingBars, sparkLines, sparkBars, svgToPng, fmt,
  };
})();
