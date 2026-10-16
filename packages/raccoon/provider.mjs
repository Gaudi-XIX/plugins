// magpie plugin: raccoon (商汤小浣熊).
//
// Structure follows @magpie-community/opencode-workbuddy-auth, which is the
// same case: a desktop client whose sign-in is read from where the app keeps
// it. That plugin does two things the first version of this one didn't, and
// that is what the sign-in problem was:
//
//  1. At login it records only a marker (`source: "desktop"`) and reads the
//     app's credential again on every request. An `api` key is a snapshot: it
//     goes stale the moment the client re-logs in and rotates the JWT, which
//     is how a signed-in provider starts answering 401.
//  2. `usage(getAuth)` reads the account's own meter and answers
//     `{ error, signIn: "kept" }` when it can't, so a meter that is
//     unreachable doesn't mark a working account lapsed.
//
// The gateway is raccoon's own: https://xiaohuanxiong.com/api/web/llm/v2 is
// what the client ships in /electron/config/default-llm-config.json as
// `apiBase` — an OpenAI-compatible endpoint that takes the client's login JWT
// as a bearer credential at /chat/completions. It has no /models (404); the
// model list is at /model_catalog, the same one the client's picker reads.

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PROVIDER, SDK, CATALOG_PATH, buildModel, configModels, bootstrapModels } from './models.mjs';

const DEFAULT_BASE = 'https://xiaohuanxiong.com/api/web/llm/v2';
const PATHS = { chat: '/chat/completions' };

// The points and the daily question count are on the office API, a different
// prefix from the gateway — this is what the client's own account page reads.
const DEFAULT_OFFICE = 'https://xiaohuanxiong.com/api/web/office/v3';

// The daily desktop-login points grant is on yet another prefix. The client
// posts here once a day per account after it logs in; the endpoint is
// idempotent (granted=false once the day's points are already in).
const DEFAULT_DESKTOP = 'https://xiaohuanxiong.com/api/web/desktop/v1';
const GRANT_PATH = '/login/points/grant';
const CLIENT_PLATFORM = 'desktop-windows';
// The client sends its own version; the plugin doesn't run the client, so a
// recent known version is sent. Override with options.clientVersion.
const DEFAULT_CLIENT_VERSION = 'v1.0.31';

// Where the desktop client keeps the credential it logged in with. auth.json
// is box-agent's, holding the account signed in now; the leveldb log is the
// Electron app's, and holds one per account the client has signed in to.
// The client is Windows-only as of 1.0.31; on other platforms there is
// nothing to read unless the user points options.desktopFiles at a copy.
function defaultDesktopFiles() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return [
      join(homedir(), '.box-agent', 'config', 'auth.json'),
      join(appData, 'office-raccoon', 'Local Storage', 'leveldb', '000003.log'),
    ];
  }
  return [];
}
const DESKTOP_FILES = defaultDesktopFiles();

const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

function payload(token) {
  try {
    const part = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(part, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

// readDesktop is the client's sign-in as it keeps it now: one entry per
// account, the newest credential kept, an expired one left out. null for
// none. An expired JWT is answered 401, which reads as the account being
// refused rather than the credential having run out — so it isn't a sign-in.
function readDesktop(files) {
  const byAccount = new Map();
  for (const file of files) {
    if (!existsSync(file)) continue;
    let raw;
    try {
      // The leveldb log is mostly not text; read it as both UTF-8 and latin1
      // so a credential stored as UTF-16, or one the running app holds open,
      // is still found.
      raw = readFileSync(file).toString('latin1');
    } catch {
      continue;
    }
    const haystack = `${raw}\n${Buffer.from(raw, 'latin1').toString('utf8')}`;
    for (const match of haystack.matchAll(JWT)) {
      const claims = payload(match[0]);
      const sub = claims?.sub;
      if (typeof sub !== 'string' || !sub) continue;
      const entry = { sub, access: match[0], exp: claims?.exp };
      if (typeof entry.exp === 'number' && entry.exp * 1000 <= Date.now()) continue;
      const held = byAccount.get(sub);
      if (!held || (entry.exp ?? 0) >= (held.exp ?? 0)) byAccount.set(sub, entry);
    }
  }
  const accounts = [...byAccount.values()].sort((a, b) => (b.exp ?? 0) - (a.exp ?? 0));
  return accounts.length ? accounts : null;
}

// Why there is no desktop sign-in to use — the two cases said apart, as
// workbuddy's plugin does: the client isn't installed, or it is and its
// credentials have run out.
function noDesktop(files) {
  if (!files.length) {
    return '不知道小浣熊桌面端的登录文件在哪（客户端只有 Windows 版）；' +
      '若你把登录态复制到了别处，请用 options.desktopFiles 指过去';
  }
  if (!files.some((file) => existsSync(file))) {
    return '找不到小浣熊桌面端的登录文件；请先安装并登录 商汤小浣熊 客户端';
  }
  return '小浣熊桌面端没有未过期的登录态（登录文件在，里面的 JWT 都过期了）；请在客户端重新登录';
}

// The label for an account. The client keeps login names in its own storage,
// a separate read from the JWT, so the sub is the fallback — a uuid cut to
// something a card can show.
function nameOf(entry) {
  return entry.name || `小浣熊 ${String(entry.sub).replace(/^pu-/, '').slice(0, 8)}`;
}

function httpURL(value) {
  const url = new URL(String(value));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Expected an HTTP(S) URL without credentials');
  }
  return url.href.replace(/\/+$/, '');
}

// desktopSignIn uses the account the client is signed in to: nothing is asked
// of the user, and only a marker is stored, so the credential itself is read
// again when it is used and a re-login in the client is picked up on its own.
function desktopSignIn(files) {
  return {
    url: '',
    instructions: '使用小浣熊桌面端当前登录的账号；客户端重新登录后这里会自动跟上，无需再次登录。',
    method: 'auto',
    async callback() {
      const accounts = readDesktop(files);
      if (!accounts) return { type: 'failed', error: noDesktop(files) };
      return {
        type: 'success',
        refresh: '',
        access: '',
        // 0 = "read it from the app". The JWT's exp is the client's own
        // 30-day window and refreshing it does not extend that, so magpie
        // renewing on a lead would renew to the same end.
        expires: 0,
        source: 'desktop',
        accountId: nameOf(accounts[0]),
        uid: accounts[0].sub,
      };
    },
  };
}

async function server(_input, options = {}) {
  const baseURL = httpURL(options.baseURL ?? DEFAULT_BASE);
  const officeURL = httpURL(options.officeURL ?? DEFAULT_OFFICE);
  const desktopURL = httpURL(options.desktopURL ?? DEFAULT_DESKTOP);
  const clientVersion = String(options.clientVersion ?? DEFAULT_CLIENT_VERSION);
  const files = options.desktopFiles ?? DESKTOP_FILES;

  let known = bootstrapModels();
  let listed = false;
  let listedAt = 0;
  // Which of the client's accounts a request went to last; the next takes
  // the one after it, so two signed-in accounts share the day's questions
  // instead of the first being used until it is empty.
  let turn = 0;

  // The credential a read should use: the account this sign-in names, so a
  // meter or model list belongs to the account the card is labelled with.
  function named(auth) {
    const accounts = readDesktop(files);
    if (!accounts) return null;
    if (auth?.uid) {
      const own = accounts.find((entry) => entry.sub === auth.uid);
      if (own) return own;
    }
    return accounts[0];
  }

  // The credential this request should go to, turning over between the
  // client's accounts so two share the day's questions instead of the first
  // being used until it is empty.
  function pick(auth) {
    const accounts = readDesktop(files);
    if (accounts) return accounts[turn++ % accounts.length];
    const stored = auth?.access;
    if (stored) return { sub: payload(stored)?.sub ?? 'stored', access: stored, exp: payload(stored)?.exp };
    return null;
  }

  async function discover(access, signal) {
    if (!access) return known;
    const timeout = AbortSignal.timeout(15000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetch(`${baseURL}${CATALOG_PATH}`, {
        headers: { authorization: `Bearer ${access}` },
        signal: combined,
      });
      if (!response.ok) throw new Error(`model_catalog returned HTTP ${response.status}`);
      const json = await response.json();
      const discovered = {};
      for (const category of json?.data?.categories ?? []) {
        for (const entry of category?.models ?? []) {
          const model = buildModel(entry, baseURL);
          if (model) discovered[model.id] = model;
        }
      }
      if (Object.keys(discovered).length) known = discovered;
      listed = true;
      listedAt = Date.now();
    } catch {
      // Offline, or the gateway changed: the last list read is kept, so a
      // model already known keeps being served.
    }
    return known;
  }

  // The account's points and daily question count, as the client's own
  // account page reads them.
  async function meter(access) {
    const response = await fetch(`${officeURL}/setting_info`, {
      headers: { accept: 'application/json', authorization: `Bearer ${access}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`setting_info 返回 HTTP ${response.status}`);
    const env = await response.json();
    if (env?.code !== 0) throw new Error(env?.message || `setting_info code ${env?.code}`);
    return env?.data ?? {};
  }

  // The day's desktop-login points, as the client claims them when it starts
  // up. `granted` is true only on the first call of the day; the endpoint is
  // idempotent, so a second call answers false with no popup and no points.
  async function grant(access, signal) {
    const timeout = AbortSignal.timeout(20000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(`${desktopURL}${GRANT_PATH}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${access}`,
        'X-Client-Platform': CLIENT_PLATFORM,
        'X-Client-Version': clientVersion,
      },
      body: '{}',
      signal: combined,
      redirect: 'error',
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`领取接口返回 HTTP ${response.status}${text ? `：${text.slice(0, 200)}` : ''}`);
    }
    let env;
    try {
      env = JSON.parse(text);
    } catch {
      throw new Error(`领取接口返回的不是 JSON：${text.slice(0, 200)}`);
    }
    if (env?.code !== 0) throw new Error(env?.message || `领取接口 code ${env?.code}`);
    return env?.data ?? {};
  }

  return {
    config: async (cfg) => {
      cfg.provider ??= {};
      cfg.provider[PROVIDER] ??= {};
      const p = cfg.provider[PROVIDER];
      p.name ??= 'Raccoon 小浣熊';
      p.npm ??= SDK.chat;
      p.api ??= baseURL;
      p.models = { ...configModels(known), ...(p.models ?? {}) };
    },
    provider: {
      id: PROVIDER,
      // The account's own list when it is signed in and raccoon answers; else
      // the list above.
      async models(provider, { auth } = {}) {
        const chosen = named(auth);
        if (!chosen) return provider.models;
        try {
          const models = await discover(chosen.access);
          return Object.keys(models).length ? models : provider.models;
        } catch {
          return provider.models;
        }
      },
    },
    auth: {
      provider: PROVIDER,
      icon: 'https://xiaohuanxiong.com/favicon.ico',
      maxConcurrency: 2,
      methods: [
        {
          type: 'oauth',
          label: '小浣熊桌面端已登录的账号',
          authorize: () => desktopSignIn(files),
        },
      ],
      async loader(getAuth) {
        const auth = await getAuth();
        if (auth?.type !== 'oauth') return {};
        return {
          baseURL,
          apiKey: '',
          async fetch(input, init) {
            const chosen = pick(await getAuth());
            if (!chosen) throw new Error(noDesktop(files));
            const request = new Request(input, init);
            const protocol = Object.keys(PATHS).find((key) => request.url === `${baseURL}${PATHS[key]}`);
            if (!protocol || request.method !== 'POST') {
              throw new Error('Unsupported raccoon endpoint or method');
            }
            request.signal.throwIfAborted();
            // The body is read once, as text: a Request whose body has been
            // taken as JSON cannot be cloned for sending again.
            let raw = init?.body;
            if (raw === undefined) raw = await request.text();
            else if (typeof raw !== 'string') raw = await new Request('https://x/', { method: 'POST', body: raw }).text();
            let body;
            try {
              body = JSON.parse(raw);
            } catch {
              throw new Error('Expected a JSON request object');
            }
            if (!body || typeof body !== 'object' || Array.isArray(body)) {
              throw new Error('Expected a JSON request object');
            }
            if (!listed || Date.now() - listedAt >= 60_000) await discover(chosen.access, request.signal);
            if (!Object.hasOwn(known, body.model)) {
              // The gateway no longer serves it, or never did: said as a
              // model not served, so the caller sets this model aside and not
              // the account, whose other models still answer.
              const served = Object.keys(known).sort().join(', ');
              const name = typeof body.model === 'string' ? body.model : '';
              return new Response(
                JSON.stringify({
                  type: 'error',
                  error: {
                    type: 'not_found_error',
                    message: `Model ${name} is not available from raccoon now. Models: ${served || 'none'}.`,
                  },
                }),
                { status: 404, headers: { 'content-type': 'application/json' } },
              );
            }

            const headers = new Headers(init?.headers ?? request.headers);
            headers.delete('authorization');
            headers.delete('x-api-key');
            headers.delete('content-length');
            headers.set('content-type', 'application/json');
            headers.set('authorization', `Bearer ${chosen.access}`);

            const refused = (message) =>
              new Response(JSON.stringify({ error: { message, type: 'authentication_error', code: 401 } }), {
                status: 401,
                statusText: 'Unauthorized',
                headers: { 'content-type': 'application/json' },
              });

            const response = await fetch(request.url, {
              method: init?.method ?? request.method,
              headers,
              body: raw,
              signal: request.signal,
              redirect: 'error',
            }).catch(async (error) => {
              // A credential the front door refuses is answered 401 for a
              // small body and the connection is dropped for a large one,
              // which reads as ECONNRESET and says nothing of the sign-in;
              // ask the meter the same credential to tell the two apart.
              if (error?.name === 'AbortError' || error?.name === 'TimeoutError' || request.signal?.aborted) {
                throw error;
              }
              let status = 0;
              try {
                const probe = await fetch(`${officeURL}/setting_info`, {
                  headers: { authorization: `Bearer ${chosen.access}` },
                  signal: AbortSignal.timeout(20000),
                });
                status = probe.status;
                await probe.body?.cancel();
              } catch {
                throw error;
              }
              if (status !== 401) throw error;
              const size = typeof raw === 'string' ? Buffer.byteLength(raw) : raw?.byteLength ?? 0;
              return refused(
                `小浣熊拒绝了 ${nameOf(chosen)} 的登录态（401）。它对接过 ${size ? `${(size / 1048576).toFixed(1)} MiB` : '这么大'} 的被拒请求会直接断开连接而不予回答，` +
                  '所以看上去像 ECONNRESET。请在商汤小浣熊客户端重新登录。',
              );
            });

            if (response.status === 401) {
              await response.body?.cancel();
              return refused(
                `小浣熊账号 ${nameOf(chosen)} 的登录态已失效` +
                  (chosen.exp ? `（JWT exp=${new Date(chosen.exp * 1000).toISOString()}）` : '') +
                  '。请在商汤小浣熊客户端重新登录，这里会自动跟上。',
              );
            }
            // The day's questions are what the account is actually out of
            // (20 per account per day); said as itself so magpie rests the
            // account instead of retrying it.
            if (response.status >= 400) {
              const text = await response.clone().text();
              if (/daily_question_count_exceed|question count exceed/i.test(text)) {
                await response.body?.cancel();
                return new Response(
                  JSON.stringify({
                    error: {
                      message: `小浣熊账号 ${nameOf(chosen)} 今日问答次数已用完（每日上限 20 次），零点重置。`,
                      type: 'rate_limit_error',
                      code: 429,
                    },
                  }),
                  { status: 429, statusText: 'Too Many Requests', headers: { 'content-type': 'application/json' } },
                );
              }
            }
            return response;
          },
        };
      },
      // The account's points and daily questions. Each read keeps the
      // sign-in: as in workbuddy's plugin, a meter that can't be read says
      // nothing about whether the account is signed in.
      async usage(getAuth) {
        const auth = await getAuth();
        if (auth?.type !== 'oauth') return { error: 'not signed in', signIn: 'kept' };
        const accounts = readDesktop(files);
        if (!accounts) return { error: noDesktop(files), signIn: 'kept' };
        // Summed over the accounts the client is signed in to, so the card
        // shows what two accounts together have left rather than whichever
        // one a single read caught.
        let points = 0, asked = 0, cap = 0, searches = 0, searchCap = 0;
        for (const entry of accounts) {
          try {
            const data = await meter(entry.access);
            points += Number(data?.available_points) || 0;
            asked += Number(data?.daily_question_count) || 0;
            cap += Number(data?.daily_question_limit) || 0;
            searches += Number(data?.daily_web_search_count) || 0;
            searchCap += Number(data?.daily_web_search_limit) || 0;
          } catch {
            // A meter that can't be read says nothing of the account; the
            // others are read on their own, as in workbuddy's plugin.
          }
        }
        const out = { plan: accounts.length > 1 ? `normal ×${accounts.length}` : 'normal', windows: [] };
        if (cap > 0) {
          out.windows.push({
            name: 'Questions',
            used: (100 * asked) / cap,
            display: `${asked} / ${cap}`,
            amount: asked,
            limit: cap,
            unit: 'questions',
          });
        }
        if (points > 0) {
          // The points are what a request is paid from; there is no declared
          // ceiling, so the card shows the amount, not a bar.
          out.windows.push({
            name: 'Credits',
            used: 0,
            display: `${points.toLocaleString('en-US')}`,
            amount: points,
            limit: 0,
            unit: 'credits',
          });
        }
        if (searchCap > 0) {
          out.windows.push({
            name: 'Web search',
            used: (100 * searches) / searchCap,
            display: `${searches} / ${searchCap}`,
            amount: searches,
            limit: searchCap,
            unit: 'calls',
          });
        }
        return { ...out, signIn: 'kept' };
      },
      // The desktop client's daily login points, claimed the way the client
      // claims them (POST /login/points/grant, idempotent). magpie drives
      // this: one call per account per Beijing day, and the result shows on
      // the account's Usage card. It is off by default in Settings → Usage.
      async checkin(getAuth) {
        const auth = await getAuth();
        if (auth?.type !== 'oauth') return { outcome: 'failed', message: 'not signed in' };
        const accounts = readDesktop(files);
        if (!accounts) return { outcome: 'failed', message: noDesktop(files) };
        const account = named(auth);
        if (!account) return { outcome: 'failed', message: noDesktop(files) };
        let granted = false;
        let points = 0;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const data = await grant(account.access);
            if (data?.granted) {
              granted = true;
              points = Number(data?.popup?.points) || 0;
            }
            break;
          } catch (error) {
            // A credential that ran out mid-day answers 401; anything else is
            // reported as the failure it is rather than swallowed.
            const message = String(error?.message ?? error);
            if (attempt === 0 && /HTTP 401/.test(message)) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
              continue;
            }
            return { outcome: 'failed', message };
          }
        }
        if (!granted) {
          return { outcome: 'done', message: `${nameOf(account)} 今日已领（接口幂等，不重复入账）` };
        }
        const credit = points > 0 ? points : undefined;
        return {
          outcome: 'claimed',
          ...(credit ? { credit } : {}),
          message: `${nameOf(account)} 已领今日桌面端登录积分${credit ? ` +${credit}` : ''}`,
        };
      },
    },
  };
}

export default { id: PROVIDER, server };
