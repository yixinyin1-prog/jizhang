/* ===== 自动备份：每天定点把账本写到指定位置 =====
   电脑（Electron）：可自选任意文件夹，默认「文档/生活记账备份」
   安卓（Capacitor）：写到手机「文档/生活记账备份」，可被文件管理器/网盘看到
   浏览器/PWA：支持文件系统授权的浏览器写入所选文件夹，否则退化为自动下载
   注：APP 打开时才会执行（含错过后的补做），这是各端在不申请后台常驻权限下的一致行为
*/
'use strict';

const Backup = (() => {

  const CAP = () => (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
    ? (window.Capacitor.Plugins || {}).Filesystem : null;

  function platform() {
    if (window.jzNative && window.jzNative.platform === 'electron') return 'electron';
    if (CAP()) return 'android';
    return 'web';
  }
  const canPickDir = () => platform() === 'electron' || (platform() === 'web' && typeof window.showDirectoryPicker === 'function');
  const DIR_NAME = '富财记备份';

  /* 这个环境能不能「无人值守地把文件写进去」。
     iPhone/iPad 的 Safari 不支持文件系统授权 API，只能靠用户点一下导出，
     所以那边自动备份是做不到的 —— 必须如实告诉用户，不能让人以为自己有备份。 */
  async function canAutoWrite() {
    const p = platform();
    if (p === 'electron' || p === 'android') return true;
    return !!(await webDirHandle(false));
  }

  /* ---------- web：把目录句柄存进 IndexedDB ---------- */
  const IDB_NAME = 'jz-backup', IDB_STORE = 'handles';
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(k) {
    try {
      const db = await idb();
      return await new Promise((res, rej) => {
        const t = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(k);
        t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error);
      });
    } catch { return null; }
  }
  async function idbSet(k, v) {
    try {
      const db = await idb();
      return await new Promise((res, rej) => {
        const t = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(v, k);
        t.onsuccess = () => res(true); t.onerror = () => rej(t.error);
      });
    } catch { return false; }
  }

  let webDir = null;   // FileSystemDirectoryHandle
  async function webDirHandle(requestIfNeeded) {
    if (!webDir) webDir = await idbGet('dir');
    if (!webDir) return null;
    const opts = { mode: 'readwrite' };
    let perm = await webDir.queryPermission(opts);
    if (perm !== 'granted' && requestIfNeeded) perm = await webDir.requestPermission(opts);
    return perm === 'granted' ? webDir : null;
  }

  /* ---------- 选择备份位置 ---------- */
  async function pickDir() {
    const p = platform();
    if (p === 'electron') {
      const dir = await window.jzNative.pickDir();
      if (dir) saveCfg({ dirName: dir });
      return dir;
    }
    if (p === 'web' && window.showDirectoryPicker) {
      const h = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' });
      webDir = h; await idbSet('dir', h);
      saveCfg({ dirName: h.name });
      return h.name;
    }
    return '';
  }

  /* 当前备份位置的可读描述 */
  async function currentDir() {
    const p = platform();
    if (p === 'electron') { try { return await window.jzNative.getDir(); } catch { return ''; } }
    if (p === 'android') return `手机存储 / Documents / ${DIR_NAME}`;
    const h = await webDirHandle(false);
    if (h) return `已授权文件夹：${h.name}`;
    return '';
  }

  /* ---------- 执行一次备份 ---------- */
  function stampName(d) {
    const p = n => String(n).padStart(2, '0');
    return `记账备份-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  }

  /* 备份成功后记一笔时间，用于「多久没备份了」的提醒 */
  function markDone() {
    Store.markClean();
    saveCfg({ lastOkAt: Date.now() });
  }

  async function run(opts = {}) {
    const content = JSON.stringify(Store.exportAll());
    const filename = stampName(new Date());
    const p = platform();
    const cfg = Store.getSettings().backup;

    if (p === 'electron') {
      const full = await window.jzNative.writeBackup(filename, content);
      await window.jzNative.pruneBackups(cfg.keep || 14);
      markDone();
      return { ok: true, where: full };
    }
    if (p === 'android') {
      const FS = CAP();
      await FS.writeFile({
        path: `${DIR_NAME}/${filename}`, data: content,
        directory: 'DOCUMENTS', encoding: 'utf8', recursive: true,
      });
      await pruneAndroid(cfg.keep || 14);
      markDone();
      return { ok: true, where: `文档/${DIR_NAME}/${filename}` };
    }
    // web：优先写入已授权的文件夹
    const h = await webDirHandle(!!opts.interactive);
    if (h) {
      const fh = await h.getFileHandle(filename, { create: true });
      const w = await fh.createWritable();
      await w.write(content); await w.close();
      await pruneWeb(h, cfg.keep || 14);
      markDone();
      return { ok: true, where: `${h.name}/${filename}` };
    }
    // 到这儿说明没有可写的文件夹（iPhone/iPad 的 Safari 就是这种情况）。
    // 自动触发的备份（silent）只能作罢——没有用户点击，浏览器不会让你存文件。
    if (opts.silent) return { ok: false, where: '', reason: 'no-dir' };

    // 用户亲手点的：先试系统分享面板（iOS 上可以「存储到文件」/ iCloud 云盘），
    // 不支持再退化成下载
    const blob = new Blob([content], { type: 'application/json' });
    if (await shareFile(filename, blob)) { markDone(); return { ok: true, where: '你选的位置（文件 / iCloud 云盘）' }; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    markDone();
    return { ok: true, where: '下载文件夹' };
  }

  /* 调系统分享面板存文件；不支持或用户取消返回 false */
  async function shareFile(filename, blob) {
    try {
      if (!navigator.canShare || !navigator.share) return false;
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      if (!navigator.canShare({ files: [file] })) return false;
      await navigator.share({ files: [file], title: filename });
      return true;
    } catch (err) {
      return false;   // 用户取消分享也走这里，交给调用方退化处理
    }
  }

  const BAK_RE = /^记账备份-.*\.json$/;

  async function pruneAndroid(keep) {
    try {
      const FS = CAP();
      const res = await FS.readdir({ path: DIR_NAME, directory: 'DOCUMENTS' });
      const files = (res.files || []).map(f => (typeof f === 'string' ? { name: f, mtime: 0 } : f))
        .filter(f => BAK_RE.test(f.name))
        .sort((a, b) => (b.mtime || 0) - (a.mtime || 0) || b.name.localeCompare(a.name));
      for (const f of files.slice(keep)) {
        await FS.deleteFile({ path: `${DIR_NAME}/${f.name}`, directory: 'DOCUMENTS' }).catch(() => {});
      }
    } catch { /* 目录读不到就跳过清理 */ }
  }
  async function pruneWeb(h, keep) {
    try {
      const names = [];
      for await (const [name, entry] of h.entries()) if (entry.kind === 'file' && BAK_RE.test(name)) names.push(name);
      names.sort().reverse();
      for (const n of names.slice(keep)) await h.removeEntry(n).catch(() => {});
    } catch { /* 无权限枚举就跳过 */ }
  }

  /* ---------- 列出已有备份 ---------- */
  async function list() {
    const p = platform();
    if (p === 'electron') { try { return await window.jzNative.listBackups(); } catch { return []; } }
    if (p === 'android') {
      try {
        const res = await CAP().readdir({ path: DIR_NAME, directory: 'DOCUMENTS' });
        return (res.files || []).map(f => (typeof f === 'string' ? { name: f, size: 0, mtime: 0 } : { name: f.name, size: f.size || 0, mtime: f.mtime || 0 }))
          .filter(f => BAK_RE.test(f.name))
          .sort((a, b) => (b.mtime || 0) - (a.mtime || 0) || b.name.localeCompare(a.name));
      } catch { return []; }
    }
    const h = await webDirHandle(false);
    if (!h) return [];
    const out = [];
    try {
      for await (const [name, entry] of h.entries()) {
        if (entry.kind !== 'file' || !BAK_RE.test(name)) continue;
        const f = await entry.getFile();
        out.push({ name, size: f.size, mtime: f.lastModified });
      }
    } catch { return []; }
    return out.sort((a, b) => b.mtime - a.mtime);
  }

  /* 读取某个备份的内容（用于一键恢复） */
  async function read(name) {
    const p = platform();
    if (p === 'electron') return await window.jzNative.readBackup(name);
    if (p === 'android') {
      const r = await CAP().readFile({ path: `${DIR_NAME}/${name}`, directory: 'DOCUMENTS', encoding: 'utf8' });
      return r.data;
    }
    const h = await webDirHandle(true);
    if (!h) throw new Error('没有可读取的备份文件夹');
    const fh = await h.getFileHandle(name);
    return await (await fh.getFile()).text();
  }

  async function openDir() {
    if (platform() === 'electron') return await window.jzNative.openDir();
    return '';
  }

  /* ---------- 配置 ---------- */
  function saveCfg(patch) {
    const s = Store.getSettings();
    Store.updateSettings({ backup: Object.assign({}, s.backup, patch) });
  }
  const getCfg = () => Store.getSettings().backup;

  /* ---------- 定时调度 ---------- */
  function todayStr() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /* 判断此刻该不该备份：返回到期且今天还没备过的时间点，没有则返回 null。
     纯函数，不碰文件，方便单独验证。 */
  function dueSlot(cfg, now, today) {
    if (!cfg || !cfg.enabled) return null;
    for (const t of (cfg.times || [])) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(t).trim());
      if (!m) continue;
      const due = new Date(now);
      due.setHours(+m[1], +m[2], 0, 0);
      if (now < due) continue;                        // 还没到点
      if ((cfg.lastRun || {})[t] === today) continue; // 今天这个点已经备过
      return t;                                       // 一次只报一个，剩下的下一分钟再看
    }
    return null;
  }

  let running = false;
  async function tick() {
    if (running) return;
    const today = todayStr();
    const t = dueSlot(getCfg(), new Date(), today);
    if (!t) return;
    running = true;
    try {
      const res = await run({ silent: true });
      if (res.ok) {
        saveCfg({ lastRun: Object.assign({}, getCfg().lastRun, { [t]: today }) });
        if (typeof window.onBackupDone === 'function') window.onBackupDone(res, t);
      }
      // res.ok 为 false（例如网页端还没授权文件夹）时不记 lastRun，
      // 这样用户一选好位置就会立刻补做，不会白白跳过一天
    } catch (err) {
      console.warn('自动备份失败：', err);
    } finally { running = false; }
  }

  /* ---------- 有改动就在退出/切后台时备份 ---------- */
  async function backupIfDirty(reason) {
    const cfg = getCfg();
    if (!cfg.onExit || !Store.isDirty()) return { ok: false, reason: 'clean' };
    try {
      const res = await run({ silent: true });
      if (res.ok && typeof window.onBackupDone === 'function') window.onBackupDone(res, reason);
      return res;
    } catch (err) {
      console.warn('退出备份失败：', err);
      return { ok: false, reason: String(err && err.message) };
    }
  }

  function startExitHooks() {
    // 电脑版：主进程会在关窗口前问一句，这里同步等备份写完再放行
    if (platform() === 'electron' && window.jzNative.onBeforeQuit) {
      window.jzNative.onBeforeQuit(async () => {
        const r = await backupIfDirty('退出前');
        return r.ok;
      });
    }
    // 安卓/网页：切到后台就是「可能再也回不来」的时刻，此时备份最稳妥
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) backupIfDirty('切到后台');
      else tick();
    });
    // 网页端关标签页的兜底（时间很短，只能尽力而为）
    window.addEventListener('pagehide', () => { backupIfDirty('关闭页面'); });
  }

  /* ---------- 备份提醒 ----------
     在写不了文件的环境（iPhone/iPad 的 Safari）里，自动备份是做不到的，
     能做的只有：数据有改动、又太久没备份时，明确提醒用户点一下。 */
  async function reminder() {
    if (!Store.isDirty()) return null;
    if (await canAutoWrite()) return null;      // 能自动写就不用烦用户
    const cfg = getCfg();
    if (cfg.remindDays === 0) return null;      // 用户主动关掉了提醒
    const last = cfg.lastOkAt || 0;
    const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    const limit = cfg.remindDays || 3;
    if (last && days < limit) return null;
    return { days, never: !last, n: Store.getEntries().length };
  }

  function start() {
    tick();                                   // 启动即检查（补做错过的备份）
    setInterval(tick, 60 * 1000);
    startExitHooks();
  }

  return {
    platform, canPickDir, canAutoWrite, pickDir, currentDir, run, list, read, openDir,
    getCfg, saveCfg, start, tick, dueSlot, backupIfDirty, reminder, shareFile,
  };
})();
