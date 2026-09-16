/* 教务课表 Web 原型 —— 数据解析 + 周课表/今日 双视图
 * 规则对照需求文档:
 *   FR-2 学期/周次(当前周自动读教务 cur-week)、FR-3 解析(teachingWeekFormat/periodFormat、
 *       线上行归组、同课多行合并)、FR-4.1 周课表(今天列高亮)、FR-4.2 今日(下一节/已过未到)、
 *       FR-5 本地缓存(打开先渲染缓存再后台刷新)、作息时刻自动读官方 get-large-period。
 */
"use strict";

/* 兜底作息: 接口不可用时用(内容与教务官方一致, 仅为离线兜底) */
const FALLBACK_TIMES = [
  "08:30-09:15", "09:25-10:10", "10:30-11:15", "11:25-12:10",
  "14:00-14:45", "14:55-15:40", "16:00-16:45", "16:55-17:40",
  "19:00-19:45", "19:55-20:40", "20:50-21:35", "21:45-22:30",
];

const PALETTE = [
  "#4e7cff", "#e3655b", "#2fa96b", "#9b6fe0", "#e08c2f", "#22a7b8",
  "#d2479b", "#7c8f1f", "#5f6ee0", "#c4552f", "#3c8f7d", "#8e6bd0",
];
const WD = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

const LS = {
  meta: "kbt-meta-v2",           // 学期列表/当前周/作息 的缓存(离线兜底)
  rows: "kbt-rows-",             // + sessionId -> 该学期课表原始行(离线缓存)
  lastFetch: "kbt-fetched-",     // + sessionId -> 时间戳 ms
  manual: "kbt-manual-",         // + sessionId -> 用户手动添加的课程/任务[]
};
const CACHE_MAX_AGE = 7 * 864e5; // 课表离线缓存最长 7 天; 有网时后台总会刷新
const REFRESH_COOLDOWN = 5 * 60e3; // 打开页自动静默刷新的最小间隔 5 分钟

const S = {
  account: null,
  sessions: [],
  activeId: null,      // 当前(激活)学期 —— 今日/curWeek 只对它有意义
  sessionId: null,     // 周课表正在查看的学期
  tab: "week",         // 当前 Tab
  week: 1,
  maxTerm: 20,
  curWeek: null,       // 教务官方"当前教学周"
  baseMonday: null,    // 由 curWeek 反推的第1周周一(Date), 仅在当前学期有效
  times: FALLBACK_TIMES.slice(),
  timesAuto: false,
  models: new Map(),   // sessionId -> model
  manual: new Map(),   // sessionId -> 手动添加项[]
  colorIdx: new Map(), nextColor: 0,
  mobileDay: Math.max(1, Math.min(7, new Date().getDay() || 7)),
  _editing: null,      // 正在编辑的手动项 id
  _tick: null,
};

const $ = (id) => document.getElementById(id);
const STATUS_ICON = {
  loading: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v6h-6"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>',
  done: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
  free: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14v10H5zM8 5v3M16 5v3M8 13h8"/></svg>',
  key: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="12" r="4"/><path d="m12 12 8-8M16 8l2 2"/></svg>',
  warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 20h19zM12 9v5M12 17h.01"/></svg>',
};
function blankState(kind, text) {
  return `<div class="blank"><div class="big">${STATUS_ICON[kind] || STATUS_ICON.info}</div>${text}</div>`;
}

/* ---------------- 直连模式 (Android / iOS / Safari PWA) ----------------
 * 原生壳通过 window.Android 提供桥; HTTPS 网页通过学校 OAuth 直接拿 Bearer token。
 * 两种模式都只连接学校官方接口, 不经过自建中转服务器。
 */
const APP_PLATFORM = (() => {
  try {
    if (typeof window === "undefined" || !window.Android || !window.Android.platform) return "";
    return window.Android.platform();
  } catch (e) { return ""; }
})();
const WEB_DIRECT = !APP_PLATFORM && (location.protocol === "https:" || new URLSearchParams(location.search).has("direct"));
const NATIVE_PLATFORM = APP_PLATFORM || (WEB_DIRECT ? "web" : "");
const NATIVE = !!NATIVE_PLATFORM;

const NJW = {
  timetable: "https://njw.cqie.edu.cn/api/timetable",
  enroll: "https://njw.cqie.edu.cn/api/enrollment",
  resource: "https://njw.cqie.edu.cn/api/resourceapi",
};
const WEB_OAUTH = {
  auth: "https://njw.cqie.edu.cn/authserver",
  clientId: "personal-prod",
  clientSecret: "app-a-1234",
  tokenKey: "kbt-web-oauth-v1",
  stateKey: "kbt-web-oauth-state",
};
/* 与 server.py 裁剪一致: 只回传渲染所需字段(原始行 150+ 键, 裁掉省内存) */
const KEEP = ["courseName", "courseCode", "classNbr", "credit", "campusName", "roomName",
  "roomLabel", "instructorName", "courseDepartmentName", "weekDay", "periodFormat",
  "teachingWeekFormat", "teachingWeek", "period"];

let _tok = null;

function webTokenRecord() {
  try { return JSON.parse(localStorage.getItem(WEB_OAUTH.tokenKey) || "null"); }
  catch (e) { return null; }
}
function saveWebToken(j) {
  const old = webTokenRecord() || {};
  const record = {
    accessToken: j.access_token || "",
    refreshToken: j.refresh_token || old.refreshToken || "",
    expiresAt: Date.now() + Math.max(60, (+j.expires_in || 604799) - 120) * 1000,
  };
  localStorage.setItem(WEB_OAUTH.tokenKey, JSON.stringify(record));
  _tok = record.accessToken || null;
  return record.accessToken;
}
function webRedirectUri() {
  return location.origin + location.pathname;
}
async function webTokenRequest(fields) {
  const body = new URLSearchParams(fields);
  const basic = btoa(WEB_OAUTH.clientId + ":" + WEB_OAUTH.clientSecret);
  const response = await fetch(WEB_OAUTH.auth + "/oauth/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + basic,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(data.error_description || "登录凭证获取失败");
  return saveWebToken(data);
}
async function refreshWebToken() {
  const record = webTokenRecord();
  if (!record || !record.refreshToken) return "";
  try {
    return await webTokenRequest({
      grant_type: "refresh_token",
      refresh_token: record.refreshToken,
      client_id: WEB_OAUTH.clientId,
      client_secret: WEB_OAUTH.clientSecret,
    });
  } catch (e) { return ""; }
}
function randomState() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("");
}
function startWebLogin(force) {
  const state = randomState();
  sessionStorage.setItem(WEB_OAUTH.stateKey, state);
  const query = new URLSearchParams({
    client_id: WEB_OAUTH.clientId,
    response_type: "code",
    scope: "all",
    state,
    redirect_uri: webRedirectUri(),
  });
  if (force) query.set("prompt", "login");
  location.assign(WEB_OAUTH.auth + "/oauth/authorize?" + query.toString());
}
async function handleWebOAuthCallback() {
  if (!WEB_DIRECT) return;
  const query = new URLSearchParams(location.search);
  const code = query.get("code");
  const error = query.get("error");
  if (!code && !error) return;
  const gate = $("authGate");
  const message = $("authMessage");
  if (gate) gate.hidden = false;
  if (message) message.textContent = error ? "学校登录未完成" : "正在读取你的课表…";
  try {
    if (error) throw new Error(query.get("error_description") || error);
    const expected = sessionStorage.getItem(WEB_OAUTH.stateKey);
    if (!expected || expected !== query.get("state")) throw new Error("登录状态校验失败，请重新登录");
    await webTokenRequest({
      client_id: WEB_OAUTH.clientId,
      client_secret: WEB_OAUTH.clientSecret,
      code,
      redirect_uri: webRedirectUri(),
      grant_type: "authorization_code",
    });
    sessionStorage.removeItem(WEB_OAUTH.stateKey);
    history.replaceState({}, document.title, location.pathname);
    if (gate) gate.hidden = true;
  } catch (e) {
    localStorage.removeItem(WEB_OAUTH.tokenKey);
    if (message) message.textContent = (e && e.message) || "登录失败，请重试";
  }
}
const WEB_BRIDGE = {
  platform: () => "web",
  token: () => (webTokenRecord() || {}).accessToken || "",
  ensureToken: async () => {
    const record = webTokenRecord();
    if (record && record.accessToken && record.expiresAt > Date.now() + 60000) return record.accessToken;
    const refreshed = await refreshWebToken();
    if (refreshed) return refreshed;
    startWebLogin(false);
    return "";
  },
  relogin: async () => { startWebLogin(true); return ""; },
  logout: async () => {
    localStorage.removeItem(WEB_OAUTH.tokenKey);
    _tok = null;
    return true;
  },
  http: async (method, url, bearer, body) => {
    try {
      const headers = { Accept: "application/json" };
      if (bearer) headers.Authorization = "Bearer " + bearer;
      if (body) headers["Content-Type"] = "application/json";
      const response = await fetch(url, { method, headers, body: body || undefined });
      const text = await response.text();
      return response.ok ? text : `__KBT_ERR__${response.status}\n${text.slice(0, 500)}`;
    } catch (e) { return "__KBT_ERR__0\n" + ((e && e.message) || "网络错误"); }
  },
};
function _A() {
  if (APP_PLATFORM) return window.Android;
  return WEB_DIRECT ? WEB_BRIDGE : null;
}
function _bearer() {
  if (!_tok) { const a = _A(); if (a && a.token) _tok = a.token() || null; }
  return _tok;
}
function jwtSub(token) {
  try {
    const b = String(token).split(".")[1]; if (!b) return "";
    const p = b.replace(/-/g, "+").replace(/_/g, "/");
    const j = JSON.parse(atob(p));
    return j.sub || j.username || j.uid || j.userName || "";
  } catch (e) { return ""; }
}
function todayStamp() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/* 网络层: 先试 fetch(壳放开 file:// 跨域时最快); CORS/断网回落原生 OkHttp 桥.
 * 401 时先静默续期一次(ensureToken 可能弹官方登录页), 再重试一遍。 */
async function _njw(method, url, json) {
  const A = _A();
  for (let k = 0; k < 2; k++) {
    const t = _bearer();
    try {
      const h = { Authorization: "Bearer " + t, Accept: "application/json" };
      if (json) h["Content-Type"] = "application/json";
      let j;
      try {
        const r = await fetch(url, { method, headers: h, body: json ? JSON.stringify(json) : undefined });
        const txt = await r.text();
        if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
        j = JSON.parse(txt || "null");
      } catch (e) {
        if (e && e.status) throw e;                       // 真·HTTP 错误(401 等)
        if (A && A.http) {                                // CORS/网络错 -> OkHttp 桥
          const raw = await Promise.resolve(A.http(method, url, t || "", json ? JSON.stringify(json) : ""));
          if (!raw) throw new Error("net:empty");
          if (raw.indexOf("__KBT_ERR__") === 0) {
            const st = parseInt(raw.slice(11).split("\n")[0], 10) || 0;
            const er = new Error("HTTP " + st); er.status = st; throw er;
          }
          j = JSON.parse(raw);
        } else throw e;
      }
      return j;
    } catch (e) {
      if (e && e.status === 401 && k === 0 && A && A.ensureToken) {
        const nt = await Promise.resolve(A.ensureToken()); // 静默续期, 失败弹官方登录页
        if (nt) { _tok = nt; continue; }
      }
      throw e;
    }
  }
}

/* 把后端 /api/* 直连到教务, 返回与 server.py 相同形状 -> 上层代码零改动 */
async function apiNative(path) {
  // 本地没有任何 token(刚退出登录 / 首次未登录): 需要鉴权的接口直接判"未登录",
  // 既不发请求、也不自动弹登录页。这样退出后是干净的落地页(带"去官方登录页"按钮),
  // 不会因 SSO 一秒内静默登回原账号而看起来像"退不掉"。
  if (path !== "/api/state" && !_bearer()) {
    return { ok: false, needLogin: true, account: "", msg: "未登录" };
  }
  const acct = () => jwtSub(_bearer());
  const sortSessions = (items) => {
    const key = (it) => {
      const yt = it.yearAndTerm || "";
      const y = parseInt(yt.slice(0, 4), 10) || 0;
      return [it.active ? 0 : 1, -y, yt.indexOf("秋") >= 0 ? 1 : 0];
    };
    items.sort((a, b) => {
      const A = key(a), B = key(b);
      for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] - B[i];
      return 0;
    });
    return items;
  };
  try {
    if (path === "/api/state") {
      return _bearer()
        ? { ok: true, account: acct(), needLogin: false }
        : { ok: false, needLogin: true, account: "", msg: "未登录" };
    }
    if (path === "/api/sessions") {
      const j = await _njw("GET", NJW.enroll + "/enrollment-batch/session-list");
      const arr = (j && j.data) || [];
      const items = arr.map((it) => ({
        sessionId: String(it.sessionId), yearAndTerm: it.yearAndTerm || "",
        active: String(it.activeFlag) === "Y",
      }));
      sortSessions(items);
      return { ok: true, account: acct(), sessions: items };
    }
    if (path === "/api/curweek") {
      const j = await _njw("GET", NJW.timetable + "/time/cur-week");
      const d = (j && j.data) || {};
      const keys = Object.keys(d).filter((k) => /^\d+$/.test(k));
      if (!keys.length) return { ok: false, msg: "cur-week 无数据" };
      return { ok: true, week: parseInt(keys[0], 10), raw: j.data };
    }
    if (path === "/api/times") {
      const j = await _njw("GET", NJW.resource + "/timePattern/get-large-period");
      const arr = (j && j.data) || [];
      const pl = (arr[0] && arr[0].periodList) || [];
      const times = pl.map((p) => ({
        period: +p.smallPeriod, type: +(p.type || 0), start: p.startTime, end: p.endTime,
      })).sort((a, b) => a.period - b.period);
      return { ok: true, times };
    }
    if (path.indexOf("/api/timetable") === 0) {
      const qs = path.split("?")[1] || "";
      const m = qs.match(/session=([^&]*)/);
      const session = m ? decodeURIComponent(m[1]) : "";
      const j = await _njw("POST",
        NJW.timetable + "/class/timetable/student/my-table-detail?sessionId=" + encodeURIComponent(session),
        {});
      const rows = (j && j.classTimetableVOList) || [];
      const out = rows.map((r) => { const o = {}; for (const k of KEEP) if (r[k] != null) o[k] = r[k]; return o; });
      return { ok: true, account: acct(), sessionId: session, rows: out, fetchedAt: todayStamp() };
    }
    return { ok: false, msg: "unknown " + path };
  } catch (e) {
    return { ok: false, needLogin: false, msg: (e && e.message) || "网络错误" };
  }
}

async function api(path) {
  if (NATIVE) return apiNative(path);
  const r = await fetch(path);
  return r.json();
}
function toast(msg, warn) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("warn", !!warn);
  t.hidden = false;
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.hidden = true), 3000);
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function cleanInstr(s) {
  if (!s) return "";
  const out = [];
  String(s).split(";").forEach((seg) => {
    seg = seg.replace(/-?\d+\[[^\]]*\]/g, "").replace(/\[[^\]]*\]/g, "").replace(/^[\s\- ]+|[\s\- ]+$/g, "");
    if (seg && !out.includes(seg)) out.push(seg);
  });
  return out.join("、");
}
function parseWeeks(row) {
  const out = new Set();
  let txt = String(row.teachingWeekFormat || "").replace(/[周\s节]/g, "");
  if (/\d/.test(txt)) {
    for (const tok of txt.split(/[,，]/)) {
      const t = tok.trim();
      const m = t.match(/^(\d+)\s*[-—~]\s*(\d+)$/);
      if (m) for (let i = +m[1]; i <= +m[2]; i++) out.add(i);
      else if (/^\d+$/.test(t)) out.add(+t);
    }
    if (out.size) return out;
  }
  const bit = row.teachingWeek || "";
  for (let i = 0; i < bit.length; i++) if (bit[i] === "1") out.add(i + 1);
  return out;
}
function parsePeriod(txt) {
  const segs = [];
  String(txt || "").replace(/节/g, "").split(/[,，]/).forEach((tok) => {
    const m = tok.trim().match(/^(\d+)\s*[-—~]\s*(\d+)$/);
    if (m) segs.push([+m[1], +m[2]]);
    else if (/^\d+$/.test(tok.trim())) segs.push([+tok.trim(), +tok.trim()]);
  });
  if (!segs.length) return null;
  return { min: Math.min(...segs.map((x) => x[0])), max: Math.max(...segs.map((x) => x[1])), segs };
}
function hmMin(s) { const p = String(s || "").split(":").map(Number); return p.length === 2 ? p[0] * 60 + p[1] : NaN; }
function minHm(m) {
  const h = Math.floor(m / 60), mm = m % 60;
  return String(h).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}
function nowMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function clockRange(startP, endP) {
  const a = S.times[startP - 1], b = S.times[endP - 1];
  if (!a || !b) return "";
  return a.split("-")[0] + "–" + b.split("-")[1];
}
function evStartMin(e) { return hmMin(S.times[e.per.min - 1]); }
function evEndMin(e) { return hmMin(S.times[e.per.max - 1]); }
function periodLabel(a, b) { return a === b ? a + "节" : a + "-" + b + "节"; }
/* 现在是第几节(1..12); 课间休息返回 null */
function currentPeriod(now) {
  const m = now == null ? nowMin() : now;
  for (let i = 0; i < S.times.length; i++) {
    const t = S.times[i]; if (!t) continue;
    const s = hmMin(t.split("-")[0]), e = hmMin(t.split("-")[1]);
    if (m >= s && m < e) return i + 1;
  }
  return null;
}
function todayDate() { return new Date(); }
function todayWd() { return ((todayDate().getDay() + 6) % 7) + 1; }   // 1=周一..7=周日
function pad(x) { return String(x).padStart(2, "0"); }
function todayText() {
  const d = todayDate();
  return `今天 ${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${WD[todayWd() - 1]}`;
}
function thisMonday(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function dayDateStr(week, idx) {
  if (S.sessionId !== S.activeId || !S.baseMonday) return "";
  const d = new Date(S.baseMonday); d.setDate(d.getDate() + (week - 1) * 7 + (idx - 1));
  return (d.getMonth() + 1) + "/" + d.getDate();
}
function isShowingToday() {
  return !!(S.curWeek && S.sessionId === S.activeId && S.week === S.curWeek);
}

/* ---------------- 本地缓存(FR-5) ---------------- */
function cacheSaveRows(sid, rows) {
  try {
    localStorage.setItem(LS.rows + sid, JSON.stringify({ at: Date.now(), rows }));
    localStorage.setItem(LS.lastFetch + sid, String(Date.now()));
  } catch (e) { /* 存储满等忽略 */ }
}
function cacheLoadRows(sid) {
  try {
    const j = JSON.parse(localStorage.getItem(LS.rows + sid) || "null");
    if (j && Array.isArray(j.rows)) return j.rows;
  } catch (e) { }
  return null;
}
function cacheLoadMeta() {
  try { return JSON.parse(localStorage.getItem(LS.meta) || "null"); }
  catch (e) { return null; }
}
function cacheSaveMeta() {
  try {
    localStorage.setItem(LS.meta, JSON.stringify({
      account: S.account, sessions: S.sessions, activeId: S.activeId,
      curWeek: S.curWeek, baseMonday: S.baseMonday ? S.baseMonday.toISOString() : null,
      times: S.times, timesAuto: S.timesAuto,
    }));
  } catch (e) { }
}
function applyMeta(m) {
  if (!m) return;
  if (m.account) S.account = m.account;
  if (Array.isArray(m.sessions) && m.sessions.length && !S.sessions.length) S.sessions = m.sessions;
  if (m.activeId) S.activeId = m.activeId;
  if (typeof m.curWeek === "number") {
    S.curWeek = m.curWeek;
    if (m.baseMonday) { S.baseMonday = new Date(m.baseMonday); }
    else { const mon = thisMonday(todayDate()); mon.setDate(mon.getDate() - (S.curWeek - 1) * 7); S.baseMonday = mon; }
  }
  if (Array.isArray(m.times) && m.times.length) { S.times = m.times; S.timesAuto = true; }
}

/* ---------------- 课程取色 ---------------- */
function colorOf(key) {
  if (!S.colorIdx.has(key)) { S.colorIdx.set(key, S.nextColor % PALETTE.length); S.nextColor++; }
  return PALETTE[S.colorIdx.get(key)];
}
function tint(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* ---------------- 建模 ---------------- */
function buildModel(rows) {
  const m = { fixed: [], online: [], maxPeriod: 0, maxWeek: 0, termWeeks: 20, courses: new Map() };
  for (const row of rows) {
    const wdNum = Number(row.weekDay);
    const weeks = parseWeeks(row);
    const per = (row.weekDay ? parsePeriod(row.periodFormat) : null);
    const key = (row.courseCode || "?") + "|" + (row.classNbr || "");
    const room = (row.roomName || row.roomLabel || "").trim();
    const campus = (row.campusName || "").trim();
    const instr = cleanInstr(row.instructorName);
    const e = {
      key, name: row.courseName || "", code: row.courseCode || "", classNbr: row.classNbr || "",
      credit: row.credit, campus, room, instr,
      dept: row.courseDepartmentName || "",
      weeks, weeksTxt: row.teachingWeekFormat || "",
      weekDay: wdNum, per,
    };
    const c = m.courses.get(key) || { name: e.name, code: e.code, classNbr: e.classNbr,
      dept: e.dept, credit: e.credit, instrs: new Set(), campi: new Set() };
    if (e.instr) c.instrs.add(e.instr);
    if (campus) c.campi.add(campus);
    if (!m.courses.has(key)) m.courses.set(key, c);
    if (!row.weekDay || !per) {
      e.online = true; m.online.push(e);
      weeks.forEach((w) => (m.maxWeek = Math.max(m.maxWeek, w)));
      continue;
    }
    e.online = false; m.fixed.push(e);
    m.maxPeriod = Math.max(m.maxPeriod, per.max);
    weeks.forEach((w) => (m.maxWeek = Math.max(m.maxWeek, w)));
    m.termWeeks = Math.max(m.termWeeks, String(row.teachingWeek || "").length);
  }
  m.termWeeks = Math.max(m.termWeeks, m.maxWeek, 20);
  return m;
}

/* ---------------- 手动添加的课程/任务 (FR-新增) ----------------
 * 数据只存本机 localStorage: {id,title,kind(day/day|task|memo),day,pStart,pEnd,weeksTxt,loc,note,colorIdx}
 * weeksTxt: ""=每周; 否则同 teachingWeekFormat 语法("1-16"/"1,3,5"/"8")。
 */
const KIND_LABEL = { course: "课程", task: "任务", memo: "备忘" };
function getManual(sessionId) {
  if (S.manual.has(sessionId)) return S.manual.get(sessionId);
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(LS.manual + sessionId) || "[]"); }
  catch (e) { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  S.manual.set(sessionId, arr);
  return arr;
}
function saveManual(sessionId) {
  try { localStorage.setItem(LS.manual + sessionId, JSON.stringify(S.manual.get(sessionId) || [])); }
  catch (e) { }
}
/* weeksTxt 为空=每周都有; 否则按格式解析成 Set(同 parseWeeks) */
function manualWeekSet(x, maxTerm) {
  if (!x || !x.weeksTxt) return null;                 // null = 每周
  const s = parseWeeks({ teachingWeekFormat: x.weeksTxt });
  return s.size ? s : null;
}
function manualShows(x, week, maxTerm) {
  const s = manualWeekSet(x, maxTerm);
  return s ? s.has(week) : week >= 1 && week <= maxTerm;
}
function manualWeeksLabel(x) {
  return x.weeksTxt ? "第" + x.weeksTxt + "周" : "每周";
}
function manualColorIdx(x) {
  const s = x.colorIdx != null ? x.colorIdx : 0;
  return s % PALETTE.length;
}
/* 手动项 -> 可被 layout/makeEv 使用的事件对象 */
function toManualEv(x) {
  return {
    key: "manual:" + x.id,
    name: x.title || "未命名",
    manual: x,
    weekDay: x.day,
    per: { min: Math.max(1, x.pStart || 1), max: Math.max(1, x.pEnd || 1) },
  };
}

/* ---------------- 渲染: 顶栏 / 周次条 ---------------- */
function renderAll() {
  renderTop();
  if (S.tab === "week") { renderSheet(); renderOnline(); }
  else { renderToday(); }
}
function renderTop() {
  $("acct").textContent = S.account ? `账号 ${S.account}` : "未登录";
  $("todayTxt").textContent = S.curWeek ? `${todayText()} · 第 ${S.curWeek} 周` : todayText();
  $("maxW").textContent = S.maxTerm;
  $("weekIn").max = S.maxTerm;
  $("weekIn").value = S.week;
  $("todayBtn").disabled = !(S.curWeek && S.sessionId === S.activeId);
  buildWeekStrip();
  // 顶栏周次控件仅对周课表有意义
  $("semSel").disabled = false;
}
function buildWeekStrip() {
  const bar = $("weekStrip");
  bar.innerHTML = "";
  for (let w = 1; w <= S.maxTerm; w++) {
    const b = document.createElement("button");
    const isCur = S.curWeek != null && w === S.curWeek;
    b.className = "wchip" + (w === S.week ? " cur" : "") + (isCur ? " today" : "");
    b.title = isCur ? "第 " + w + " 周(本周)" : "第 " + w + " 周";
    b.textContent = w;
    b.onclick = () => setWeek(w);
    bar.appendChild(b);
  }
  const sel = bar.querySelector(".wchip.cur");
  if (sel) sel.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
}

/* ---------------- 渲染: 周课表 ---------------- */
function displayPeriods(m) {
  const auto = m ? Math.max(8, m.maxPeriod) : 8;
  return Math.max(4, Math.min(14, auto));
}
function renderSheet() {
  const sheet = $("sheet");
  const mobile = $("mobileSchedule");
  const m = S.models.get(S.sessionId);
  sheet.innerHTML = "";
  if (mobile) mobile.innerHTML = "";
  if (!m) {
    sheet.innerHTML = blankState("loading", "加载课表中…");
    if (mobile) mobile.innerHTML = `<div class="mobile-empty">正在读取课表…</div>`;
    return;
  }
  const showingToday = isShowingToday();
  const tWd = showingToday ? todayWd() : -1;
  let N = displayPeriods(m);
  getManual(S.sessionId).forEach((x) => { if (x.pEnd && x.pEnd > N) N = Math.min(14, x.pEnd); });
  const HH = 58;
  sheet.style.setProperty("--hh", HH + "px");

  const evs = m.fixed.filter((e) => e.weeks.has(S.week));

  const thead = document.createElement("div");
  thead.className = "thead";
  const corner = document.createElement("div");
  corner.className = "corner";
  corner.textContent = "节次 / 时间";
  thead.appendChild(corner);
  for (let d = 1; d <= 7; d++) {
    const c = document.createElement("div");
    const isToday = d === tWd;
    c.className = "day" + (isToday ? " today" : "") + (d > 5 ? " weekend" : "");
    const dn = document.createElement("span"); dn.textContent = WD[d - 1];
    const dot = document.createElement("i"); dot.className = "dot";
    const sm = document.createElement("small");
    const dm = dayDateStr(S.week, d);
    if (dm) sm.textContent = dm + (isToday ? " · 今天" : "");
    c.append(dot, dn, sm);
    thead.appendChild(c);
  }

  const trows = document.createElement("div");
  trows.className = "trows";
  const tcol = document.createElement("div");
  tcol.className = "tcol";
  const cp = showingToday ? currentPeriod() : null;   // 正在上第几节(可能 null)
  for (let p = 1; p <= N; p++) {
    const pc = document.createElement("div");
    pc.className = "pcell" + (p === cp ? " curband" : "");
    pc.style.height = HH + "px";
    const num = document.createElement("div"); num.className = "num";
    num.textContent = p + (p === cp && window.innerWidth > 820 ? " 现在" : "");
    const tm = document.createElement("div"); tm.className = "tm";
    tm.textContent = S.times[p - 1] || "";
    pc.append(num, tm);
    tcol.appendChild(pc);
  }
  trows.appendChild(tcol);

  const blank = (d, isToday) => {
    const col = document.createElement("div");
    col.className = "dcol" + (isToday ? " hl" : "") + (d > 5 ? " weekend" : "");
    col.style.height = N * HH + "px";
    col.style.backgroundImage = `repeating-linear-gradient(to bottom, transparent 0 ${HH - 1}px, var(--line) ${HH - 1}px, var(--line) ${HH}px)`;
    /* 点击空白区域 -> 以该列/该节为默认打开"手动添加" */
    col.addEventListener("click", (ev) => {
      if (ev.target !== col) return;
      const y = ev.offsetY;
      let p = Math.floor(y / HH) + 1;
      if (p < 1) p = 1;
      if (p > N) p = N;
      openManualModal({ day: d, p });
    });
    return col;
  };

  const manList = getManual(S.sessionId);
  for (let d = 1; d <= 7; d++) {
    const isToday = d === tWd;
    const col = blank(d, isToday);
    const dayEvs = evs.filter((e) => e.weekDay === d);
    manList.forEach((x) => { if (x.day === d && manualShows(x, S.week, m.termWeeks)) dayEvs.push(toManualEv(x)); });
    dayEvs.sort((a, b) => a.per.min - b.per.min || b.per.max - a.per.max);
    layout(dayEvs, N, HH).forEach((pl) => col.appendChild(makeEv(pl, isToday && cp != null)));
    trows.appendChild(col);
  }
  sheet.append(thead, trows);
  renderMobileSchedule(m, evs, manList, cp, tWd);
}
function layout(evs, N, HH) {
  const sorted = [...evs].sort((a, b) => a.per.min - b.per.min || b.per.max - a.per.max);
  const clusters = [];
  let cluster = [];
  let clusterEnd = -1;
  for (const e of sorted) {
    if (cluster.length && e.per.min > clusterEnd) {
      clusters.push(cluster);
      cluster = [];
      clusterEnd = -1;
    }
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.per.max);
  }
  if (cluster.length) clusters.push(cluster);

  const out = [];
  for (const items of clusters) {
    const laneEnd = [];
    const assigned = items.map((e) => {
      let lane = laneEnd.findIndex((end) => end < e.per.min);
      if (lane < 0) { lane = laneEnd.length; laneEnd.push(-1); }
      laneEnd[lane] = e.per.max;
      return lane;
    });
    const lanes = Math.max(1, laneEnd.length);
    if (lanes >= 3) {
      const min = Math.min(...items.map((e) => e.per.min));
      const max = Math.max(...items.map((e) => e.per.max));
      out.push({
        e: items[0], group: items, top: (min - 1) * HH,
        height: (max - min + 1) * HH - 2, left: 0, width: 100,
        n: lanes, conflict: true,
      });
      continue;
    }
    items.forEach((e, i) => out.push({
      e,
      top: (e.per.min - 1) * HH,
      height: (e.per.max - e.per.min + 1) * HH - 2,
      left: lanes > 1 ? (assigned[i] * 100) / lanes : 0,
      width: lanes > 1 ? 100 / lanes : 100,
      n: lanes,
      conflict: lanes > 1,
    }));
  }
  return out;
}
function makeEv(pl, inToday) {
  const { e, top, height, left, width } = pl;
  const man = e.manual;
  const col = man ? PALETTE[manualColorIdx(man)] : colorOf(e.key);
  const div = document.createElement("button");
  div.type = "button";
  div.className = "ev" + (man ? " manual" : "") + (pl.conflict ? " conflict" : "");
  div.style.top = top + "px";
  div.style.height = height + "px";
  div.style.left = left + "%";
  div.style.width = width + "%";
  div.style.background = man ? tint(col, 0.10) : tint(col, 0.16);
  div.style.borderColor = col;
  div.style.color = "#1b2330";
  if (inToday) div.style.boxShadow = `0 0 0 1.5px var(--accent), 0 3px 8px rgba(20,30,60,.18)`;

  if (pl.group) {
    div.classList.add("conflict-group");
    div.setAttribute("aria-label", `${pl.group.length} 门课程时间冲突，查看全部`);
    div.innerHTML = `<span class="conflict-count">${pl.group.length} 门课时间冲突</span>` +
      `<span class="nm">${pl.group.map((item) => esc(item.name)).join(" · ")}</span>` +
      `<span class="te">点击查看全部安排</span>`;
    div.onclick = (ev) => { ev.stopPropagation(); openConflictGroup(pl.group); };
    return div;
  }

  const clock = clockRange(e.per.min, e.per.max);
  let inner;
  if (man) {
    const meta = [];
    if (man.loc) meta.push(man.loc);
    if (man.note) meta.push(man.note);
    inner =
      `<span class="nm">${esc(e.name)}</span>` +
      `<span class="mk">${KIND_LABEL[man.kind] || "事项"} · ${manualWeeksLabel(man)}</span>` +
      (meta.length ? `<span class="te">${esc(meta.join(" · "))}</span>` : "");
    div.title = `${KIND_LABEL[man.kind] || "手动"}：${e.name}\n${WD[e.weekDay - 1]} ${periodLabel(e.per.min, e.per.max)} ${clock ? "(" + clock + ")" : ""} ${manualWeeksLabel(man)}${man.loc ? "\n" + man.loc : ""}${man.note ? "\n" + man.note : ""}\n点击编辑 / 删除`;
    div.onclick = (ev) => { ev.stopPropagation(); openManualModal({ editId: man.id }); };
  } else {
    const roomBit = [e.campus, e.room].filter(Boolean).join(" · ");
    const meta = [];
    if (roomBit) meta.push(roomBit);
    if (e.instr) meta.push(e.instr);
    inner =
      `<span class="nm">${esc(e.name)}</span>` +
      (meta.length ? `<span class="rm">${esc(meta.join(" · "))}</span>` : "") +
      `<span class="te">${esc(periodLabel(e.per.min, e.per.max))}${clock ? " " + esc(clock) : ""} · 第${esc(e.weeksTxt || "—")}周</span>`;
    div.title = `${e.name}\n${e.classNbr}\n第${e.weeksTxt}周 ${WD[e.weekDay - 1]} ${periodLabel(e.per.min, e.per.max)}\n${roomBit || "无教室"}\n老师: ${e.instr || "-"}`;
    div.onclick = (ev) => { ev.stopPropagation(); openDetail(e.key); };
  }
  div.innerHTML = inner;
  return div;
}

function eventsOverlap(a, b) {
  return a !== b && a.per.min <= b.per.max && b.per.min <= a.per.max;
}
function renderMobileSchedule(m, fixedEvents, manualItems, current, todayColumn) {
  const root = $("mobileSchedule");
  if (!root) return;
  const allByDay = new Map();
  for (let day = 1; day <= 7; day++) allByDay.set(day, []);
  fixedEvents.forEach((e) => allByDay.get(e.weekDay).push(e));
  manualItems.forEach((item) => {
    if (manualShows(item, S.week, m.termWeeks)) allByDay.get(item.day).push(toManualEv(item));
  });
  for (const events of allByDay.values()) events.sort((a, b) => a.per.min - b.per.min || a.per.max - b.per.max);

  if (!S.mobileDay || S.mobileDay < 1 || S.mobileDay > 7) S.mobileDay = todayColumn > 0 ? todayColumn : 1;
  const activeDay = S.mobileDay;
  const activeEvents = allByDay.get(activeDay);
  const date = dayDateStr(S.week, activeDay);
  const isToday = activeDay === todayColumn;

  const days = Array.from({ length: 7 }, (_, index) => {
    const day = index + 1;
    const count = allByDay.get(day).length;
    return `<button type="button" role="tab" class="mobile-day${day === activeDay ? " selected" : ""}${day === todayColumn ? " today" : ""}" data-mobile-day="${day}" aria-selected="${day === activeDay}" aria-controls="mobileDayPanel" tabindex="${day === activeDay ? 0 : -1}" aria-label="${WD[index]}${count ? `，${count}项` : "，无课"}">` +
      `<span>${WD[index].slice(1)}</span><b>${dayDateStr(S.week, day) || day}</b><i>${count || ""}</i></button>`;
  }).join("");

  const rows = activeEvents.map((e) => {
    const manual = e.manual;
    const color = manual ? PALETTE[manualColorIdx(manual)] : colorOf(e.key);
    const conflict = activeEvents.some((other) => eventsOverlap(e, other));
    const going = isToday && current != null && e.per.min <= current && e.per.max >= current;
    const room = manual ? (manual.loc || "") : [e.campus, e.room].filter(Boolean).join(" · ");
    const teacher = manual ? (manual.note || "") : e.instr;
    const meta = [room, teacher].filter(Boolean).join(" · ") || "地点待定";
    const time = clockRange(e.per.min, e.per.max);
    return `<button type="button" class="mobile-course${going ? " going" : ""}" data-course-key="${esc(e.key)}" data-manual-id="${manual ? esc(manual.id) : ""}" style="--course:${color};--course-soft:${tint(color, .12)}">` +
      `<span class="mobile-course-time"><b>${esc(periodLabel(e.per.min, e.per.max))}</b><small>${esc(time)}</small></span>` +
      `<span class="mobile-course-body"><strong>${esc(e.name)}</strong><span>${esc(meta)}</span>` +
      `<span class="mobile-course-tags">${going ? "<em>正在上课</em>" : ""}${conflict ? "<em class=\"conflict-tag\">时间冲突</em>" : ""}${manual ? `<em>${esc(KIND_LABEL[manual.kind] || "手动")}</em>` : ""}</span></span>` +
      `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>`;
  }).join("");

  root.innerHTML = `<div class="mobile-days" role="tablist" aria-label="选择星期">${days}</div>` +
    `<div class="mobile-day-summary"><div><strong>${isToday ? "今天 · " : ""}${WD[activeDay - 1]}</strong><span>${date ? date + " · " : ""}第 ${S.week} 周</span></div>` +
    `<b>${activeEvents.length ? activeEvents.length + " 项" : "无课"}</b></div>` +
    `<div class="mobile-course-list" id="mobileDayPanel" role="tabpanel">${rows || `<button type="button" class="mobile-empty-add" id="mobileEmptyAdd"><span>这一天没有课程</span><b>添加一项</b></button>`}</div>`;

  root.querySelectorAll("[data-mobile-day]").forEach((button) => {
    button.onclick = () => { S.mobileDay = +button.dataset.mobileDay; renderSheet(); };
    button.onkeydown = (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      S.mobileDay = Math.max(1, Math.min(7, S.mobileDay + (event.key === "ArrowRight" ? 1 : -1)));
      renderSheet();
      root.querySelector(`[data-mobile-day="${S.mobileDay}"]`)?.focus();
    };
  });
  root.querySelectorAll(".mobile-course").forEach((button) => {
    button.onclick = () => {
      if (button.dataset.manualId) openManualModal({ editId: button.dataset.manualId });
      else openDetail(button.dataset.courseKey);
    };
  });
  const emptyAdd = $("mobileEmptyAdd");
  if (emptyAdd) emptyAdd.onclick = () => openManualModal({ day: activeDay, p: 1 });

  if (!root._swipeBound) {
    let touchStart = 0;
    root.addEventListener("touchstart", (event) => { touchStart = event.changedTouches[0].clientX; }, { passive: true });
    root.addEventListener("touchend", (event) => {
      const delta = event.changedTouches[0].clientX - touchStart;
      if (Math.abs(delta) < 55) return;
      S.mobileDay = Math.max(1, Math.min(7, S.mobileDay + (delta < 0 ? 1 : -1)));
      renderSheet();
    }, { passive: true });
    root._swipeBound = true;
  }
}
function renderOnline() {
  const m = S.models.get(S.sessionId);
  const panel = $("onlinePanel"), chips = $("onlineChips");
  chips.innerHTML = "";
  if (!m || !m.online.length) { panel.hidden = true; return; }
  panel.hidden = false;
  for (const e of m.online) {
    const col = colorOf(e.key);
    const c = document.createElement("button");
    c.type = "button";
    c.className = "chip";
    c.innerHTML = `<span class="cd" style="background:${col}"></span>` +
      `<span><b>${esc(e.name)}</b></span>` +
      `<span class="mi">线上 第${esc(e.weeksTxt || "—")}周 · ${esc(e.credit || "?")}学分` +
      (e.instr ? ` · ${esc(e.instr)}` : "") + `</span>`;
    c.onclick = () => openDetail(e.key);
    chips.appendChild(c);
  }
}

/* ---------------- 今日视图 (FR-4.2) ---------------- */
function renderToday() {
  const head = $("todayHead");
  const curOn = !!(S.curWeek && S.activeId);           // 有"当前周"概念才谈今日
  $("thDate").textContent = todayText() + (curOn ? ` · 第 ${S.curWeek} 周` : "");

  // 只在激活学期 + 知道当前周时, 今日才有真实意义
  if (!curOn) {
    $("thMeta").textContent = "尚未确认当前教学周(教务接口暂不可用), 无法判断今天该上什么课。";
    $("nextCard").innerHTML = "";
    $("dayRows").innerHTML = blankState("info", "当前周未知，晚点再试或点右上角“刷新”");
    $("daySrc").textContent = "";
    return;
  }

  const m = S.models.get(S.activeId);
  const isActiveTerm = S.sessionId === S.activeId;
  $("daySrc").textContent = isActiveTerm ? "（当前学期）" : "（来自当前学期）";
  if (!m) {
    $("thMeta").textContent = "正在拉取当前学期课表…";
    $("nextCard").innerHTML = "";
    $("dayRows").innerHTML = blankState("loading", "加载中…");
    return;
  }
  $("thMeta").textContent = `教务当前周第 ${S.curWeek} 周 · 周课表现停留在第 ${S.week} 周` +
    (isActiveTerm ? "" : "（你正查看的是历史学期，今日始终以当前学期为准）");

  const w = todayWd();
  const nm = nowMin();
  const cp = currentPeriod(nm);          // 现在第几节(null=课间)
  const cpHint = cp ? `现在第 ${cp} 节 ${S.times[cp - 1]}` : "现在课间休息";

  const evs = m.fixed.filter((e) => e.weekDay === w && e.weeks.has(S.curWeek))
    .sort((a, b) => a.per.min - b.per.min || b.per.max - a.per.max);

  // ---- 状态: 进行中 / 未到 / 已过 ----
  const rows = evs.map((e) => {
    const s = evStartMin(e), en = evEndMin(e);
    const st = (nm >= s && nm < en) ? "going" : (nm < s ? "todo" : "done");
    return { e, s, en, st };
  });

  // ---- 置顶卡片: 进行中课程 > 下一节课 > 今日已结束 / 今天没课 ----
  const going = rows.filter((r) => r.st === "going");
  const next = rows.find((r) => r.st === "todo");
  let card = "";
  const col = (e) => colorOf(e.key);
  if (going.length) {
    const g = going[0];
    card = nextCard(g.e, "正在上", `直到 ${minHm(g.en)} 结束`, col(g.e), true);
  } else if (next) {
    card = nextCard(next.e, "下一节课", `${minHm(next.s)} 开始 · ${next.e.room || "无教室"}`, col(next.e), false);
  } else if (evs.length) {
    card = `<div class="nextcard end"><span class="state-icon">${STATUS_ICON.done}</span>今天的课都已结束</div>`;
  } else {
    card = `<div class="nextcard none"><span class="state-icon">${STATUS_ICON.free}</span>今天没课，可以安排自己的事</div>`;
  }
  $("nextCard").innerHTML = card;
  $("nextCard").querySelector("[data-next-course]")?.addEventListener("click", (event) => {
    openDetail(event.currentTarget.dataset.nextCourse);
  });

  // ---- 今日课程列表 ----
  const wrap = $("dayRows");
  wrap.innerHTML = "";
  if (!rows.length) {
    wrap.innerHTML = blankState("free", `今天（第 ${S.curWeek} 周）没有固定排课`);
  } else {
    rows.forEach((r) => {
      const { e, s, en, st } = r;
      const div = document.createElement("button");
      div.type = "button";
      div.className = "dayrow" + (st === "going" ? " going" : st === "done" ? " done" : "");
      const badge = { going: "进行中", todo: "未到", done: "已过" }[st];
      div.innerHTML =
        `<div class="dr-time"><b>${periodLabel(e.per.min, e.per.max)}</b><span>${clockRange(e.per.min, e.per.max)}</span></div>` +
        `<div class="dr-main">` +
        `<div class="dr-name"><span class="dotc" style="background:${colorOf(e.key)}"></span>${esc(e.name)}` +
        `<span class="dr-badge ${st}">${badge}</span></div>` +
        `<div class="dr-sub">${esc([e.campus, e.room].filter(Boolean).join(" · ") || "无教室")}${e.instr ? " · " + esc(e.instr) : ""}</div>` +
        `</div>` +
        `<div class="dr-go">${esc(e.weeksTxt || "")} 周</div>`;
      div.onclick = () => openDetail(e.key);
      wrap.appendChild(div);
    });
  }
  // 时间实时提示(放列表末尾小字)
  const tick = document.createElement("div");
  tick.className = "live-now";
  tick.innerHTML = `${minHm(nm)} ${cpHint}`;
  wrap.appendChild(tick);
}
function nextCard(e, tag, sub, col, going) {
  return `<button type="button" class="nextcard ${going ? "going" : ""}" data-next-course="${esc(e.key)}">` +
    `<div class="nc-tag">${tag}</div>` +
    `<div class="nc-body"><div class="nc-name"><span class="dotc" style="background:${col}"></span>${esc(e.name)}</div>` +
    `<div class="nc-sub">${esc(sub)} · ${esc([e.campus, e.room].filter(Boolean).join(" ") || "无教室")} · 第${esc(e.weeksTxt)}周</div></div>` +
    `<div class="nc-more">详情 <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></div></button>`;
}

let activeDialog = null;
let dialogReturnFocus = null;
function setPageInert(inert) {
  document.querySelectorAll("body > header, body > nav, body > main").forEach((node) => {
    node.inert = inert;
    if (inert) node.setAttribute("aria-hidden", "true");
    else node.removeAttribute("aria-hidden");
  });
}
function showDialog(container, preferredFocus) {
  dialogReturnFocus = document.activeElement;
  container.hidden = false;
  activeDialog = container;
  setPageInert(true);
  requestAnimationFrame(() => (preferredFocus || container.querySelector("[role=dialog]") || container).focus());
}
function closeDialog(container) {
  if (!container) return;
  container.hidden = true;
  if (container.id === "installSheet") {
    $("installBackdrop").hidden = true;
    localStorage.setItem("kbt-install-dismissed", "1");
  }
  if (container.id === "addMask") S._editing = null;
  if (activeDialog === container) activeDialog = null;
  setPageInert(false);
  if (dialogReturnFocus && document.contains(dialogReturnFocus)) dialogReturnFocus.focus();
  dialogReturnFocus = null;
}
function dialogFocusable(container) {
  return [...container.querySelectorAll('button:not([disabled]):not([hidden]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    .filter((node) => !node.closest("[hidden]"));
}

/* ---------------- 课程详情 ---------------- */
function openDetail(key) {
  const m = S.models.get(S.sessionId) || S.models.get(S.activeId);
  if (!m) return;
  const fixed = m.fixed.filter((e) => e.key === key);
  const online = m.online.filter((e) => e.key === key);
  const src = fixed[0] || online[0];
  const c = m.courses.get(key);
  if (!src) return;
  const col = colorOf(key);
  const ks = [];
  const pair = (k, v) => ks.push(`<div class="kv"><span class="k">${k}</span><span class="v">${esc(v || "-")}</span></div>`);
  pair("课程", c.code && c.classNbr ? `${c.code} / ${c.classNbr}` : c.classNbr || c.code);
  pair("学分", c.credit);
  pair("开课院系", c.dept);
  pair("校区", [...c.campi].join("、") || "—");
  pair("任课老师", [...c.instrs].join("、") || "—");
  let slots = "";
  fixed.sort((a, b) => a.weekDay - b.weekDay || a.per.min - b.per.min)
    .forEach((e) => {
      const clk = clockRange(e.per.min, e.per.max);
      const room = [e.campus, e.room].filter(Boolean).join(" · ");
      slots += `<li><b>${WD[e.weekDay - 1]} ${periodLabel(e.per.min, e.per.max)}</b>` +
        (clk ? ` <span class="sd">${clk}</span>` : "") +
        `　第 ${esc(e.weeksTxt)} 周　${esc(room || "无教室")}</li>`;
    });
  online.forEach((e) => {
    slots += `<li class="on"><b>线上自学</b>　第 ${esc(e.weeksTxt)} 周` +
      (e.instr ? `　老师 ${esc(e.instr)}` : "") + `（无固定时间/教室）</li>`;
  });
  $("detailBody").innerHTML =
    `<div class="dhead">` +
    `<span class="cd" style="width:14px;height:14px;border-radius:4px;background:${col};display:inline-block"></span>` +
    `<span class="dname">${esc(src.name)}</span>` +
    (src.classNbr ? `<span class="dtag">${esc(src.classNbr)}</span>` : "") +
    (online.length ? `<span class="dtag" style="background:#fff1dc;color:var(--warn)">含线上</span>` : "") +
    `</div>` +
    `<div class="ks">${ks.join("")}</div>` +
    `<div class="h3">上课安排</div>` +
    (slots ? `<ul class="slots">${slots}</ul>` : `<div class="dim">该课程暂无固定排课</div>`);
  showDialog($("detailMask"));
}

function openConflictGroup(items) {
  const list = items.map((item) => {
    const room = [item.campus, item.room].filter(Boolean).join(" · ") || "无教室";
    return `<button type="button" class="conflict-choice" data-conflict-key="${esc(item.key)}">` +
      `<span><b>${esc(item.name)}</b><small>${esc(periodLabel(item.per.min, item.per.max))} · ${esc(room)}</small></span>` +
      `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>`;
  }).join("");
  $("detailBody").innerHTML = `<div class="dhead"><span class="dname">时间冲突</span><span class="dtag">${items.length} 门课</span></div>` +
    `<p class="dim">这些课程占用了相同节次，已全部保留。选择一门查看完整信息。</p><div class="conflict-list">${list}</div>`;
  $("detailBody").querySelectorAll("[data-conflict-key]").forEach((button) => {
    button.onclick = () => openDetail(button.dataset.conflictKey);
  });
  showDialog($("detailMask"));
}

/* ---------------- 手动添加 / 编辑 弹窗 ---------------- */
function fillSelect(sel, n, prefix, val, label) {
  sel.innerHTML = "";
  for (let i = 1; i <= n; i++) {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = (label ? label(i) : (prefix || "") + i);
    sel.appendChild(o);
  }
  if (val != null) sel.value = val;
}
function maxGridPeriod() {
  const m = S.models.get(S.sessionId);
  const byTerm = Math.max(8, m ? m.maxPeriod : 8);
  const byTimes = Math.min(14, S.times.filter(Boolean).length);   // 作息表有几节就能加到几节
  return Math.max(byTerm, byTimes);
}
function openManualModal({ day, p, editId } = {}) {
  const arr = getManual(S.sessionId);
  let x = editId != null ? arr.find((y) => y.id === editId) : null;
  S._editing = x ? x.id : null;

  $("addTitle").textContent = x ? "编辑手动项" : "手动添加";
  $("addHint").innerHTML = x
    ? `正在修改「${esc(x.title || "")}」—— 保存后当周课表即更新。`
    : `在 ${WD[(day || todayWd()) - 1]} 的空白处补一门课或一个任务；也可自己改星期 / 节次 / 周次。`;

  fillSelect($("mfDay"), 7, "", x ? x.day : (day || todayWd()), (i) => WD[i - 1]);
  const N = maxGridPeriod();
  const st = x ? x.pStart : (p || 1);
  const en = x ? x.pEnd : Math.max(st, p || st);
  fillSelect($("mfStart"), N, "第 ", st);
  fillSelect($("mfEnd"), N, "第 ", Math.max(st, en));
  if (x) { $("mfStart").value = st; $("mfEnd").value = Math.max(st, en); }

  $("mfKind").value = x ? x.kind : "course";
  $("mfTitle").value = x ? x.title : "";
  $("mfWeeks").value = x ? x.weeksTxt : "";
  $("mfLoc").value = x ? x.loc : "";
  $("mfNote").value = x ? x.note : "";
  $("mfMaxW").textContent = S.maxTerm;
  $("mfDel").hidden = !x;
  showDialog($("addMask"), $("mfTitle"));
}
function closeManualModal() { closeDialog($("addMask")); }
function readManualForm() {
  const st = +$("mfStart").value, en = Math.max(+$("mfEnd").value, st);
  return {
    id: S._editing, title: $("mfTitle").value.trim(),
    kind: $("mfKind").value, day: +$("mfDay").value,
    pStart: st, pEnd: en, weeksTxt: $("mfWeeks").value.trim(),
    loc: $("mfLoc").value.trim(), note: $("mfNote").value.trim(),
  };
}
function saveManualModal() {
  const arr = getManual(S.sessionId);
  const d = readManualForm();
  if (!d.title) { toast("名称 / 事项不能为空", true); return; }
  /* 周次语法简单校验: 空 或 能被 parseWeeks 解析出至少一个周 */
  if (d.weeksTxt) {
    const w = parseWeeks({ teachingWeekFormat: d.weeksTxt });
    if (!w.size) { toast("周次格式不对：留空=每周，或写 1-16 / 1,3,5 / 8", true); return; }
  }
  if (S._editing) {
    const i = arr.findIndex((y) => y.id === S._editing);
    if (i >= 0) arr[i] = Object.assign({}, arr[i], d, { colorIdx: arr[i].colorIdx });
    toast("已更新");
  } else {
    const x = Object.assign({}, d, {
      id: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      colorIdx: arr.length % PALETTE.length,
    });
    arr.push(x);
    toast(`已添加「${x.title}」`);
  }
  saveManual(S.sessionId);
  S._editing = null;
  closeDialog($("addMask"));
  renderAll();
  if (S.tab === "today") setTab("week");   // 编辑发生在周课表上
}
function deleteManualModal() {
  const arr = getManual(S.sessionId);
  const id = S._editing;
  if (!id) return;
  const x = arr.find((y) => y.id === id);
  const i = arr.findIndex((y) => y.id === id);
  if (i >= 0) { arr.splice(i, 1); saveManual(S.sessionId); }
  S._editing = null;
  closeDialog($("addMask"));
  toast(`已删除「${x ? x.title : ""}」`);
  renderAll();
}

/* ---------------- 拉取学期数据(带本地缓存 FR-5) ---------------- */
async function loadTerm(sessionId, { force } = {}) {
  S.sessionId = sessionId;
  const sel = $("semSel");
  if (sel) sel.value = sessionId;

  // 1) 内存有模型(本次会话已加载过) → 直接渲染
  if (S.models.has(sessionId)) { applyWeekDefault(sessionId); renderAll(); }
  // 2) 本地缓存该学期行 → 秒开先渲染, 再后台刷新
  else {
    const cached = cacheLoadRows(sessionId);
    if (cached && cached.length) {
      S.models.set(sessionId, buildModel(cached));
      applyWeekDefault(sessionId);
      renderAll();
    } else {
      $("sheet").innerHTML = blankState("loading", "正在拉取该学期课表…");
    }
  }

  // 3) 网络刷新: 强制 / 无缓存 / 距上次抓取超过冷却期
  const last = +(localStorage.getItem(LS.lastFetch + sessionId) || 0);
  const shouldFetch = force || !S.models.get(sessionId) || (Date.now() - last) > REFRESH_COOLDOWN;
  if (!shouldFetch) return;

  const m0 = S.models.get(sessionId);
  let d;
  try {
    d = await api("/api/timetable?session=" + encodeURIComponent(sessionId) + (force ? "&refresh=1" : ""));
  } catch (err) {
    d = { ok: false, msg: "无法连接后端（离线？）" };
  }
  if (d.needLogin) return showLoginNeed(d);
  if (!d.ok) {
    if (m0 && m0.fixed.length) {
      toast(`离线显示缓存（${d.msg || "网络/服务暂不可用"}）`, true);
      $("timeHint").textContent = "当前显示本地缓存课表，在线刷新失败。点右上角「刷新」重试。";
    } else {
      showError(d.msg || "拉取失败");
    }
    return;
  }
  const m = buildModel(d.rows || []);
  S.models.set(sessionId, m);
  cacheSaveRows(sessionId, d.rows || []);
  S.account = d.account || S.account;
  if (sessionId === S.activeId && !S.sessions.length) S.sessions = [{ sessionId, active: true }];
  applyWeekDefault(sessionId);
  renderAll();
  const sem = (S.sessions.find((x) => x.sessionId === sessionId) || {}).yearAndTerm || "";
  const src = S.timesAuto ? "教务官方作息" : "内置兜底作息(官方接口暂不可用)";
  $("timeHint").textContent =
    `正在查看 ${S.account || ""} · ${sem || ""} 第 ${S.week} 周 / 共 ${S.maxTerm} 周 · 时间列来自${src}` +
    (S.curWeek && sessionId === S.activeId ? ` · 教务当前周 第 ${S.curWeek} 周` : "") +
    `。格子显示 教室/老师 · 第几周; 单击格子弹窗看全信息。`;
}
function applyWeekDefault(sessionId) {
  const m = S.models.get(sessionId);
  if (!m) return;
  S.maxTerm = m.termWeeks;
  if (sessionId === S.activeId && S.curWeek) S.week = clampW(S.curWeek);
  else if (!S.week || S.week > S.maxTerm) S.week = 1;
}
function clampW(w) {
  return Math.max(1, Math.min(+w || 1, S.maxTerm || 20));
}
function setWeek(w) {
  S.week = clampW(w);
  renderAll();
}
function showLoginNeed(d) {
  $("acct").textContent = "未登录";
  if (NATIVE) {
    if (WEB_DIRECT) {
      $("authGate").hidden = false;
      $("authMessage").textContent = "登录后自动整理你的个人课表";
      return;
    }
    $("sheet").innerHTML = `<div class="blank"><div class="big">${STATUS_ICON.key}</div>尚未登录教务账号` +
      `<div class="errband">本机登录信息已清空(退出完成)。点下方按钮，用官方登录页登录/换账号。</div>` +
      `<div class="fbtns" style="justify-content:center;margin-top:14px">` +
      `<button class="primary" id="goLoginBtn">去官方登录页</button></div></div>`;
    const b = $("goLoginBtn");
    if (b) b.onclick = () => {
      const A = _A();
      try {
        if (A && A.relogin) A.relogin();                    // 非阻塞弹官方登录页, 成功原生自动刷新
        else if (A && A.ensureToken) {
          Promise.resolve(A.ensureToken()).then((t) => { if (t) location.reload(); });
        }
      } catch (e) { }
    };
    return;
  }
  $("sheet").innerHTML = `<div class="blank"><div class="big">${STATUS_ICON.key}</div>需要先登录教务 (${esc(d.account || "")})` +
    `<div class="errband">后端本地 token 已失效。请在 抢课脚本 目录重刷 token 后再刷新本页：<br>` +
    `cd E:\\software\\抢课脚本 &amp;&amp; python login_537_wait.py</div></div>`;
}
function showError(msg) {
  $("sheet").innerHTML = blankState("warning", esc(msg));
  if ($("mobileSchedule")) $("mobileSchedule").innerHTML = `<div class="mobile-empty">${esc(msg)}</div>`;
  if (S.tab === "today") $("dayRows").innerHTML = blankState("warning", esc(msg));
}

/* ---------------- Tab 切换 ---------------- */
function setTab(t) {
  S.tab = t;
  const on = t === "week";
  $("tabWeek").classList.toggle("on", on);
  $("tabToday").classList.toggle("on", !on);
  $("tabWeek").setAttribute("aria-selected", String(on));
  $("tabToday").setAttribute("aria-selected", String(!on));
  $("tabWeek").tabIndex = on ? 0 : -1;
  $("tabToday").tabIndex = on ? -1 : 0;
  $("paneWeek").hidden = !on;
  $("paneToday").hidden = on;
  renderAll();
}

/* ---------------- 账号中心 (👤 我的 / 账号) ----------------
 * APK 里: 显示当前学号、清理本地缓存、退出并回到官方登录页换账号;
 * Web 原型: 只读展示(登录由本机 server.py 代管, 不提供退出)。
 */
function localBytes() {
  let n = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf("kbt-") === 0) n += (k.length + String(localStorage.getItem(k) || "").length) * 2;
    }
  } catch (e) { }
  return n;
}
function fmtBytes(n) {
  return n < 1024 ? n + " B" : (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB";
}
/* 清掉所有 kbt-* 缓存键(学期/课表/手动项), 不动账号 token */
function wipeLocal() {
  const ks = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf("kbt-") === 0) ks.push(k);
    }
  } catch (e) { }
  ks.forEach((k) => { try { localStorage.removeItem(k); } catch (e) { } });
}
function acctUserText() {
  if (NATIVE) return jwtSub(_bearer()) || S.account || "未登录";
  return S.account || "（本机后端代登录）";
}
function openAccount() {
  $("acctUser").textContent = acctUserText();
  $("acctMode").textContent = NATIVE ? "直连教务 · 官方账号登录" : "Web 原型 · server.py 代登录";
  $("acctSize").textContent = fmtBytes(localBytes());
  const log = $("acctLogout");
  log.hidden = !NATIVE;
  log.classList.remove("armed");
  log.textContent = "退出并更换账号";
  $("acctTip").textContent = NATIVE
    ? "账号密码在教务官方登录页输入，本机只存约 7 天有效的 token，过期自动静默续期。"
    : "本地缓存=最近学期的课表，供断网时秒开；清除后下次打开会自动从教务重新拉取。";
  showDialog($("acctMask"));
}
function clearCacheAccount() {
  wipeLocal();
  $("acctSize").textContent = fmtBytes(localBytes());
  toast("已清除本地缓存，下次打开自动重新拉取");
}
function logoutAccount() {
  const btn = $("acctLogout");
  if (!btn.classList.contains("armed")) {           // 防误触: 点两次才真退
    btn.classList.add("armed");
    btn.textContent = "再次点击，确认退出";
    setTimeout(() => {
      btn.classList.remove("armed");
      btn.textContent = "退出并更换账号";
    }, 3500);
    return;
  }
  const A = _A();
  let done = Promise.resolve();
  try { if (A && A.logout) done = Promise.resolve(A.logout()); } catch (e) { }
  // A.logout() 原生侧: 清 token + 官方 CAS cookie(没有它, 换号会被 SSO 静默登回原号)
  _tok = null;
  S.account = null;
  wipeLocal();
  done.finally(() => location.reload()); // iOS 等原生异步清理完再重载
}

/* ---------------- 启动 ---------------- */
async function init() {
  await handleWebOAuthCallback();
  if (NATIVE) {                       // App 壳里的小调整
    const b = document.querySelector(".badge");
    if (b) b.textContent = "直连教务";
    document.title = "cqie课表";
  }
  measureHeights();
  bindUI();
  applyMeta(cacheLoadMeta());          // 先用上次会话缓存(有则秒开, 无网也能用)

  // 学期下拉(离线也能列出缓存的学期)
  const sel = $("semSel");
  const paintSem = () => {
    sel.innerHTML = "";
    S.sessions.forEach((s) => {
      const o = document.createElement("option");
      o.value = s.sessionId;
      o.textContent = s.yearAndTerm + (s.active ? "（当前）" : "");
      sel.appendChild(o);
    });
  };
  paintSem();
  if (S.account) $("acct").textContent = `账号 ${S.account}`;

  // 尽快先渲染一次缓存里的当前学期(真正秒开)
  const act0 = S.sessions.find((s) => s.active) || S.sessions[0];
  if (act0) {
    S.sessionId = act0.sessionId;
    if (!S.models.has(act0.sessionId)) {
      const cached = cacheLoadRows(act0.sessionId);
      if (cached && cached.length) S.models.set(act0.sessionId, buildModel(cached));
    }
    if (S.models.has(act0.sessionId)) { applyWeekDefault(act0.sessionId); renderAll(); }
    else { $("sheet").innerHTML = blankState("loading", "首次打开，正在从教务拉取…"); }
  }

  // 在线: 拉状态 + 学期 + 当前周 + 作息, 覆盖上面的缓存
  try {
    const [st, sd, cw, tm] = await Promise.all([
      api("/api/state"), api("/api/sessions"), api("/api/curweek"), api("/api/times"),
    ]);
    if (st.ok && st.account) S.account = st.account;
    if (sd.needLogin) return showLoginNeed(sd);
    if (!sd.ok) throw new Error(sd.msg || "获取学期列表失败");

    S.sessions = sd.sessions || [];
    const act = S.sessions.find((s) => s.active) || S.sessions[0];
    if (act) S.activeId = act.sessionId;
    paintSem();

    if (cw && cw.ok && cw.week >= 1 && cw.week <= 60) {
      S.curWeek = cw.week;
      const mon = thisMonday(todayDate()); mon.setDate(mon.getDate() - (S.curWeek - 1) * 7);
      S.baseMonday = mon;
    } else if (cw && !cw.ok) {
      toast("获取当前教学周失败，无法自动定位本周", true);
    }
    applyTimes(tm);

    const pick = act ? act.sessionId : (S.sessions[0] && S.sessions[0].sessionId);
    if (pick) {
      $("timeHint").textContent = S.curWeek != null ? `教务当前周第 ${S.curWeek} 周，正在加载…` : "正在加载课表…";
      await loadTerm(pick, { force: false });
    }
  } catch (e) {
    // 离线: 已有缓存则保持并提示; 否则报错
    const act = act0;
    if (act && S.models.has(act.sessionId)) {
      toast("离线模式：显示已缓存课表（在线刷新失败）", true);
      applyWeekDefault(act.sessionId); renderAll();
    } else {
      showError((e && e.message) || "无法连接后端服务");
    }
  }
  cacheSaveMeta();
  startTick();
  setupInstallPrompt();
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }
}
/* 实测顶栏/Tab条高度, 供 sticky 定位精确对齐 */
function measureHeights() {
  const tb = document.querySelector(".topbar");
  const tab = document.querySelector(".tabbar");
  const d = document.documentElement;
  if (tb) d.style.setProperty("--tbh", tb.offsetHeight + "px");
  if (tab) d.style.setProperty("--tabh", tab.offsetHeight + "px");
}
function applyTimes(tm) {
  if (tm && tm.ok && Array.isArray(tm.times) && tm.times.length) {
    const arr = FALLBACK_TIMES.slice();
    let got = 0;
    tm.times.forEach((x) => {
      if (x && x.start && x.end) { arr[x.period - 1] = x.start + "-" + x.end; got++; }
    });
    if (got) { S.times = arr; S.timesAuto = true; }
  }
}
/* 每 30s 刷新一次"现在几点了"(今日视图 + 周课表当前节次角标) */
function startTick() {
  if (S._tick) return;
  S._tick = setInterval(() => {
    if (document.hidden) return;
    if (S.tab === "today") renderToday();
    else if (isShowingToday()) renderSheet();   // 周课表停在今天时刷新"现在第X节"
  }, 30000);
}
function bindUI() {
  window.addEventListener("resize", measureHeights);
  $("tabWeek").onclick = () => setTab("week");
  $("tabToday").onclick = () => setTab("today");
  document.querySelector(".tabbar").addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = S.tab === "week" ? "today" : "week";
    setTab(next);
    $(next === "week" ? "tabWeek" : "tabToday").focus();
  });
  $("addBtn").onclick = () => openManualModal({ day: todayWd(), p: 1 });
  $("addMask").addEventListener("click", (e) => { if (e.target.id === "addMask") closeDialog(e.target); });
  $("mfStart").onchange = (e) => { const s = +e.target.value; if (+$("mfEnd").value < s) $("mfEnd").value = s; };
  $("mfCancel").onclick = closeManualModal;
  $("mfSave").onclick = saveManualModal;
  $("mfDel").onclick = deleteManualModal;
  $("semSel").onchange = (e) => loadTerm(e.target.value);
  $("prevW").onclick = () => setWeek(S.week - 1);
  $("nextW").onclick = () => setWeek(S.week + 1);
  $("weekIn").onchange = (e) => setWeek(+e.target.value);
  $("todayBtn").onclick = () => { if (S.curWeek && S.sessionId === S.activeId) setWeek(S.curWeek); };
  $("refreshBtn").onclick = () => {
    const sid = S.tab === "today" ? S.activeId : S.sessionId;
    if (sid) loadTerm(sid, { force: true });
  };
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => closeDialog(b.closest(".mask"))));
  $("detailMask").addEventListener("click", (e) => { if (e.target.id === "detailMask") closeDialog(e.target); });
  $("acctMask").addEventListener("click", (e) => { if (e.target.id === "acctMask") closeDialog(e.target); });
  $("acctBtn").onclick = openAccount;
  $("acct").onclick = openAccount;
  $("acctClear").onclick = clearCacheAccount;
  $("acctLogout").onclick = logoutAccount;
  $("authLoginBtn").onclick = () => startWebLogin(false);
  document.addEventListener("keydown", (event) => {
    if (!activeDialog) return;
    if (event.key === "Escape") { event.preventDefault(); closeDialog(activeDialog); return; }
    if (event.key !== "Tab") return;
    const focusable = dialogFocusable(activeDialog);
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function setupInstallPrompt() {
  if (!WEB_DIRECT || isStandalone() || localStorage.getItem("kbt-install-dismissed")) return;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isSafari = /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);
  if (!isIOS || !isSafari || !_bearer()) return;
  const sheet = $("installSheet"), backdrop = $("installBackdrop");
  const close = () => {
    closeDialog(sheet);
    backdrop.hidden = true;
    localStorage.setItem("kbt-install-dismissed", "1");
  };
  setTimeout(() => { backdrop.hidden = false; showDialog(sheet); }, 650);
  $("installClose").onclick = close;
  $("installDone").onclick = close;
  backdrop.onclick = close;
}

init();
