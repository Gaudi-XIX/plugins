# @magpie-community/opencode-raccoon-auth

OpenCode & Magpie provider plugin for **SenseTime Raccoon (商汤小浣熊, `xiaohuanxiong.com`)**.

## Features

- **Sign-in methods**:
  1. Browser OAuth callback URL / token (paste `office-raccoon://auth/callback?code=...`, or raw JWT `access_token` / JSON token pair).
  2. Raccoon desktop live session reuse (strictly read-only, reading `~/.box-agent/config/auth.json` and Windows Electron LevelDB, supporting multiple signed-in accounts without writing or spending desktop refresh tokens).
- **Token renewal**: single-flight proactive refresh 5 minutes before expiration for browser logins.
- **Dynamic model catalog & credit rates**: real-time synchronization from `/api/web/llm/v2/model_catalog` with context window, output limit, vision/reasoning tags, credit multipliers, and limited-free markers.
- **Usage & allowances**: reports available credits, unexpired grant bills, daily expiration timestamps, and Pro/Free subscription plans.
- **Daily check-in & desktop onboarding grant**: supports Magpie automatic daily check-in (`+300` credits/day) and one-time desktop onboarding grant (`+3000` credits).
- **SSE model rewrite**: transparently rewrites internal upstream model names back to requested downstream models for client compatibility.

## 中文

商汤小浣熊（SenseTime Raccoon / `xiaohuanxiong.com`）OpenCode & Magpie 提供商插件。

### 功能特性

- **多种登录方式**：
  1. 浏览器 OAuth 授权登录（粘贴 `office-raccoon://auth/callback?code=...` 回调链接，或直接粘贴 `access_token` / JSON）
  2. 直接只读复用本机商汤小浣熊客户端实时登录态（读取 `~/.box-agent/config/auth.json` 与 Windows Electron LevelDB，支持多账号并存，不写入或消耗客户端 refresh token）
- **Token 自动续期**：浏览器登录账号过期前 5 分钟自动单飞刷新。
- **动态模型目录与积分倍率**：实时同步 `/api/web/llm/v2/model_catalog`，展示模型上下文、最大输出、视觉/思考能力、积分倍率与限免（`Free`）标识。
- **积分余额与套餐查询**：展示可用积分、未过期发放额度、每日积分过期时间与 Pro/Free 套餐状态。
- **每日签到与桌面端登录奖励**：支持 Magpie 每日自动签到（`+300` 积分/天）及首次桌面端 `+3000` 积分登录奖励领取。
- **SSE 模型名重写**：将上游响应中的内部模型名重写为下游请求的 `model`，确保 Claude Code / Codex / OpenCode 等客户端兼容。
