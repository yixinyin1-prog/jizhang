/* ===== 智能文本解析：把 "早餐 3，地铁 4，红包入 1.5" 拆成多笔收支 ===== */
'use strict';

const Parser = (() => {

  // 收入特征（与历年账单的写法一致）
  const INCOME_RE = /(红包入|红包\s*\+|红包收|收入|入账|进账|工资|发工资|转进|给我|收到|退款|返现|退回|报销到账|好评\s*\+|收益|分红|利息|奖金)/;
  // 明确支出特征（覆盖收入判断，例如 "给小倩报销 80" 是支出）
  const EXPENSE_OVERRIDE_RE = /^(给|发红包|还|借给|买)/;

  /* 计算 "8.31+7.84" / "755+90=845" / "20-6.42" 这类金额表达式 */
  function evalAmount(seg) {
    // 优先取 "=" 后面的结果
    const eq = seg.match(/=\s*(-?\d+(?:\.\d+)?)/);
    if (eq) return parseFloat(eq[1]);
    // 找出最像金额的表达式：数字(+/-数字)*
    const m = seg.match(/(\d+(?:\.\d+)?)((?:\s*[+\-]\s*\d+(?:\.\d+)?)*)/);
    if (!m) return null;
    let total = parseFloat(m[1]);
    const rest = m[2] || '';
    const ops = rest.match(/[+\-]\s*\d+(?:\.\d+)?/g) || [];
    for (const op of ops) {
      const v = parseFloat(op.replace(/[+\s]/g, '').replace('-', '')) || 0;
      if (op.trim().startsWith('+')) total += v; else total -= v;
    }
    return Math.round(total * 100) / 100;
  }

  /* 解析一段自由文本 → [{amount, note, type}]
     incomeHints: 额外的收入关键词（来自收入分类设置，如"读书会""设计费"） */
  function parseText(text, incomeHints) {
    if (!text) return [];
    const hints = (incomeHints || []).filter(Boolean);
    let t = String(text);
    // 去掉开头的 "N号：" / "N 号："
    t = t.replace(/^\s*\d{1,2}\s*号\s*[:：]?\s*/, '');
    t = t.replace(/^\s*\d{1,2}\s*号\s*[-—~至]\s*\d{1,2}\s*号\s*[:：]?\s*/, '');
    // 去掉【】内的备注（历年账单里【可报销未报销】【医保 30】等不计入）
    t = t.replace(/【[^】]*】/g, ' ');
    t = t.replace(/[（(][^）)]*[）)]/g, (s) => /\d/.test(s) && /(报销|借|还|入)/.test(s) ? ' ' : s); // 括号里带金额说明的去掉
    // 按中文/英文逗号、顿号、分号切分
    const segs = t.split(/[，,、；;。\n]+/).map(s => s.trim()).filter(Boolean);

    const items = [];
    for (const seg of segs) {
      if (!/\d/.test(seg)) continue;                 // 没有数字的片段跳过
      const amount = evalAmount(seg);
      if (amount === null || isNaN(amount) || amount === 0) continue;
      let type = 'expense';
      if (!EXPENSE_OVERRIDE_RE.test(seg)) {
        if (INCOME_RE.test(seg)) type = 'income';
        else if (hints.some(kw => seg.includes(kw))) type = 'income';
      }
      // 备注：去掉多余空白
      const note = seg.replace(/\s+/g, ' ').trim();
      items.push({ amount: Math.abs(amount), note, type });
    }
    return items;
  }

  return { parseText, evalAmount };
})();
