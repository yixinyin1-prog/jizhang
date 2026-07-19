/* ===== 离线授权（电脑版 exe / 安卓 apk 需要；iPhone 网页版免授权）=====
   原理：设备算出「机器码」→ 作者用私钥对机器码签名生成「授权码」→
         APP 用内置公钥验证签名。没有私钥就伪造不出有效授权码。
   授权码验证在本地，一次授权终身用（换设备要重新授权）。
   说明：客户端软件无法绝对防破解，本方案能挡住普通人复制转发（授权码绑机器、无法自造），
        但挡不住专业破解改代码。 */
'use strict';

const License = (() => {
  // 内置公钥（SPKI DER, base64）。对应的私钥只在作者的「授权工具」里，绝不进 APP。
  const PUBKEY_B64 = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEW/1uZCfoiNwx+5WyYc9wEIxEJv6jWuidYwU113ELLjlUrvRS3Zmlkv+6ul8EddWdevsqCyz2bBM4GHBe3s9g6w==';

  function platform() {
    if (window.jzNative && window.jzNative.platform === 'electron') return 'electron';
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return 'android';
    return 'web';
  }
  /* 只有电脑版和安卓 APK 需要授权；网页版（含 iPhone 加到主屏幕）免授权 */
  const required = () => { const p = platform(); return p === 'electron' || p === 'android'; };

  /* ---------- 编码助手 ---------- */
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function b64urlToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return b64ToBytes(s);
  }
  async function sha256hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function randHex(n) {
    const a = new Uint8Array(n); crypto.getRandomValues(a);
    return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* ---------- 机器码 ---------- */
  /* 设备 ID 有效性校验。
     踩过的坑：安卓的 ANDROID_ID 在很多国产 ROM / Android 10+ 上会被隐私策略屏蔽，
     直接返回「0000000000000000」。这种字符串是 truthy 的，早期版本直接拿来用了，
     结果**所有手机算出同一个机器码 D63C-8558-69EA-FB80**，一个授权码全网通用 —— 授权形同虚设。
     所以拿到任何设备 ID 都必须先验真伪，不能只判断非空。 */
  const BAD_IDS = new Set([
    '0000000000000000', '000000000000000', '0', 'null', 'undefined', 'unknown',
    '9774d56d682e549c',                 // 早期安卓大批设备共用的著名脏值
    'ffffffffffffffff', '0123456789abcdef',
  ]);
  function validDeviceId(v) {
    if (v === null || v === undefined) return false;
    const s = String(v).trim().toLowerCase();
    if (s.length < 8) return false;              // 太短，不可能是真 ID
    if (BAD_IDS.has(s)) return false;            // 已知脏值
    if (/^(.)\1+$/.test(s)) return false;        // 全是同一个字符（全 0 / 全 F）
    if (/^0+$/.test(s.replace(/-/g, ''))) return false;
    return true;
  }

  /* ANDROID_ID 不可用时的退路：把一枚随机码写进「文档/富财记备份/」。
     放在共享文档目录而不是 APP 私有目录，是为了卸载重装后它还在 —— 机器码就不会变。 */
  const DEV_ID_PATH = '富财记备份/device-id.txt';
  async function persistedDeviceId() {
    try {
      const FS = (window.Capacitor.Plugins || {}).Filesystem;
      if (!FS) return '';
      try {
        const r = await FS.readFile({ path: DEV_ID_PATH, directory: 'DOCUMENTS', encoding: 'utf8' });
        const v = String(r.data || '').trim();
        if (validDeviceId(v)) return v;
      } catch (e) { /* 文件还不存在，往下新建 */ }
      const nv = randHex(16);
      await FS.writeFile({
        path: DEV_ID_PATH, data: nv,
        directory: 'DOCUMENTS', encoding: 'utf8', recursive: true,
      });
      return nv;
    } catch (e) { return ''; }
  }

  async function rawDeviceId() {
    const p = platform();
    if (p === 'electron' && window.jzNative && window.jzNative.machineId) {
      try { const id = await window.jzNative.machineId(); if (validDeviceId(id)) return 'WIN:' + id; } catch (e) { /* fallthrough */ }
    }
    if (p === 'android') {
      try {
        const Device = (window.Capacitor.Plugins || {}).Device;
        if (Device) {
          const d = await Device.getId();
          const id = d.identifier || d.uuid || d.androidID;
          if (validDeviceId(id)) return 'AND:' + id;
        }
      } catch (e) { /* fallthrough */ }
      // ANDROID_ID 被 ROM 屏蔽 → 用写在文档目录里的随机码（卸载重装仍在）
      const pid = await persistedDeviceId();
      if (pid) return 'AND2:' + pid;
    }
    // 兜底：本地随机码（卸载重装会变，仅作最后退路）
    let r = localStorage.getItem('jz.devrnd');
    if (!r) { r = randHex(16); localStorage.setItem('jz.devrnd', r); }
    return 'GEN:' + r;
  }
  /* 给用户看的机器码：16 位十六进制，分 4 组 XXXX-XXXX-XXXX-XXXX */
  async function machineCode() {
    const h = await sha256hex(await rawDeviceId());
    const s = h.slice(0, 16).toUpperCase();
    return s.replace(/(.{4})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4');
  }
  const normMC = (mc) => String(mc).replace(/[^0-9A-Za-z]/g, '').toUpperCase();

  /* ---------- 验证授权码 ---------- */
  async function verify(mc, code) {
    try {
      // base64url 本身含 - 和 _，只能去掉空白，不能去掉 -
      const sig = b64urlToBytes(String(code).replace(/\s/g, ''));
      if (sig.length !== 64) return false;   // P-256 IEEE-P1363 签名固定 64 字节
      const key = await crypto.subtle.importKey('spki', b64ToBytes(PUBKEY_B64),
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      const msg = new TextEncoder().encode(normMC(mc));
      return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, msg);
    } catch (e) { return false; }
  }

  /* ---------- 状态 ---------- */
  async function status() {
    if (!required()) return { required: false, ok: true, platform: platform() };
    const mc = await machineCode();
    const code = ((Store.getSettings().license) || {}).code || '';
    const ok = code ? await verify(mc, code) : false;
    return { required: true, ok, mc, platform: platform() };
  }
  async function activate(code) {
    const mc = await machineCode();
    const ok = await verify(mc, code);
    if (ok) Store.updateSettings({ license: { code: String(code).trim(), activatedAt: Date.now() } });
    return ok;
  }
  function deactivate() { Store.updateSettings({ license: { code: '', activatedAt: 0 } }); }

  return { platform, required, machineCode, status, activate, deactivate, verify };
})();
