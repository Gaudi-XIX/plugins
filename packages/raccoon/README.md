# @magpie-community/opencode-raccoon-auth

OpenCode & Magpie provider plugin for **SenseTime Raccoon (商汤小浣熊, `xiaohuanxiong.com`)**.

## Features

- **Sign-in methods**:
  1. Browser OAuth callback URL / token (paste `office-raccoon://auth/callback?code=...`, or raw JWT `access_token` / JSON token pair).
  2. Raccoon desktop live session reuse (strictly read-only, reading `~/.box-agent/config/auth.json` and Windows Electron LevelDB, without writing or spending desktop refresh tokens). The account the desktop app is signed in to always wins — two desktop accounts cannot be live at the same time, see [One account at a time](#one-account-at-a-time).
- **Token renewal**: single-flight proactive refresh 5 minutes before expiration for browser logins.
- **Dynamic model catalog & credit rates**: real-time synchronization from `/api/web/llm/v2/model_catalog` with context window, output limit, vision/reasoning tags, credit multipliers, and limited-free markers.
- **Usage & allowances**: reports available credits, unexpired grant bills, daily expiration timestamps, and Pro/Free subscription plans.
- **Daily check-in & desktop onboarding grant**: supports Magpie automatic daily check-in (`+300` credits/day) and one-time desktop onboarding grant (`+3000` credits).
- **SSE model rewrite**: transparently rewrites internal upstream model names back to requested downstream models for client compatibility.
- **Kept desktop credentials (mirror)**: the desktop app holds one account at a time, so the previous account's JWT disappears from `auth.json` and, once its LevelDB log rotates, from disk. Every desktop credential read is mirrored to `~/.config/magpie/raccoon-accounts.json` (override with `RACCOON_ACCOUNTS_FILE`) until its own JWT expires. The mirror is never authoritative: the account the app holds now always wins, and each seat keeps the account it is named after.

## One account at a time

The desktop app is signed in to one account at a time, and signing in to a
second account **revokes the first account's session on the server**, not just
the local copy of its credential. Measured on a live pair of accounts: after the
app signed in to account B, account A's JWT was still a month from its own
`exp`, yet both `/api/web/office/v3/setting_info` (credits) and
`/api/web/desktop/v1/login/points/grant` (check-in) answered
`401 {"code":200003,"message":"authorization_verify_error"}`, and nothing
revived it — every refresh endpoint the desktop app uses answered `404` for that
session.

So there is no arrangement in which two seats use two desktop accounts at once.
The kept-credential mirror above buys one thing only: a seat keeps its own
account's credential, so it answers for its own account instead of borrowing the
live account's. A seat whose account was revoked can neither answer requests nor
check in — both are answered `401` / `200003` until that account is signed in
again in the desktop app (which, in turn, revokes the account that is live now).
Treat "two desktop seats" as one live account plus a seat waiting to be signed
in, never as two credit pools.

## 中文

商汤小浣熊（SenseTime Raccoon / `xiaohuanxiong.com`）OpenCode & Magpie 提供商插件。

### 功能特性

- **多种登录方式**：
  1. 浏览器 OAuth 授权登录（粘贴 `office-raccoon://auth/callback?code=...` 回调链接，或直接粘贴 `access_token` / JSON）
  2. 直接只读复用本机商汤小浣熊客户端实时登录态（读取 `~/.box-agent/config/auth.json` 与 Windows Electron LevelDB，不写入或消耗客户端 refresh token）。**以客户端当前登录账号为准——两个桌面账号无法同时在线，原因见下节。**
- **Token 自动续期**：浏览器登录账号过期前 5 分钟自动单飞刷新。
- **动态模型目录与积分倍率**：实时同步 `/api/web/llm/v2/model_catalog`，展示模型上下文、最大输出、视觉/思考能力、积分倍率与限免（`Free`）标识。
- **积分余额与套餐查询**：展示可用积分、未过期发放额度、每日积分过期时间与 Pro/Free 套餐状态。
- **每日签到与桌面端登录奖励**：支持 Magpie 每日自动签到（`+300` 积分/天）及首次桌面端 `+3000` 积分登录奖励领取。
- **SSE 模型名重写**：将上游响应中的内部模型名重写为下游请求的 `model`，确保 Claude Code / Codex / OpenCode 等客户端兼容。
- **桌面端登录态镜像**：客户端同时只登录一个账号，切号后上一个账号的 JWT 会从 `auth.json` 消失，LevelDB 日志轮转后连盘上也不剩，**且它在服务端的 session 同时被作废**（见下节）。凡读取到的桌面端凭据都会镜像到 `~/.config/magpie/raccoon-accounts.json`（可用 `RACCOON_ACCOUNTS_FILE` 覆盖），直到该 JWT 自身过期。镜像不具权威：客户端当前账号永远优先，各席位固定使用自己名下的账号。

### 同一时刻只有一个账号

客户端一次只登录一个账号，而登录第二个账号**会把这个账号之前的那个账号在服务端的 session 作废**——被作废的不只是本地那份凭据。实测两个真实账号：客户端登入 B 之后，A 的 JWT 距离自己的 `exp` 还有一个月，但 `/api/web/office/v3/setting_info`（积分）与 `/api/web/desktop/v1/login/points/grant`（签到）都返回 `401 {"code":200003,"message":"authorization_verify_error"}`；客户端用到的每一个刷新端点对那个 session 都返回 `404`，救不回来。

所以两个席位不可能同时用两个桌面账号。上面的凭据镜像只买一件事：某个席位保留它自己账号的凭据，读的是它自己账号的数字，而不是借用当前账号的读数。账号已被作废的席位既答不了请求、也签不了到——两个接口都回 `401` / `200003`，直到在客户端把它重新登录一次（届时现在活着的那个账号反过来被作废）。请把「两个桌面席位」理解为「一个活账号 + 一个等重新登录的席位」，不是两个积分池。
