/* ===== AI 模型接入（可选） =====
   用户在「账户中心 → 设置 → AI 模型」填自己的 OpenAI 兼容接口（DeepSeek / 通义 / 智谱 / Kimi /
   OpenAI 等都提供这种接口）。不填就完全不联网；填了也只把数据发给用户自己指定的服务商，
   没有任何中间服务器。主要用途：截图记账（把账单/支付截图直接变成记账条目）。 */
'use strict';

const AI = (() => {

  const cfg = () => (Store.getSettings().ai || {});
  const ready = () => { const c = cfg(); return !!(c.url && c.key && c.model); };

  /* Electron 桌面版经主进程转发（Node 侧没有跨域限制，最稳）；
     网页/安卓直接 fetch —— 主流 AI 服务商的接口都允许浏览器跨域调用。 */
  async function post(url, headers, bodyStr, timeoutMs) {
    if (window.jzNative && window.jzNative.aiFetch) {
      const r = await window.jzNative.aiFetch({ url, headers, body: bodyStr, timeoutMs });
      if (r.error) throw new Error(r.error);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, text: r.body };
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: 'POST', headers, body: bodyStr, signal: ctrl.signal });
      return { ok: res.ok, status: res.status, text: await res.text() };
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('请求超时（' + Math.round(timeoutMs / 1000) + ' 秒没响应）');
      throw new Error('网络请求失败：' + e.message + '\n若一直失败，可能是该服务商不允许网页直连，换一家（如 DeepSeek / 智谱）通常可以。');
    } finally { clearTimeout(t); }
  }

  /* 调一次对话接口，返回模型输出的文本 */
  async function chat(messages, { timeout = 90000, maxTokens = 2000 } = {}) {
    const c = cfg();
    if (!ready()) throw new Error('还没配置 AI 模型。请到「账户中心 → 设置 → AI 模型」填接口地址、密钥和模型名。');
    let base = String(c.url || '').trim().replace(/\/+$/, '');
    // 用户可能填的是根地址、/v1、或完整 /chat/completions —— 都兜住
    let url;
    if (/\/chat\/completions$/.test(base)) url = base;
    else if (/\/v\d+$/.test(base)) url = base + '/chat/completions';
    else url = base + '/v1/chat/completions';
    const r = await post(url, {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + c.key,
    }, JSON.stringify({ model: c.model, messages, temperature: 0.1, max_tokens: maxTokens }), timeout);
    if (!r.ok) {
      let msg = r.text || '';
      try { const j = JSON.parse(msg); msg = (j.error && (j.error.message || j.error.msg)) || msg; } catch (e) { /* 原文即可 */ }
      if (r.status === 401) throw new Error('密钥不对（401）。检查 API Key 是否复制完整。');
      if (r.status === 404) throw new Error('接口地址或模型名不对（404）：' + msg.slice(0, 160));
      throw new Error('AI 接口返回 ' + r.status + '：' + String(msg).slice(0, 200));
    }
    const data = JSON.parse(r.text);
    const out = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!out) throw new Error('AI 返回了空内容');
    return out;
  }

  /* 从模型回复里抠出 JSON 数组（模型有时会包一层 ``` 或说几句话） */
  function extractJson(s) {
    const m = String(s).match(/\[[\s\S]*\]/);
    if (!m) throw new Error('AI 没返回可解析的清单，它说：' + String(s).slice(0, 150));
    return JSON.parse(m[0]);
  }

  /* 规整一条 AI 给的记账条目；非法的返回 null */
  function normalizeItem(x, today) {
    if (!x || typeof x !== 'object') return null;
    const amount = Math.round(Math.abs(parseFloat(x.amount)) * 100) / 100;
    if (!amount || !isFinite(amount)) return null;
    const type = /income|收/.test(String(x.type || '')) ? 'income' : 'expense';
    let date = String(x.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = today;
    const note = String(x.note || x.desc || '').trim().slice(0, 60);
    const category = String(x.category || '').trim().slice(0, 20);
    return { date, type, amount, note, category };
  }

  /* 截图 → 记账条目列表。dataUrl 是压缩后的 jpeg data: 地址 */
  async function parseImage(dataUrl, today) {
    // 把用户现有的分类名喂给模型，让它直接归好类
    const expNames = Store.getCategories('expense').map(c => c.name).join('、');
    const incNames = Store.getCategories('income').map(c => c.name).join('、');
    const prompt = `这是一张账单/支付记录/消费清单的截图。请把里面每一笔交易提取出来，只输出一个 JSON 数组，不要任何其他文字。
每个元素格式：{"date":"YYYY-MM-DD","type":"expense或income","amount":数字,"note":"备注","category":"分类名"}
规则：
1. 支出用 expense；收入/退款/收款到账用 income。如果这是商家收款账单（出现"收款"字样），交易都是 income。
2. note 以【商家名或用途】为主（如"蜜雪冰城"），若截图能看出支付方式（某银行/微信/支付宝），把它附在后面（如"蜜雪冰城 建设银行"）——不要只写支付方式。
3. category 必须从下面列表里选最贴切的一个（比如奶茶店选"奶茶咖啡"，快餐小吃选"日常餐食"）；实在判断不了就填 ""：
   支出分类：${expNames}
   收入分类：${incNames}
4. 金额取正数；截图里没写日期就用 "${today}"；看不清或不是交易的行跳过；一笔都没有就输出 []。`;
    const out = await chat([{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }], { timeout: 120000, maxTokens: 3000 });
    const arr = extractJson(out);
    const items = arr.map(x => normalizeItem(x, today)).filter(Boolean);
    if (!items.length) throw new Error('截图里没识别出交易记录。换一张更清晰、包含金额的截图试试。');
    return items;
  }

  /* 测试连接：让模型回两个字母，验证地址/密钥/模型名都通 */
  async function testConn() {
    const out = await chat([{ role: 'user', content: '只回复 OK 两个字母' }], { timeout: 30000, maxTokens: 10 });
    return String(out).slice(0, 40);
  }

  /* 把图片文件压到适合上传的大小（长边 maxW，jpeg），返回 dataUrl */
  function fileToDataUrl(file, maxW = 1400) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxW / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败，换一张试试')); };
      img.src = url;
    });
  }

  return { ready, chat, parseImage, testConn, fileToDataUrl, extractJson, normalizeItem };
})();
