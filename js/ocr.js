/* ===== 本地离线文字识别（OCR）+ 账单文本解析 =====
   截图记账的「免配置」路线：不联网、不要密钥，用打包在 APP 里的 tesseract 引擎
   把截图变文字，再用规则把文字变记账条目。配置并勾选了 AI 时走 AI（更准），
   没配的用这条本地路线兜底。引擎按需加载（首次用才加载那几 MB，不拖慢启动）。 */
'use strict';

const OCR = (() => {

  /* Electron 桌面版：渲染进程是 file:// 打开的，Worker 里 fetch 语言包会被浏览器内核拒绝，
     所以桌面版把 OCR 放到主进程（Node 侧）跑，走 IPC。网页/安卓在页面里跑。 */
  const canNative = () => !!(window.jzNative && window.jzNative.ocr);

  let _worker = null;      // 页面内的 tesseract worker（懒加载，复用）
  let _loading = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('识别引擎加载失败（' + src + '）'));
      document.head.appendChild(s);
    });
  }

  async function ensureWorker(onStatus) {
    if (_worker) return _worker;
    if (_loading) return _loading;
    _loading = (async () => {
      onStatus && onStatus('⏳ 首次使用，正在加载本地识别引擎…');
      if (typeof Tesseract === 'undefined') await loadScript('js/vendor/tesseract/tesseract.min.js');
      const base = new URL('.', location.href).href.replace(/\/$/, '');
      const w = await Tesseract.createWorker('chi_sim', 1, {
        workerPath: base + '/js/vendor/tesseract/worker.min.js',
        corePath: base + '/js/vendor/tesseract',      // v5 会自动选 simd / 非 simd 的 lstm 内核
        langPath: base + '/js/vendor/tessdata',       // chi_sim.traineddata.gz
        gzip: false,
        logger: (m) => {
          if (onStatus && m && m.status === 'recognizing text') {
            onStatus('⏳ 识别中… ' + Math.round((m.progress || 0) * 100) + '%');
          }
        },
      });
      _worker = w;
      return w;
    })();
    try { return await _loading; } finally { _loading = null; }
  }

  /* 识别一张图，返回纯文本 */
  async function recognize(dataUrl, onStatus) {
    if (canNative()) {
      onStatus && onStatus('⏳ 本地识别中（首次要初始化引擎，稍等）…');
      const r = await window.jzNative.ocr({ dataUrl });
      if (r.error) throw new Error(r.error);
      return r.text || '';
    }
    const w = await ensureWorker(onStatus);
    onStatus && onStatus('⏳ 识别中…');
    const { data } = await w.recognize(dataUrl);
    return data.text || '';
  }

  /* ---------- 账单文本 → 记账条目（规则解析） ---------- */

  const FW = { '０':'0','１':'1','２':'2','３':'3','４':'4','５':'5','６':'6','７':'7','８':'8','９':'9','．':'.','－':'-','＋':'+','，':',','：':':' };
  const normalize = (s) => String(s).replace(/[０-９．－＋，：]/g, ch => FW[ch] || ch).replace(/[|｜]/g, '');

  const INCOME_KW = /退款|退回|收入|入账|转入|红包|收款|收获|收钱|返现|报销|工资|奖金|利息|到账/;   // 「收获」是 OCR 常把「收款」认错的样子
  const SKIP_KW = /余额|账户余额|订单号|交易单号|流水号|服务费率|优惠券|积分|运费险|客服|详情|全部账单|筛选|本月支出|本月收入|月支出|月收入|共支出|共收入|合计|统计/;
  /* 支付方式行：「使用建设银行储蓄卡」「零钱支付」这类行说的是怎么付的，
     不该当成商家名/用途做备注 */
  const PAYMENT_KW = /^使用|支付方式|付款方式|零钱支付|余额支付|储蓄卡$|信用卡$|银行卡$/;
  /* 整张截图是「收款」语境（商家收钱码账单等）：无符号的金额默认算收入 */
  const RECEIVE_CTX = /收款账单|收款记录|收款金额|二维码收款|收钱码|收款到账|今日收款|收款通知/;

  /* 行里最像「钱」的数：优先带 ¥/＋/− 前缀的；过滤时间、日期、长单号 */
  function pickAmount(line) {
    const s = normalize(line).replace(/\s+/g, '');
    // 显式金额（带符号或货币符）
    let m = s.match(/([+\-−])?[¥￥](\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/)
         || s.match(/([+\-−])(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/)
         || s.match(/()(\d{1,3}(?:,\d{3})*\.\d{2})(?:元)?$/);        // 行尾 xx.xx
    if (!m) {
      // 退而求其次：行尾整数元（避免把时间/日期当金额）
      const t = s.match(/()(\d{1,6})元$/);
      if (t) m = t;
    }
    if (!m && /金额|收款|收获|付款|实付|实收/.test(s)) {
      // 行里明确说了「金额」这类词，行尾的纯整数也认（如「收款金额 30」）
      const t2 = s.match(/()(\d{1,7})$/);
      if (t2) m = t2;
    }
    if (!m) return null;
    if (/\d{1,2}:\d{2}/.test(s) && !/[¥￥+\-−]/.test(s)) return null;      // 纯时间行
    const num = parseFloat(m[2].replace(/,/g, ''));
    if (!num || !isFinite(num) || num <= 0 || num >= 1e7) return null;
    const sign = m[1] === '+' ? '+' : (m[1] === '-' || m[1] === '−') ? '-' : '';
    return { amount: Math.round(num * 100) / 100, sign, matched: m[0] };
  }

  function pickDate(line, fallbackYear) {
    const s = normalize(line).replace(/\s+/g, '');
    let m = s.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
    if (m) return `${m[1]}-${String(+m[2]).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}`;
    m = s.match(/(\d{1,2})月(\d{1,2})日/);
    if (m) return `${fallbackYear}-${String(+m[1]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`;
    return null;
  }

  /* 把 OCR 文本按行解析成 [{date,type,amount,note}]。
     常见账单是「商家名一行、金额同行或下一行」的版式：
     金额行里没有像样的文字时，用上一行当备注。 */
  function parseBillText(text, today) {
    const year = (today || '').slice(0, 4) || String(new Date().getFullYear());
    const all = String(text);
    // 整张图是「收款」语境（商家收钱码账单）：无符号金额默认收入
    const receiveCtx = RECEIVE_CTX.test(all.replace(/\s+/g, ''));
    const lines = all.split(/\n+/).map(l => l.trim()).filter(l => l.length >= 1);
    const items = [];
    let curDate = today;
    let prevText = '';       // 最近一行「像商家名/用途」的文字
    let prevPay = '';        // 最近一行支付方式里的账户名（如「建设银行」，供自动分账户）
    for (const raw of lines) {
      const d = pickDate(raw, year);
      if (d) { curDate = d; }
      if (SKIP_KW.test(raw)) { prevText = ''; continue; }
      const rawNoSpace = raw.replace(/\s+/g, '');
      const isPayLine = PAYMENT_KW.test(rawNoSpace);   // 「使用XX银行储蓄卡」这类支付方式行
      const amt = pickAmount(raw);
      if (!amt) {
        if (isPayLine) {
          // 抠出账户名：去掉「使用/储蓄卡/信用卡」这些壳，留「建设银行」
          prevPay = rawNoSpace.replace(/^使用/, '').replace(/(储蓄卡|信用卡|银行卡|支付方式|付款方式|支付|付款)/g, '').trim();
        } else if (!d && !/^\d{1,2}:\d{2}/.test(raw)) {
          // 记住这行文字，可能是下一行金额的商家名（跳过日期/时间行）
          prevText = raw;
        }
        continue;
      }
      // 备注 = 本行去掉金额后的文字；本行是支付方式行或剩不下字时，用上一行的商家名
      let note = normalize(raw).replace(amt.matched, '').replace(/[+\-−¥￥元]/g, '').trim();
      note = note.replace(/\d{1,2}:\d{2}(:\d{2})?/g, '').replace(/^[-–·..、]+|[-–·..、]+$/g, '').trim();
      const noteIsPayText = PAYMENT_KW.test(note.replace(/\s+/g, ''));
      if ((noteIsPayText || note.replace(/[\d\s.,:-]/g, '').length < 2) && prevText) {
        note = noteIsPayText && note ? prevText + ' ' + note : prevText;   // 商家名在前，支付方式附后（供自动分账户）
      }
      // 中文 OCR 常在汉字之间插空格（「瑞 幸 咖啡」），去掉；英文单词间的空格保留
      note = note.replace(/([一-鿿（），。、])\s+(?=[一-鿿（），。、])/g, '$1').trim();
      // 支付方式里的账户名附在备注后面（多账户时可据此自动分账户）
      if (prevPay && prevPay.length >= 2 && !note.includes(prevPay)) note = (note + ' ' + prevPay).trim();
      note = note.slice(0, 40) || '截图导入';
      const type = amt.sign === '+' ? 'income'
        : amt.sign === '-' ? 'expense'
        : (INCOME_KW.test(note) || INCOME_KW.test(raw)) ? 'income'
        : receiveCtx ? 'income' : 'expense';
      items.push({ date: curDate, type, amount: amt.amount, note });
      prevText = ''; prevPay = '';
    }
    // 同一张图里偶发的重复行去重
    const seen = new Set();
    const out = items.filter(it => { const k = `${it.date}|${it.amount}|${it.note}`; if (seen.has(k)) return false; seen.add(k); return true; });
    if (!out.length) throw new Error('没从截图里认出交易。截图要包含金额（如 -25.00）；也可以到「个人中心→常规」接入 AI 模型，识别会准很多。');
    return out;
  }

  return { recognize, parseBillText, canNative };
})();
