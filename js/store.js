/* ===== 数据层：localStorage 存取、默认分类、聚合计算 ===== */
'use strict';

const Store = (() => {
  const K_ENTRIES = 'jz.entries.v1';
  const K_CATS = 'jz.categories.v1';
  const K_SETTINGS = 'jz.settings.v1';
  const K_ACCOUNTS = 'jz.accounts.v1';
  const K_LEDGERS = 'jz.ledgers.v1';

  /* ---------- 账户（资金账户，用来管余额、形成闭环）----------
     每笔收支可绑定一个账户：支出从该账户扣、收入进该账户。
     没绑定账户的记录，都算到「默认现金账户」名下（这样不折腾账户也能用）。
     账户余额 = 期初余额 + 进账 − 出账 + 转入 − 转出
     全部账户余额之和 = 积蓄（和「期初积蓄 + 收入 − 支出」一致，转账互相抵消）*/
  const ACCOUNT_KINDS = [
    { kind: 'cash',    name: '现金',     icon: '💵', color: '#67a97f' },
    { kind: 'bank',    name: '储蓄卡',   icon: '🏦', color: '#4f7fd9' },
    { kind: 'wechat',  name: '微信钱包', icon: '💚', color: '#3fae5a' },
    { kind: 'alipay',  name: '支付宝',   icon: '💙', color: '#3d8bfd' },
    { kind: 'savings', name: '存款理财', icon: '🐷', color: '#e08a52' },
    { kind: 'other',   name: '其他账户', icon: '📁', color: '#8fa3ad' },
  ];
  const DEFAULT_ACCOUNTS = [
    { id: 'cash', name: '现金', kind: 'cash', icon: '💵', color: '#67a97f', opening: 0, builtin: true },
  ];
  const DEFAULT_ACCT = 'cash';   // 没绑账户的记录归到它名下

  /* ---------- 账本（多本账，参照随手记）----------
     每笔记录属于一个账本；顶部可切换「全部账本」或某一本。
     没设账本的记录都算「默认账本」，所以不开账本也能一起管理。 */
  const DEFAULT_LEDGERS = [
    { id: 'default', name: '日常账本', icon: '📒', color: '#0b8f66', builtin: true },
  ];
  const DEFAULT_LEDGER = 'default';
  const LEDGER_ICONS = ['📒', '📓', '📔', '📕', '📗', '📘', '💼', '🏠', '✈️', '🚗', '🎮', '🍜', '💰', '👶', '🐱', '🎓', '🏥', '🛒', '❤️', '🌱'];

  /* debt 字段标记「往来款」，用于负债/债权核算：
     borrow=借入（钱进来但是欠的，负债+）  repay=还款（负债-）
     lend=借出（钱出去但别人欠你，债权+）  collect=收回借出（债权-） */

  /* ---------- 默认分类（通用款，人人适用；个性化分类请用「分类」页的批量添加） ---------- */
  const DEFAULT_CATEGORIES = [
    // ----- 支出 -----
    { id: 'meal',      type: 'expense', name: '日常餐食', icon: '🍚', color: '#e8843c', keywords: ['早餐','早饭','午餐','午饭','晚餐','晚饭','宵夜','夜宵','吃饭','吃面','面条','包子','快餐','米粉','馄饨','盒饭','外卖','食堂','汉堡','披萨','锅盔','麻辣烫','黄焖鸡','煲仔饭','饺子','炒饭','米线','螺蛳粉','肯德基','麦当劳','华莱士','塔斯汀','沙县','拉面','小吃'] },
    { id: 'dinner',    type: 'expense', name: '聚餐请客', icon: '🍻', color: '#d95f5f', keywords: ['聚餐','请客','烧烤','火锅','酒席','团建'] },
    { id: 'grocery',   type: 'expense', name: '超市买菜', icon: '🛒', color: '#67a97f', keywords: ['超市','买菜','菜市场','生鲜','买米','买水','买盐'] },
    { id: 'fruit',     type: 'expense', name: '水果', icon: '🍉', color: '#7cb342', keywords: ['水果','西瓜','苹果','葡萄','草莓','香蕉','橘子','橙子','梨','桃','榴莲'] },
    { id: 'snack',     type: 'expense', name: '零食', icon: '🍪', color: '#e6a23c', keywords: ['零食','蛋糕','甜点','面包','饼干','薯片','冰淇淋','巧克力','糖'] },
    { id: 'milktea',   type: 'expense', name: '奶茶咖啡', icon: '🧋', color: '#b3845c', keywords: ['奶茶','咖啡','饮料','果汁','可乐','茶','蜜雪冰城','瑞幸','星巴克','库迪','霸王茶姬','喜茶','古茗','沪上阿姨','茶百道','益禾堂'] },
    { id: 'rent',      type: 'expense', name: '房租水电', icon: '🏠', color: '#8a6fc8', keywords: ['房租','电费','水费','水电','燃气','物业','取暖'] },
    { id: 'phone',     type: 'expense', name: '话费网费', icon: '📶', color: '#5aa0c8', keywords: ['话费','流量','宽带','电话卡','网费'] },
    { id: 'commute',   type: 'expense', name: '日常通勤', icon: '🚇', color: '#58a55c', keywords: ['地铁','打车','公交','骑行','共享单车','滴滴','出租车','交通','电动车'] },
    { id: 'travel',    type: 'expense', name: '出行旅行', icon: '🚄', color: '#2f8f83', keywords: ['高铁','火车','机票','车票','船票','大巴','酒店','住宿','旅游','景区','门票'] },
    { id: 'car',       type: 'expense', name: '汽车支出', icon: '🚗', color: '#4f7fd9', keywords: ['加油','停车','高速','洗车','修车','保养','违章','过路费','车险','充电桩'] },
    { id: 'daily',     type: 'expense', name: '日用百货', icon: '🧺', color: '#8fa3ad', keywords: ['纸巾','洗衣液','垃圾袋','牙膏','洗发水','沐浴露','日用品','收纳','雨伞','衣架','插座','灯泡'] },
    { id: 'shopping',  type: 'expense', name: '网购快递', icon: '📦', color: '#a0785c', keywords: ['淘宝','京东','拼多多','网购','快递','运费','购物'] },
    { id: 'clothes',   type: 'expense', name: '服饰鞋包', icon: '👕', color: '#c874a6', keywords: ['衣服','裤子','裙子','鞋','外套','内衣','袜子','帽子','包'] },
    { id: 'beauty',    type: 'expense', name: '美容理发', icon: '💇', color: '#dd8ab8', keywords: ['理发','剪头发','剪发','美容','化妆品','护肤','美甲'] },
    { id: 'medical',   type: 'expense', name: '医疗健康', icon: '💊', color: '#3aa6a0', keywords: ['挂号','买药','药店','医院','看病','体检','牙','医保'] },
    { id: 'study',     type: 'expense', name: '学习教育', icon: '📚', color: '#5c7fb3', keywords: ['买书','课程','网课','培训','学费','文具','打印','会员'] },
    { id: 'fun',       type: 'expense', name: '休闲娱乐', icon: '🎮', color: '#d96fb0', keywords: ['电影','游戏','KTV','演出','桌游','健身','按摩','娱乐'] },
    { id: 'digital',   type: 'expense', name: '数码电器', icon: '📱', color: '#5d6d9e', keywords: ['手机','平板','电脑','耳机','充电器','数据线','键盘','鼠标','家电'] },
    { id: 'redpacket', type: 'expense', name: '发红包', icon: '🧧', color: '#e05252', keywords: ['发红包','红包','打赏'] },
    { id: 'social',    type: 'expense', name: '人情往来', icon: '🎁', color: '#c2574d', keywords: ['随礼','份子','礼金','礼物','生日','结婚','探望','伴手礼','人情'] },
    { id: 'family',    type: 'expense', name: '家庭支出', icon: '🏡', color: '#a67c52', keywords: ['家用','家庭','孝敬','赡养'] },
    { id: 'invest_out',type: 'expense', name: '投资支出', icon: '📈', color: '#4a8f8f', keywords: ['买入','基金','定投','理财'] },
    { id: 'repay',     type: 'expense', name: '还款', icon: '💳', color: '#9b6b6b', debt: 'repay', keywords: ['还款','还花呗','还信用卡','还呗','还钱','还贷','还 '] },
    // 「借给」才是借出给别人；单独一个「借 N」在日常记法里通常指自己借入，归到「借入款项」
    { id: 'lend',      type: 'expense', name: '借出', icon: '🤝', color: '#6b8f9b', debt: 'lend', keywords: ['借给','借出'] },
    { id: 'other',     type: 'expense', name: '其他支出', icon: '🗂️', color: '#9aa5a0', keywords: [] },
    // ----- 收入 -----
    { id: 'salary',    type: 'income', name: '工资薪水', icon: '💰', color: '#2e8bd8', keywords: ['工资','薪资','薪水','发工资','发薪','月薪','提成','佣金','加班费','年终奖','奖金'] },
    { id: 'side_in',   type: 'income', name: '副业收入', icon: '🪙', color: '#38a1a8', keywords: ['副业','兼职','稿费','接单','外快','跑腿','代驾'] },
    { id: 'invest_in', type: 'income', name: '投资收益', icon: '📊', color: '#7a68c8', keywords: ['收益','分红','利息','股息','基金卖','股票卖','卖出'] },
    { id: 'redpk_in',  type: 'income', name: '红包收入', icon: '🧧', color: '#e08a52', keywords: ['红包入','红包进','红包收','好评','中奖'] },
    { id: 'reimburse', type: 'income', name: '报销退款', icon: '↩️', color: '#52a0e0', keywords: ['报销','退款','返现','退回','退押金','退货','退税'] },
    { id: 'borrow',    type: 'income', name: '借入款项', icon: '🏦', color: '#c88a4a', debt: 'borrow', keywords: ['借入','借款','借来','贷款','分付','花呗','借 '] },
    { id: 'collect',   type: 'income', name: '收回借出', icon: '🔙', color: '#7a9b6b', debt: 'collect', keywords: ['收回','还我','归还','要回'] },
    { id: 'other_in',  type: 'income', name: '其他收入', icon: '💵', color: '#68a8c8', keywords: ['入账','进账','转进','收到','收款','到账','补贴','津贴','公积金','卖了'] },
  ];

  /* ---------- 主题 ---------- */
  const THEMES = [
    { id: 'green',  name: '清新绿', c1: '#0aa87a', c2: '#0b8f66', c3: '#0a7d63' },
    { id: 'blue',   name: '深海蓝', c1: '#3d8bfd', c2: '#2563d9', c3: '#1e4fb0' },
    { id: 'purple', name: '暮光紫', c1: '#9b6ede', c2: '#7c4fc4', c3: '#653da8' },
    { id: 'orange', name: '暖阳橙', c1: '#fb923c', c2: '#ea7317', c3: '#c25c0c' },
    { id: 'rose',   name: '樱花粉', c1: '#f472a6', c2: '#e0508a', c3: '#bd3a6f' },
    { id: 'dark',   name: '暗夜黑', c1: '#3f4d57', c2: '#2b363e', c3: '#1d252b', dark: true },
  ];

  const DEFAULT_SETTINGS = {
    theme: 'green',
    // 开始记账之前就已经欠着的钱（花呗/分付/信用卡已用额度等）。
    // 没有它，早期只记了「还款」没记「借入」的账会算出负数余额。
    openingDebt: 0,
    openingCredit: 0,
    // 开始记账之前手头已有的积蓄（存款+余额宝+现金等）。
    // 当前积蓄 = 期初积蓄 + 累计收入 − 累计支出
    openingBalance: 0,
    openingDate: '',   // 期初的基准日；留空表示「第一笔记录之前」
    activeLedger: 'all',   // 当前账本：'all'=全部一起，或某个账本 id
    lastAcct: '',          // 记账时上次用的账户，方便下次默认选中
    profile: { name: '', phone: '', email: '' },   // 本地个人资料（不是真登录，只作标识）
    totalBudget: 0,        // 每月总预算，0=不设
    budgets: {},           // 分类月预算 {catId: 金额}
    savingsGoals: [],      // 存钱计划 [{id,name,target,base,startDate,note}]
    monthlyGoal: 0,        // 每月储蓄目标（收入−支出 要达到多少），0=不设
    license: { code: '', activatedAt: 0 },   // 授权码（电脑/安卓需要）
    // AI 模型接入（可选）：填自己的 OpenAI 兼容接口，用于截图记账等智能功能。
    // 不填就完全不联网；填了也只把数据发给你自己指定的服务商。
    ai: { url: '', key: '', model: '' },
    backup: {
      enabled: false, onExit: true, times: ['08:00', '20:00'], keep: 14,
      lastRun: {}, dirName: '',
      lastOkAt: 0,      // 上次备份成功的时间戳
      remindDays: 3,    // 写不了文件的环境（如 iPhone Safari）里，几天没备份就提醒；0=不提醒
    },
  };

  /* ---------- 读写 ---------- */
  function loadJSON(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function saveJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  let entries = loadJSON(K_ENTRIES, []);          // {id,date,'YYYY-MM-DD',type,amount,note,catId,manual}
  let categories = loadJSON(K_CATS, null);
  if (!categories) { categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)); saveJSON(K_CATS, categories); }
  let settings = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), loadJSON(K_SETTINGS, {}));
  settings.backup = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SETTINGS.backup)), settings.backup || {});
  settings.ai = Object.assign({ url: '', key: '', model: '' }, settings.ai || {});

  let accounts = loadJSON(K_ACCOUNTS, null);
  let ledgers = loadJSON(K_LEDGERS, null);
  {
    let migrated = false;
    if (!accounts || !accounts.length) {
      // 首次：建默认现金账户，把老的「期初积蓄」搬进它的期初余额
      accounts = JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS));
      accounts[0].opening = settings.openingBalance || 0;
      migrated = true;
    }
    if (!ledgers || !ledgers.length) {
      ledgers = JSON.parse(JSON.stringify(DEFAULT_LEDGERS));
      migrated = true;
    }
    if (migrated) { saveJSON(K_ACCOUNTS, accounts); saveJSON(K_LEDGERS, ledgers); }
  }

  // 迁移：老数据里的分类补上图标、往来款标记；补上新增的借入/收回分类
  {
    let dirty = false;
    for (const c of categories) {
      const d = DEFAULT_CATEGORIES.find(x => x.id === c.id);
      if (!c.icon) { c.icon = d ? d.icon : '🏷️'; dirty = true; }
      if (c.debt === undefined && d && d.debt) { c.debt = d.debt; dirty = true; }
    }
    for (const id of ['borrow', 'collect']) {
      if (!categories.some(c => c.id === id)) {
        categories.push(JSON.parse(JSON.stringify(DEFAULT_CATEGORIES.find(x => x.id === id))));
        dirty = true;
      }
    }
    // 修正早期版本把「借 N」当成借出的问题：那种写法通常是自己借入
    const lend = categories.find(c => c.id === 'lend');
    if (lend && (lend.keywords || []).includes('借 ')) {
      lend.keywords = lend.keywords.filter(k => k !== '借 ');
      const bor = categories.find(c => c.id === 'borrow');
      if (bor && !bor.keywords.includes('借 ')) bor.keywords.push('借 ');
      dirty = true;
    }
    /* 给老用户的内置收入分类补上新增关键词（幂等 merge）。
       起因：「薪资 8508.3」被判成支出——词表里只有「工资/薪水」没有「薪资/发薪/提成」这些常见说法。
       只补内置 id 的分类、只加不删，不影响用户自己删改过的其他关键词。 */
    const KW_SUPPLEMENT = {
      salary: ['薪资', '发薪', '月薪', '提成', '佣金', '加班费'],
      side_in: ['跑腿', '代驾'],
      invest_in: ['股息', '卖出'],
      redpk_in: ['中奖'],
      reimburse: ['退税'],
      other_in: ['收款', '到账', '补贴', '津贴', '公积金', '卖了'],
      milktea: ['蜜雪冰城', '瑞幸', '星巴克', '库迪', '霸王茶姬', '喜茶', '古茗', '沪上阿姨', '茶百道', '益禾堂'],
      meal: ['锅盔', '麻辣烫', '黄焖鸡', '煲仔饭', '饺子', '炒饭', '米线', '螺蛳粉', '肯德基', '麦当劳', '华莱士', '塔斯汀', '沙县', '拉面', '小吃'],
    };
    for (const [cid, kws] of Object.entries(KW_SUPPLEMENT)) {
      const c = categories.find(x => x.id === cid);
      if (!c) continue;
      if (!Array.isArray(c.keywords)) c.keywords = [];
      for (const kw of kws) if (!c.keywords.includes(kw)) { c.keywords.push(kw); dirty = true; }
    }
    if (dirty) saveJSON(K_CATS, categories);
  }

  let idSeq = Date.now() % 1e9;
  const newId = () => 'e' + (idSeq++).toString(36) + Math.floor(Math.random() * 1e4).toString(36);

  /* 自上次备份以来有没有改动过账目/分类，供「退出时自动备份」判断 */
  let dirty = false;
  const isDirty = () => dirty;
  const markClean = () => { dirty = false; };

  /* 数据版本号：任何会改变 entries / 账本归属的操作都要 +1，
     用来让下面的缓存失效。缓存是为了干掉 O(n²) 扫描（见 scoped / inMonth）。 */
  let dataVer = 0;
  const bumpVer = () => { dataVer++; };
  const persistEntries = () => { dirty = true; bumpVer(); saveJSON(K_ENTRIES, entries); };
  let catVer = 0;
  const persistCats = () => { dirty = true; catVer++; saveJSON(K_CATS, categories); };
  const persistAccounts = () => { dirty = true; saveJSON(K_ACCOUNTS, accounts); };
  const persistLedgers = () => { dirty = true; saveJSON(K_LEDGERS, ledgers); };

  /* ---------- 账本 ----------
     当前账本作为一个过滤器：影响记账和数据分析；账户余额、净资产始终是全局的。 */
  const getLedgers = () => ledgers;
  const getLedger = (id) => ledgers.find(l => l.id === id) || null;
  const activeLedger = () => settings.activeLedger || 'all';
  function setActiveLedger(id) { settings.activeLedger = id || 'all'; bumpVer(); saveJSON(K_SETTINGS, settings); }
  /* 新记录默认落到哪个账本：选了具体账本就用它，「全部」时落到默认账本 */
  const ledgerForNew = () => { const a = activeLedger(); return a === 'all' ? DEFAULT_LEDGER : a; };
  const ledgerOf = (e) => e.ledgerId || DEFAULT_LEDGER;
  function addLedger(name, extra) {
    const id = 'l' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const lg = Object.assign({ id, name, icon: '📒', color: randColor() }, extra || {});
    ledgers.push(lg); persistLedgers(); return lg;
  }
  function updateLedger(id, patch) { const l = getLedger(id); if (l) { Object.assign(l, patch); persistLedgers(); } }
  function removeLedger(id, moveTo) {
    if (id === DEFAULT_LEDGER) return;            // 默认账本不可删
    const target = moveTo || DEFAULT_LEDGER;
    entries.forEach(e => { if (ledgerOf(e) === id) e.ledgerId = target; });
    ledgers = ledgers.filter(l => l.id !== id);
    if (settings.activeLedger === id) setActiveLedger('all');
    persistLedgers(); persistEntries();
  }

  /* 受当前账本过滤后的记录（记账、数据分析都走它）。转账不参与收支统计。 */
  /* 当前账本下的条目。
     以前每次调用都 filter 一遍全表，而 inMonth() 又对每个月各调一次，
     catStat 一次渲染能叠出上千万次操作（年视图卡 30ms）。这里按 数据版本+账本 缓存。 */
  let _scopedCache = null;   // {ver, ledger, arr}
  function scoped() {
    const a = activeLedger();
    if (_scopedCache && _scopedCache.ver === dataVer && _scopedCache.ledger === a) return _scopedCache.arr;
    const arr = a === 'all' ? entries : entries.filter(e => ledgerOf(e) === a);
    _scopedCache = { ver: dataVer, ledger: a, arr };
    return arr;
  }
  /* 月份 → 条目 的索引，把 inMonth() 从「全表扫描」降成一次 Map 查表 */
  let _monthIdx = null;      // {ver, ledger, map}
  function monthIndex() {
    const a = activeLedger();
    if (_monthIdx && _monthIdx.ver === dataVer && _monthIdx.ledger === a) return _monthIdx.map;
    const map = new Map();
    for (const e of scoped()) {
      const ym = e.date.slice(0, 7);
      let arr = map.get(ym);
      if (!arr) { arr = []; map.set(ym, arr); }
      arr.push(e);
    }
    _monthIdx = { ver: dataVer, ledger: a, map };
    return map;
  }

  /* ---------- 分类 ---------- */
  const getCategories = (type) => type ? categories.filter(c => c.type === type) : categories;
  /* 用 Map 查分类，而不是每次 categories.find()。
     debtKindOf() 会对每一条记录调一次 getCat，全表扫描时就是
     O(条目×分类)（3860×26≈10万次），是所有统计页共同的隐藏开销。 */
  let _catIdx = null;   // {ver, map}
  function catIndex() {
    if (_catIdx && _catIdx.ver === catVer) return _catIdx.map;
    const map = new Map(categories.map(c => [c.id, c]));
    _catIdx = { ver: catVer, map };
    return map;
  }
  const getCat = (id) => catIndex().get(id) || null;

  function addCategory(type, name, extra) {
    const id = 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const cat = Object.assign({ id, type, name, icon: '🏷️', color: randColor(), keywords: [] }, extra || {});
    categories.push(cat); persistCats(); return cat;
  }

  /* 批量添加：每行一个，支持「名称:关键词1,关键词2」和行首 emoji 图标
     例：  🐱 宠物: 猫粮, 猫砂, 宠物医院
           孩子教育
     返回 {added, skipped}（同类型同名的跳过） */
  function addCategories(type, text) {
    const existing = new Set(categories.filter(c => c.type === type).map(c => c.name));
    let added = 0, skipped = 0;
    const out = [];
    for (const raw of String(text).split(/[\n\r]+/)) {
      const line = raw.trim();
      if (!line) continue;
      const [namePart, kwPart] = line.split(/[:：]/);
      let name = (namePart || '').trim();
      if (!name) continue;
      // 行首若是 emoji 就当图标
      let icon = '🏷️';
      const m = /^(\p{Extended_Pictographic}(?:️)?(?:‍\p{Extended_Pictographic}(?:️)?)*)\s*(.+)$/u.exec(name);
      if (m) { icon = m[1]; name = m[2].trim(); }
      if (!name) continue;
      if (existing.has(name)) { skipped++; continue; }
      const keywords = (kwPart || '').split(/[，,、]/).map(s => s.trim()).filter(Boolean);
      out.push(addCategory(type, name, { icon, keywords }));
      existing.add(name); added++;
    }
    return { added, skipped, cats: out };
  }
  function updateCategory(id, patch) {
    const c = getCat(id); if (!c) return;
    Object.assign(c, patch); persistCats();
  }
  function removeCategory(id) {
    categories = categories.filter(c => c.id !== id);
    entries.forEach(e => { if (e.catId === id) { e.catId = null; e.manual = false; } });
    persistCats(); persistEntries();
  }
  function randColor() {
    const h = Math.floor(Math.random() * 360);
    return `hsl(${h},48%,55%)`;
  }

  /* 关键词自动归类：返回分类 id 或 null */
  function categorize(note, type) {
    const cats = getCategories(type);
    let best = null, bestLen = 0;
    for (const c of cats) {
      for (const kw of (c.keywords || [])) {
        if (kw && note.includes(kw) && kw.length > bestLen) { best = c.id; bestLen = kw.length; }
      }
    }
    return best;
  }

  /* ---------- 记录 ---------- */
  function shape(e) {
    return {
      id: newId(),
      date: e.date,
      type: e.type,                       // 'expense' | 'income'
      amount: Math.round(e.amount * 100) / 100,
      note: (e.note || '').trim(),
      catId: e.catId !== undefined ? e.catId : categorize(e.note || '', e.type),
      acctId: e.acctId || null,           // 绑定的资金账户；null=默认现金账户
      ledgerId: e.ledgerId || ledgerForNew(),
      manual: !!e.manual,
      // 多账户自动分账时「没认出账户」的标记：余额暂由现金吸收，UI 标红提醒手动指定
      ...(e.unassigned ? { unassigned: true } : {}),
    };
  }
  function addEntry(e) {
    const entry = shape(e);
    entries.push(entry); persistEntries(); return entry;
  }
  function addEntries(list) {
    const added = list.map(shape);
    entries.push(...added); persistEntries(); return added;
  }
  function updateEntry(id, patch) {
    const e = entries.find(x => x.id === id); if (!e) return;
    Object.assign(e, patch); persistEntries();
  }
  function removeEntry(id) { entries = entries.filter(x => x.id !== id); persistEntries(); }

  /* 对未归类（或全部非手动）条目重新自动归类，返回归类成功条数 */
  function recategorize(onlyUnknown) {
    let n = 0;
    for (const e of entries) {
      if (e.manual) continue;
      if (onlyUnknown && e.catId) continue;
      const cid = categorize(e.note, e.type);
      if (cid && cid !== e.catId) { e.catId = cid; n++; }
      else if (!onlyUnknown && !cid && e.catId) { e.catId = null; }
    }
    persistEntries(); return n;
  }

  /* ---------- 查询与聚合 ----------
     下面这些走当前账本过滤；账户余额/净资产另有专门函数，始终全局。 */
  const getEntries = () => entries;                 // 全部记录（导出、账户余额用）
  /* 按日期排好序的当前账本条目（缓存）。配合下面的二分查找，
     把 inRange/byDate/inYear 从「全表扫描」降到 O(log n)。
     统计页一次渲染要按天查三十几次，2 万条时全表扫描就是 60 万次操作。
     JS 的 sort 是稳定排序，所以同一天内仍保持原有录入顺序。 */
  /* 全部条目（不分账本）按日期排序，缓存复用。
     负债前缀和、月末资产走势都要用；否则它们各自 sort 一次 2 万条。 */
  let _sortedAll = null;     // {ver, arr}
  function sortedAllByDate() {
    if (_sortedAll && _sortedAll.ver === dataVer) return _sortedAll.arr;
    const arr = entries.slice().sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    _sortedAll = { ver: dataVer, arr };
    return arr;
  }
  let _sortedCache = null;   // {ver, ledger, arr}
  function sortedByDate() {
    const a = activeLedger();
    if (_sortedCache && _sortedCache.ver === dataVer && _sortedCache.ledger === a) return _sortedCache.arr;
    const arr = scoped().slice().sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    _sortedCache = { ver: dataVer, ledger: a, arr };
    return arr;
  }
  const lowerBound = (arr, d) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].date < d) lo = m + 1; else hi = m; } return lo; };
  const upperBound = (arr, d) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].date <= d) lo = m + 1; else hi = m; } return lo; };
  const inRange = (d1, d2) => { const a = sortedByDate(); return a.slice(lowerBound(a, d1), upperBound(a, d2)); };
  const byDate = (d) => inRange(d, d);
  const inMonth = (ym) => monthIndex().get(ym) || [];                    // 'YYYY-MM'
  const inYear = (y) => inRange(y + '-01-01', y + '-12-31');

  /* 该笔记录属于哪种往来款（借入/还款/借出/收回），普通消费返回 null */
  function debtKindOf(e) {
    const c = e.catId ? getCat(e.catId) : null;
    return c && c.debt ? c.debt : null;
  }

  function totals(list) {
    let ex = 0, inc = 0, exReal = 0, incReal = 0;
    for (const e of list) {
      if (e.type === 'transfer') continue;   // 转账只是账户间挪钱，不算收支
      const isDebt = !!debtKindOf(e);
      if (e.type === 'expense') { ex += e.amount; if (!isDebt) exReal += e.amount; }
      else if (e.type === 'income') { inc += e.amount; if (!isDebt) incReal += e.amount; }
    }
    return {
      expense: r2(ex), income: r2(inc), balance: r2(inc - ex),
      // 剔除借入/还款/借出/收回等往来款后的「真实」收支与结余
      expenseReal: r2(exReal), incomeReal: r2(incReal), balanceReal: r2(incReal - exReal),
    };
  }

  /* 往来款合计：负债变动 = 借入 - 还款；债权变动 = 借出 - 收回 */
  function debtTotals(list) {
    let borrow = 0, repay = 0, lend = 0, collect = 0;
    for (const e of list) {
      switch (debtKindOf(e)) {
        case 'borrow': borrow += e.amount; break;
        case 'repay': repay += e.amount; break;
        case 'lend': lend += e.amount; break;
        case 'collect': collect += e.amount; break;
      }
    }
    return {
      borrow: r2(borrow), repay: r2(repay), lend: r2(lend), collect: r2(collect),
      debtChange: r2(borrow - repay), creditChange: r2(lend - collect),
    };
  }
  /* 截至某日（含）的负债余额与债权余额（含期初） */
  /* 负债/债权的「累计前缀和」。
     balanceAsOf 以前每次都 entries.filter 全表（统计页一次要调三十几次），
     这里改成：按日期排序一次 + 前缀和，之后每次查询只要一次二分。
     期初值不进前缀（读的时候再加），所以改期初负债不需要重建。
     依赖 debtKindOf → 分类改了也要重建，故版本键同时含 catVer。 */
  let _debtPrefix = null;
  function debtPrefix() {
    const key = dataVer + ':' + catVer;
    if (_debtPrefix && _debtPrefix.key === key) return _debtPrefix;
    const arr = sortedAllByDate();
    const dates = new Array(arr.length);
    const dch = new Array(arr.length + 1);
    const cch = new Array(arr.length + 1);
    dch[0] = 0; cch[0] = 0;
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i]; dates[i] = e.date;
      let d = 0, c = 0;
      switch (debtKindOf(e)) {
        case 'borrow': d = e.amount; break;
        case 'repay': d = -e.amount; break;
        case 'lend': c = e.amount; break;
        case 'collect': c = -e.amount; break;
      }
      dch[i + 1] = dch[i] + d; cch[i + 1] = cch[i] + c;
    }
    _debtPrefix = { key, dates, dch, cch };
    return _debtPrefix;
  }
  function balanceAsOf(dateStr) {
    const p = debtPrefix();
    let lo = 0, hi = p.dates.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (p.dates[m] <= dateStr) lo = m + 1; else hi = m; }
    return {
      debt: r2((settings.openingDebt || 0) + p.dch[lo]),
      credit: r2((settings.openingCredit || 0) + p.cch[lo]),
    };
  }
  /* 截至某日（含）的资产快照：积蓄、负债、债权、净资产
     积蓄 = 期初积蓄 + 累计收入 − 累计支出（借入的钱进了口袋，所以算进积蓄；还款花出去，也从积蓄里扣）
     净资产 = 积蓄 + 别人欠我 − 我欠别人 */
  function assetsAsOf(dateStr) {
    const list = entries.filter(e => e.date <= dateStr);   // 全局，不受账本影响
    const t = totals(list);
    const b = balanceAsOf(dateStr);
    // 期初积蓄 = 各账户期初余额之和（迁移后账户是唯一来源）
    const openBase = accounts.reduce((s, a) => s + (a.opening || 0), 0);
    const savings = r2(openBase + t.income - t.expense);
    // 负的负债（还款比借入多，多为早期花呗还款没记借入）不应抬高净资产，夹到 0
    const debtForNet = Math.max(b.debt, 0);
    const creditForNet = Math.max(b.credit, 0);
    return {
      savings, debt: b.debt, credit: b.credit,
      net: r2(savings + creditForNet - debtForNet),
    };
  }

  /* ---------- 账户 ----------
     账户余额、总额始终基于「全部记录」，与当前账本无关（钱是一个池子）。 */
  const getAccountKinds = () => ACCOUNT_KINDS;
  const getAccounts = () => accounts;
  const getAccount = (id) => accounts.find(a => a.id === id) || null;
  function addAccount(name, kind, opening, extra) {
    const k = ACCOUNT_KINDS.find(x => x.kind === kind) || ACCOUNT_KINDS[0];
    const id = 'a' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const acc = Object.assign({ id, name, kind: k.kind, icon: k.icon, color: k.color, opening: r2(opening || 0) }, extra || {});
    accounts.push(acc); persistAccounts(); return acc;
  }
  function updateAccount(id, patch) {
    const a = getAccount(id); if (!a) return;
    if (patch.opening !== undefined) patch.opening = r2(patch.opening);
    Object.assign(a, patch); persistAccounts();
  }
  /* 把某账户余额校准成「实际余额」。
     做法：算出差额，补进该账户的「期初基准」——不生成假的收支记录、不污染真实收支统计，
     账户余额/积蓄/净资产会自动对上。每次校准都留一条日志，可追溯改了哪天、从多少改到多少。
     用于：记账初期期初填得不准、或后续漏记导致余额和实际对不上。 */
  function calibrateAccount(id, actual, dateStr) {
    const a = getAccount(id); if (!a) return null;
    const cur = accountBalance(id);
    const diff = r2(Number(actual) - cur);
    if (!diff) return { diff: 0, from: cur, to: cur };
    a.opening = r2((a.opening || 0) + diff);
    persistAccounts();
    if (!Array.isArray(settings.balanceAdjustLog)) settings.balanceAdjustLog = [];
    settings.balanceAdjustLog.unshift({ date: dateStr || '', acctId: id, name: a.name, from: cur, to: r2(Number(actual)), diff });
    saveJSON(K_SETTINGS, settings);
    return { diff, from: cur, to: r2(Number(actual)) };
  }
  const getAdjustLog = () => settings.balanceAdjustLog || [];

  /* 按备注匹配账户：备注里出现了哪个账户的名字，就归到哪个账户。
     只在多账户时有意义；名字长的优先（避免「工行」抢了「工行信用卡」的匹配）。
     没匹配到返回 null（表现为「未分账」，暂由默认现金吸收，UI 上标红提醒手动调）。 */
  function matchAccount(note) {
    if (accounts.length <= 1) return null;
    const s = String(note || '');
    if (!s) return null;
    const sorted = accounts.slice().sort((a, b) => (b.name || '').length - (a.name || '').length);
    for (const a of sorted) {
      if (a.name && a.name.length >= 2 && s.includes(a.name)) return a.id;
    }
    return null;
  }
  function removeAccount(id, moveTo) {
    if (id === DEFAULT_ACCT) return;              // 默认现金账户不可删
    entries.forEach(e => {
      if (e.type === 'transfer') {
        /* 转账必须两端都指向真实账户。
           以前这里置成 null，导致「转出方扣了钱、没人收钱」——钱凭空蒸发。
           改指默认现金：两端都成现金时自然抵消为 0，账才平。 */
        if (e.acctId === id) e.acctId = moveTo || DEFAULT_ACCT;
        if (e.toAcctId === id) e.toAcctId = moveTo || DEFAULT_ACCT;
      } else {
        // 普通收支：置空即可，默认现金账户会吸收所有没绑账户的记录
        if (e.acctId === id) e.acctId = moveTo || null;
      }
    });
    accounts = accounts.filter(a => a.id !== id);
    persistAccounts(); persistEntries();
  }
  /* 某账户余额（可选截至某日）。默认账户额外吸收所有没绑账户的记录。 */
  function accountBalance(id, asOf) {
    const acc = getAccount(id);
    if (!acc) return 0;
    let bal = acc.opening || 0;
    const isDefault = id === DEFAULT_ACCT;
    /* 转账的某一端指向了不存在的账户时（比如导入的老备份里账户已被删），
       让默认现金账户兜住这一端，否则那笔钱会没有任何账户认领 —— 凭空消失。
       注意：这个 Set 必须建在循环外。以前写成循环内 accounts.some()，
       变成 O(条目×账户)，12 个月的走势图要跑上百万次，年视图直接卡顿。 */
    const idSet = new Set(accounts.map(a => a.id));
    const orphan = (aid) => !aid || !idSet.has(aid);
    for (const e of entries) {
      if (asOf && e.date > asOf) continue;
      const belongs = e.acctId === id || (isDefault && !e.acctId);
      if (e.type === 'transfer') {
        if (e.acctId === id || (isDefault && orphan(e.acctId))) bal -= e.amount;      // 转出
        if (e.toAcctId === id || (isDefault && orphan(e.toAcctId))) bal += e.amount;  // 转入
      } else if (belongs) {
        if (e.type === 'expense') bal -= e.amount; else bal += e.amount;
      }
    }
    return r2(bal);
  }
  /* 所有账户余额快照 + 总额。
     一趟扫完算出全部账户，而不是「每个账户各扫一遍全表」——
     后者是 O(账户²×条目)，积蓄走势图要连算 12 个月，是年视图卡顿的主因。
     语义与 accountBalance 保持完全一致（含孤儿转账兜底）。 */
  function accountsSnapshot(asOf) {
    const idSet = new Set(accounts.map(a => a.id));
    const bal = new Map(accounts.map(a => [a.id, a.opening || 0]));
    const add = (aid, v) => { if (bal.has(aid)) bal.set(aid, bal.get(aid) + v); };
    for (const e of entries) {
      if (asOf && e.date > asOf) continue;
      if (e.type === 'transfer') {
        // 转出端：认得的账户各归各，认不得的（含空）由默认现金兜底
        add(idSet.has(e.acctId) ? e.acctId : DEFAULT_ACCT, -e.amount);
        add(idSet.has(e.toAcctId) ? e.toAcctId : DEFAULT_ACCT, e.amount);
      } else if (!e.acctId) {
        add(DEFAULT_ACCT, e.type === 'expense' ? -e.amount : e.amount);
      } else if (idSet.has(e.acctId)) {
        add(e.acctId, e.type === 'expense' ? -e.amount : e.amount);
      }
      // 普通收支绑了已删账户 → 无人认领（与 accountBalance 的 belongs 判断一致）
    }
    const rows = accounts.map(a => ({ ...a, balance: r2(bal.get(a.id)) }));
    const total = r2(rows.reduce((s, r) => s + r.balance, 0));
    return { rows, total };
  }
  /* 记一笔转账（账户间挪钱，不计收支）*/
  function addTransfer(t) {
    const entry = {
      id: newId(), date: t.date, type: 'transfer',
      amount: r2(t.amount), note: (t.note || '').trim(),
      acctId: t.acctId || DEFAULT_ACCT, toAcctId: t.toAcctId || DEFAULT_ACCT,
      catId: null, ledgerId: t.ledgerId || ledgerForNew(),
    };
    entries.push(entry); persistEntries(); return entry;
  }
  /* 某年 12 个月的积蓄走势（月末快照） */
  /* 12 个月末的资产快照。
     以前是逐月调 assetsAsOf()，每次都从头筛一遍全表（12×3 遍扫描），
     统计年视图一半的耗时都在这儿。改成按日期排序后**一趟累加**，
     走到每个月末就记一个快照。结果与 assetsAsOf 完全等价。 */
  function monthlySavingsSeries(year) {
    const ends = [];
    for (let m = 1; m <= 12; m++) {
      const last = new Date(+year, m, 0).getDate();
      ends.push(`${year}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`);
    }
    const openBase = accounts.reduce((s, a) => s + (a.opening || 0), 0);
    const sorted = sortedAllByDate();
    const res = [];
    let inc = 0, exp = 0, dch = 0, cch = 0, i = 0;
    for (const end of ends) {
      while (i < sorted.length && sorted[i].date <= end) {
        const e = sorted[i++];
        if (e.type === 'transfer') continue;      // 与 totals() 一致：转账不计收支
        if (e.type === 'expense') exp += e.amount; else if (e.type === 'income') inc += e.amount;
        switch (debtKindOf(e)) {                  // 与 debtTotals() 一致
          case 'borrow': dch += e.amount; break;
          case 'repay': dch -= e.amount; break;
          case 'lend': cch += e.amount; break;
          case 'collect': cch -= e.amount; break;
        }
      }
      const savings = r2(openBase + inc - exp);
      const debt = r2((settings.openingDebt || 0) + dch);
      const credit = r2((settings.openingCredit || 0) + cch);
      res.push({ savings, debt, credit, net: r2(savings + Math.max(credit, 0) - Math.max(debt, 0)) });
    }
    return res;
  }

  /* 某年 12 个月的负债数据：每月变动 + 月末累计余额 */
  function monthlyDebtSeries(year) {
    const res = [];
    for (let m = 1; m <= 12; m++) {
      const ym = year + '-' + String(m).padStart(2, '0');
      const t = debtTotals(inMonth(ym));
      const last = new Date(+year, m, 0).getDate();
      res.push({ ym, ...t, debtBalance: balanceAsOf(`${ym}-${String(last).padStart(2, '0')}`).debt });
    }
    return res;
  }
  /* 按分类合计：返回 [{catId, name, color, total, count, pct}] */
  function catTotals(list, type) {
    const map = new Map();
    let sum = 0;
    for (const e of list) {
      if (e.type !== type) continue;
      sum += e.amount;
      const k = e.catId || '__unknown__';
      const cur = map.get(k) || { total: 0, count: 0 };
      cur.total += e.amount; cur.count++; map.set(k, cur);
    }
    const rows = [];
    for (const [k, v] of map) {
      const c = k === '__unknown__' ? { name: '未知', color: '#b0b8b5', icon: '❓' } : (getCat(k) || { name: '已删分类', color: '#b0b8b5', icon: '🏷️' });
      rows.push({ catId: k, name: c.name, color: c.color, icon: c.icon || '🏷️', total: r2(v.total), count: v.count, pct: sum ? v.total / sum * 100 : 0 });
    }
    rows.sort((a, b) => b.total - a.total);
    return rows;
  }
  /* 某年 12 个月的月度合计 [{ym, expense, income}] */
  function monthlySeries(year) {
    const res = [];
    for (let m = 1; m <= 12; m++) {
      const ym = year + '-' + String(m).padStart(2, '0');
      res.push({ ym, ...totals(inMonth(ym)) });
    }
    return res;
  }
  /* 某年某分类 12 个月合计 */
  function monthlyCatSeries(year, catId, type) {
    const res = [];
    for (let m = 1; m <= 12; m++) {
      const ym = year + '-' + String(m).padStart(2, '0');
      let s = 0;
      for (const e of inMonth(ym)) {
        if (e.type !== type) continue;
        const k = e.catId || '__unknown__';
        if (k === catId) s += e.amount;
      }
      res.push(r2(s));
    }
    return res;
  }
  /* 某年 12 个月内、每个分类的合计：{catId: [12个月的值]} —— 供对比页「全部分类」矩阵用 */
  function yearCatMatrix(year, type) {
    const map = new Map();
    for (let m = 0; m < 12; m++) {
      const ym = year + '-' + String(m + 1).padStart(2, '0');
      for (const e of inMonth(ym)) {
        if (e.type !== type) continue;
        const k = e.catId || '__unknown__';
        if (!map.has(k)) map.set(k, new Array(12).fill(0));
        map.get(k)[m] += e.amount;
      }
    }
    for (const arr of map.values()) for (let i = 0; i < 12; i++) arr[i] = r2(arr[i]);
    return map;
  }
  /* 任意粒度序列：把 [d1,d2] 按 day/week/month 切段，返回 [{label,d1,d2}] */
  function buckets(d1, d2, grain) {
    const out = [];
    const toStr = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    if (grain === 'month') {
      let [y, m] = d1.split('-').map(Number);
      const [ey, em] = d2.split('-').map(Number);
      while (y < ey || (y === ey && m <= em)) {
        const ym = `${y}-${String(m).padStart(2, '0')}`;
        const last = new Date(y, m, 0).getDate();
        out.push({ label: m + '月', d1: ym + '-01', d2: `${ym}-${String(last).padStart(2, '0')}` });
        m++; if (m > 12) { m = 1; y++; }
      }
    } else if (grain === 'week') {
      let cur = new Date(d1 + 'T00:00:00');
      cur.setDate(cur.getDate() - ((cur.getDay() + 6) % 7));   // 回到周一
      let i = 1;
      while (toStr(cur) <= d2) {
        const end = new Date(cur); end.setDate(end.getDate() + 6);
        out.push({ label: '第' + i++ + '周', d1: toStr(cur), d2: toStr(end) });
        cur.setDate(cur.getDate() + 7);
      }
    } else {
      let cur = new Date(d1 + 'T00:00:00');
      const end = new Date(d2 + 'T00:00:00');
      while (cur <= end) {
        const s = toStr(cur);
        out.push({ label: String(cur.getDate()), d1: s, d2: s });
        cur.setDate(cur.getDate() + 1);
      }
    }
    return out;
  }

  /* 数据中出现过的年份，升序 */
  function years() {
    const s = new Set(entries.map(e => e.date.slice(0, 4)));
    return [...s].sort();
  }
  const unknownCount = () => entries.filter(e => !e.catId).length;

  function r2(x) { return Math.round(x * 100) / 100; }

  /* ---------- 财务管理：预算、分类中位数/均值、存钱计划 ---------- */
  /* 当前账本里有数据的连续月份 ['YYYY-MM',...]（首月到末月，中间空月也补上） */
  function dataMonths() {
    const list = scoped();
    if (!list.length) return [];
    let min = list[0].date.slice(0, 7), max = min;
    for (const e of list) { const m = e.date.slice(0, 7); if (m < min) min = m; if (m > max) max = m; }
    const out = [];
    let [y, mo] = min.split('-').map(Number);
    const [ey, em] = max.split('-').map(Number);
    while (y < ey || (y === ey && mo <= em)) {
      out.push(`${y}-${String(mo).padStart(2, '0')}`);
      mo++; if (mo > 12) { mo = 1; y++; }
    }
    return out;
  }
  /* 某分类逐月金额（对齐 dataMonths，空月为0），type 默认 expense */
  function catMonthlyAmounts(catId, type, months) {
    const ms = months || dataMonths();
    const key = catId || '__unknown__';
    return ms.map(ym => {
      let s = 0;
      for (const e of inMonth(ym)) {
        if ((e.type || '') !== (type || 'expense')) continue;
        if ((e.catId || '__unknown__') === key) s += e.amount;
      }
      return r2(s);
    });
  }
  function median(arr) {
    if (!arr.length) return 0;
    const a = [...arr].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return r2(a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2);
  }
  function mean(arr) { return arr.length ? r2(arr.reduce((s, x) => s + x, 0) / arr.length) : 0; }
  /* 某年里有数据的月份（用于按年看统计，避免把没记账的月份算进平均） */
  function monthsOfYear(year) {
    const all = new Set(dataMonths());
    const out = [];
    for (let m = 1; m <= 12; m++) {
      const ym = `${year}-${String(m).padStart(2, '0')}`;
      if (all.has(ym)) out.push(ym);
    }
    return out;
  }
  /* 一组月份的整体收支统计：逐月数组 + 平均/中位数（都用剔除借还款的真实口径） */
  function periodStats(months) {
    const ms = months || dataMonths();
    const exp = [], inc = [], bal = [];
    for (const ym of ms) {
      const t = totals(inMonth(ym));
      exp.push(t.expenseReal); inc.push(t.incomeReal); bal.push(t.balanceReal);
    }
    return {
      months: ms, exp, inc, bal,
      expAvg: mean(exp), expMed: median(exp),
      incAvg: mean(inc), incMed: median(inc),
      balAvg: mean(bal), balMed: median(bal),
    };
  }

  /* 某分类的月度统计 {avg,median,max,min,months,active}（active=有花销的月数） */
  function catStat(catId, type, months) {
    const vals = catMonthlyAmounts(catId, type, months);
    return {
      avg: mean(vals), median: median(vals),
      max: vals.length ? Math.max(...vals) : 0,
      min: vals.length ? Math.min(...vals) : 0,
      months: vals.length, active: vals.filter(v => v > 0).length, vals,
    };
  }
  /* 本月某分类已花（真实支出，不含借还款）*/
  function catSpent(ym, catId) {
    let s = 0;
    for (const e of inMonth(ym)) {
      if (e.type !== 'expense' || debtKindOf(e)) continue;
      if ((e.catId || '__unknown__') === (catId || '__unknown__')) s += e.amount;
    }
    return r2(s);
  }
  /* 本月总真实支出（不含借还款/转账）*/
  const monthRealExpense = (ym) => totals(inMonth(ym)).expenseReal;

  /* 预算 */
  const getBudgets = () => settings.budgets || {};
  const getBudget = (catId) => (settings.budgets || {})[catId] || 0;
  function setBudget(catId, amount) {
    const b = Object.assign({}, settings.budgets);
    if (amount > 0) b[catId] = r2(amount); else delete b[catId];
    updateSettings({ budgets: b });
  }
  const getTotalBudget = () => settings.totalBudget || 0;
  function setTotalBudget(amount) { updateSettings({ totalBudget: r2(amount || 0) }); }
  /* 按均值或中位数一键生成各分类预算 */
  function autoBudgets(basis) {   // basis: 'avg' | 'median'
    const b = {};
    for (const c of getCategories('expense')) {
      const st = catStat(c.id, 'expense');
      const v = basis === 'median' ? st.median : st.avg;
      if (v > 0) b[c.id] = r2(v);
    }
    updateSettings({ budgets: b });
    return Object.keys(b).length;
  }

  /* 存钱计划 */
  const getSavingsGoals = () => settings.savingsGoals || [];
  function addSavingsGoal(g) {
    const id = 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    const goal = { id, name: g.name, target: r2(g.target), base: assetsAsOf(todayISO()).savings, startDate: g.startDate || todayISO(), targetDate: g.targetDate || '', note: g.note || '' };
    updateSettings({ savingsGoals: [...getSavingsGoals(), goal] });
    return goal;
  }
  function updateSavingsGoal(id, patch) {
    updateSettings({ savingsGoals: getSavingsGoals().map(g => g.id === id ? Object.assign({}, g, patch) : g) });
  }
  function removeSavingsGoal(id) {
    updateSettings({ savingsGoals: getSavingsGoals().filter(g => g.id !== id) });
  }
  function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

  /* ---------- 每月储蓄目标：逐月达成情况 + 连续达成 ----------
     某月实际存下 = 真实收入 − 真实支出（剔除借还款，因为借来的钱不算存下的） */
  const getMonthlyGoal = () => settings.monthlyGoal || 0;
  function setMonthlyGoal(v) { updateSettings({ monthlyGoal: r2(v || 0) }); }
  /* 最近 n 个月的达成情况，最新的在前 */
  function monthlyGoalHistory(n) {
    const goal = getMonthlyGoal();
    const ms = dataMonths().slice(-(n || 12)).reverse();
    return ms.map(ym => {
      const t = totals(inMonth(ym));
      const saved = t.balanceReal;
      return { ym, saved, goal, met: goal > 0 && saved >= goal, gap: r2(goal - saved) };
    });
  }
  /* 某一年的储蓄总览：12 个月各存下多少 + 全年累计（每月「真实收入−真实支出」求和，
     存下的月为正、花超的月为负，加起来就是这一年实际攒下/透支了多少）。 */
  function goalYearSummary(year) {
    const goal = getMonthlyGoal();
    const months = [];
    let total = 0;
    for (let m = 1; m <= 12; m++) {
      const ym = year + '-' + String(m).padStart(2, '0');
      const list = inMonth(ym);
      const saved = totals(list).balanceReal;
      total += saved;
      months.push({ ym, saved, goal, met: goal > 0 && saved >= goal, gap: r2(goal - saved), hasData: list.length > 0 });
    }
    const withData = months.filter(m => m.hasData);
    // 手动校正值：记账算出的年累计和实际存款对不上时，用户可校准（不改任何记账记录）
    const adjust = r2((settings.goalYearAdjust || {})[String(year)] || 0);
    return {
      year: String(year), months,
      rawTotal: r2(total), adjust, total: r2(total + adjust),
      metCount: withData.filter(m => m.met).length, dataMonths: withData.length,
    };
  }
  /* 设置某年「累计存下」的手动校正差额；传 0 即清除 */
  function setGoalYearAdjust(year, adj) {
    if (!settings.goalYearAdjust) settings.goalYearAdjust = {};
    if (!adj) delete settings.goalYearAdjust[String(year)];
    else settings.goalYearAdjust[String(year)] = r2(adj);
    saveJSON(K_SETTINGS, settings);
  }
  /* 某一年内的「最长连续达成」月数。
     以前用全局 goalStreak（从最近月往前数），但界面按年查看时它不随所选年份变、
     最近月一没达标就一直是 0 —— 用户以为数据没更新。改成看所选年份内的最好连续记录。 */
  function goalYearStreak(year) {
    const goal = getMonthlyGoal();
    if (goal <= 0) return 0;
    let run = 0, best = 0;
    for (const m of goalYearSummary(year).months) {
      if (!m.hasData) continue;
      if (m.met) { run++; if (run > best) best = run; }
      else run = 0;
    }
    return best;
  }
  /* 连续达成月数（从最近有数据的月份往前数；当月还没过完也算，避免误判为断连） */
  function goalStreak() {
    const goal = getMonthlyGoal();
    if (goal <= 0) return 0;
    let n = 0;
    for (const h of monthlyGoalHistory(60)) {
      if (h.met) n++; else break;
    }
    return n;
  }
  /* 因为守住预算而多存下的钱：各分类 预算−实际 的正数部分之和 */
  function budgetSurplus(ym) {
    let saved = 0, over = 0;
    for (const c of getCategories('expense')) {
      const b = getBudget(c.id);
      if (b <= 0) continue;
      const sp = catSpent(ym, c.id);
      if (sp <= b) saved += (b - sp); else over += (sp - b);
    }
    return { saved: r2(saved), over: r2(over) };
  }
  /* 存钱计划进度：已存 = 现在积蓄 − 建计划时的积蓄基线 */
  function goalProgress(goal) {
    const now = assetsAsOf(todayISO()).savings;
    const saved = r2(now - (goal.base || 0));
    const pct = goal.target > 0 ? Math.max(0, Math.min(100, saved / goal.target * 100)) : 0;
    return { saved, pct, remain: r2(Math.max(0, goal.target - saved)), done: saved >= goal.target };
  }

  /* ---------- 设置 ---------- */
  const getSettings = () => settings;
  function updateSettings(patch) {
    settings = Object.assign({}, settings, patch);
    saveJSON(K_SETTINGS, settings);
    return settings;
  }
  const getThemes = () => THEMES;
  const getTheme = () => THEMES.find(t => t.id === settings.theme) || THEMES[0];

  /* ---------- 导入导出 ---------- */
  function exportAll() {
    return { format: 'jz-backup-v1', exportedAt: new Date().toISOString(), settings, categories, accounts, ledgers, entries };
  }
  function importBackup(obj, mode) {   // mode: 'replace' | 'merge'
    if (!obj || obj.format !== 'jz-backup-v1' || !Array.isArray(obj.entries)) throw new Error('文件格式不正确');
    if (mode === 'replace') {
      categories = obj.categories && obj.categories.length ? obj.categories : categories;
      entries = obj.entries;
      if (obj.accounts && obj.accounts.length) accounts = obj.accounts;
      if (obj.ledgers && obj.ledgers.length) ledgers = obj.ledgers;
      if (obj.settings) { settings = Object.assign({}, settings, obj.settings); saveJSON(K_SETTINGS, settings); }
    } else {
      const have = new Set(entries.map(e => e.id));
      for (const e of obj.entries) if (!have.has(e.id)) entries.push(e);
      const haveCat = new Set(categories.map(c => c.id));
      for (const c of (obj.categories || [])) if (!haveCat.has(c.id)) categories.push(c);
      const haveAcc = new Set(accounts.map(a => a.id));
      for (const a of (obj.accounts || [])) if (!haveAcc.has(a.id)) accounts.push(a);
      const haveLg = new Set(ledgers.map(l => l.id));
      for (const l of (obj.ledgers || [])) if (!haveLg.has(l.id)) ledgers.push(l);
    }
    persistEntries(); persistCats(); persistAccounts(); persistLedgers();
    return entries.length;
  }
  function clearAll() {
    entries = [];
    categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    accounts = JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS));
    ledgers = JSON.parse(JSON.stringify(DEFAULT_LEDGERS));
    setActiveLedger('all');
    persistEntries(); persistCats(); persistAccounts(); persistLedgers();
  }
  function resetCategoriesToDefault() {
    categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    persistCats();
  }
  function storageSize() {
    let n = 0;
    for (const k of [K_ENTRIES, K_CATS, K_SETTINGS, K_ACCOUNTS, K_LEDGERS]) n += (localStorage.getItem(k) || '').length;
    return n;
  }

  return {
    getCategories, getCat, addCategory, addCategories, updateCategory, removeCategory, categorize, debtKindOf,
    addEntry, addEntries, updateEntry, removeEntry, recategorize,
    getEntries, byDate, inRange, inMonth, inYear,
    totals, debtTotals, balanceAsOf, assetsAsOf, catTotals, monthlySeries, monthlyCatSeries,
    monthlyDebtSeries, monthlySavingsSeries, yearCatMatrix, buckets, years, unknownCount,
    // 账户
    getAccountKinds, getAccounts, getAccount, addAccount, updateAccount, removeAccount,
    calibrateAccount, getAdjustLog, matchAccount,
    accountBalance, accountsSnapshot, addTransfer, DEFAULT_ACCT,
    // 账本
    getLedgers, getLedger, activeLedger, setActiveLedger, ledgerForNew, ledgerOf,
    addLedger, updateLedger, removeLedger, DEFAULT_LEDGER,
    // 财务管理
    dataMonths, monthsOfYear, periodStats, catMonthlyAmounts, catStat, median, mean, catSpent, monthRealExpense,
    getBudgets, getBudget, setBudget, getTotalBudget, setTotalBudget, autoBudgets,
    getSavingsGoals, addSavingsGoal, updateSavingsGoal, removeSavingsGoal, goalProgress,
    getMonthlyGoal, setMonthlyGoal, monthlyGoalHistory, goalYearSummary, setGoalYearAdjust, goalStreak, goalYearStreak, budgetSurplus,
    getSettings, updateSettings, getThemes, getTheme, isDirty, markClean,
    exportAll, importBackup, clearAll, resetCategoriesToDefault, storageSize,
  };
})();
