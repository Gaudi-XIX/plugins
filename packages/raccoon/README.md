# Raccoon (商汤小浣熊)

magpie 直接调用小浣熊，中间不经过 buddy2api 之类的反代。

provider id：`raccoon`

## 为什么能直连

小浣熊桌面端自己就带一个 OpenAI 兼容的推理网关。端点不在文档里，在客户端包内
`/electron/config/default-llm-config.json` 的 `apiBase` 字段：

```
POST https://xiaohuanxiong.com/api/web/llm/v2/chat/completions
Authorization: Bearer <客户端登录 JWT>
```

- 用的是标准 OpenAI 路径（`chat/completions`，斜杠）。客户端渲染层另一套
  `office/v3/chat-completions`（连字符）是「文档 AI」端点，只认
  `Office-Raccoon-Default` 这一个字面量——早前据此得出「模型塌缩」的结论是打错了端点。
- 裸 Bearer 就通，不需要 `X-Client-*` 头，也不需要 UA 伪装（Zen 免费层那套反爬这里没有）。
- 支持 `stream:false`，不用像 Zen 插件那样强制上游流式再合成。
- 工具调用实测 200，`finish_reason=tool_calls`，参数正确回填；流式+工具同样通。

响应头泄露了上游是 LiteLLM 1.103.4 网关
（`x-litellm-model-name: custom_openai/openai/gpt-5.6-sol`、
`x-litellm-model-api-base: https://api.qnaigc.com/v1`），分模型路由是真实存在的，
不是把所有请求塞给一个默认模型。

## 登录态

默认读取两个位置，取到的所有登录态都保留（一个账号一份）：

- `~/.box-agent/config/auth.json` —— 客户端当前登录账号
- `%APPDATA%\office-raccoon\Local Storage\leveldb\000003.log` —— Electron 的
  localStorage，客户端登录过的每个账号各留一份 JWT

（两处在 Windows 上展开后就是 `C:\Users\<你>\.box-agent\config\auth.json` 与
`C:\Users\<你>\AppData\Roaming\office-raccoon\Local Storage\leveldb\000003.log`。）

过期的 JWT 会被过滤掉。JWT `exp` 固定 30 天且 refresh 不延长，所以每 30 天要回
客户端重新登录一次。

可用 `options.desktopFiles` 覆盖这两个路径。桌面端目前只有 Windows 版，所以在别的
系统上插件读不到登录态；把客户端的登录态文件复制过来、用 `options.desktopFiles`
指过去也可以。

登录方式只有一个：`magpie plugin login raccoon` 会选「小浣熊桌面端已登录的账号」，
不询问密钥——它把客户端当前的登录态接过来，卡片上标成账号名（取不到登录名时用 JWT 的
`sub` 截断兜底）。

**这里走的是 oauth 而不是 api 密钥。** 区别在于：api 密钥会把当下那把 JWT 存成快照，
客户端一重新登录、JWT 一轮换，卡片就变成「已登录但一直 401」。oauth 这条只存一个标记，
每次发请求时重新读盘取当前登录态，所以客户端换号、续签都会自动跟上，不用回来重登。

## 每日签到

小浣熊的每日积分是「桌面端登录即发」，客户端启动时自己调
`POST /api/web/desktop/v1/login/points/grant` 领一次（幂等：当天第二次调用回
`granted:false`，不重复入账）。插件把这个动作搬到 `auth.checkin` 钩子里：

```js
async checkin(getAuth) → { outcome: 'claimed' | 'done' | 'failed', credit?, message? }
```

- `claimed`：今天这次调用真的发了积分（`granted:true`），`credit` 是发到手的点数。
- `done`：今天已经领过了（`granted:false`）。**这不是失败**，是幂等命中。
- `failed`：读不到登录态，或者领取接口非 2xx / `code≠0`。401 会重试一次（客户端
  可能正在续签），仍失败就如实报错，不静默当成功。

magpie 侧不需要你做任何事：每个已登录账号每北京日签一次（启动后 2 分钟首查，之后每
30 分钟），结果落在 `plugin-checkin.json`，账号卡片上多一行 `checkinBy: plugin:raccoon`。

**开关默认是关的**：Settings → Usage → Plugins 里给 raccoon 打开 Daily check-in，
或在 Usage 页点「Check in now」立刻签一次。

> 插件只能领**当前登录账号各自的**日赠。客户端本身没有多账号切换 UI，
> 所以要在客户端里换号登录，另一个账号才会被这条钩子带上。

## 模型

`GET /api/web/llm/v2/model_catalog`（不是 `/models`，那个 404）返回 9 个模型，
与客户端模型选择器里的一致：

| id | context | output | billing |
|---|---|---|---|
| `raccoon-8c4485` | 1000000 | 100000 | normal |
| `raccoon-19b265` | 1000000 | 100000 | normal |
| `raccoon-405a1c` | 1000000 | 100000 | normal |
| `sn-sensenova-6-8-flash` | 256000 | 63999 | lite |
| `sn-sensenova-6-8-flash-lite` | 256000 | 63999 | lite |
| `sn-glm-5-3` | 1000000 | 100000 | normal |
| `sn-kimi-k3` | 1000000 | 100000 | normal |
| `sn-glm-5-3-flash` | 1000000 | 100000 | lite |
| `sn-deepseek-v4-1-flash` | 1000000 | 100000 | normal |

catalog 只给 id 和 limit，不给 reasoning / attachment。这两个字段按实测填在
`models.mjs` 的 `OBSERVED` 表里（2026-10-16，每个模型一次请求）：
`raccoon-*` 回 `reasoning_content: null` 且描述里写「支持图像」；其余回非空推理段。
catalog 更新后如果出了新 id，`OBSERVED` 里没有的按 `reasoning: true` 兜底。

## 多账号

`auth.loader` 把所有登录态收进来，`fetch` 里按请求轮转（`turn++ % tokens.length`），
两个账号平摊当日额度，而不是把第一个用空再换下一个。

## 已知边界

- **额度天花板是账号自带的，不是插件能绕的**：小浣熊按日问答数限流，触顶回
  `{"code":200506,"message":"office_daily_question_count_exceed_error"}`。多账号能摊薄，
  改不了单账号上限。
- **上游契约是逆向来的**：厂商改端点或鉴权，插件就得跟着改。
- 只实现 chat 协议（`/chat/completions`）。`/responses`、`/messages` 上游均 404，
  没有对应协议。

## 安装

```sh
magpie plugin add F:\AgentData\fleet\magpie-plugin-raccoon
magpie plugin login raccoon
```

登录时不填任何东西：`magpie plugin login raccoon` 直接确认，它读本机客户端已登录的账号。

改过代码后，终端里跑任何 `magpie` 命令都会按磁盘现状重读文件夹插件；GUI 侧要先
`magpie plugin off raccoon` 再 `on` 才重载。

## 开发语言

插件正文用中文写注释与面向用户的文案（报错、卡片行），因为这个 provider 的维护者
和用户都是中文语境。代码标识符、字段名、端点保持英文。

---

# Raccoon (SenseTime 商汤小浣熊) — English summary

magpie talks to 小浣熊 directly, with no buddy2api-style proxy in between.

The desktop client ships an OpenAI-compatible gateway; the endpoint is not documented,
it is the `apiBase` field of `/electron/config/default-llm-config.json` packed inside
the app:

```
POST https://xiaohuanxiong.com/api/web/llm/v2/chat/completions
Authorization: Bearer <the client's login JWT>
```

- Standard OpenAI path (`chat/completions`, slash). The renderer's other
  `office/v3/chat-completions` (hyphen) is the *document AI* endpoint and only accepts
  the literal `Office-Raccoon-Default` — an earlier "models collapse into one" reading
  came from hitting the wrong endpoint.
- A bare `Bearer` is enough: no `X-Client-*` headers, no UA spoofing. `stream: false`
  works, so there is no need to force upstream streaming and reassemble. Tool calls
  return 200 with `finish_reason=tool_calls` and correctly filled arguments.
- Sign-in is taken from the desktop client and re-read from disk on every request
  (`oauth`, `source: "desktop"`), so re-logins and token rotations are picked up
  automatically. JWTs live 30 days and are not extended by refresh.
- `auth.checkin` claims the daily desktop-login points
  (`POST /api/web/desktop/v1/login/points/grant`, idempotent): `claimed` when the day's
  points were actually granted, `done` when they already were, `failed` when the
  credential is gone or the endpoint refused. magpie runs it once per account per
  Beijing day; the switch under Settings → Usage → Plugins defaults to off.
- Models come from `GET /api/web/llm/v2/model_catalog` (9 of them); `/models` is a 404.
- Only the chat protocol is implemented: `/responses` and `/messages` are 404 upstream.
- Known ceiling: the account's own 20-questions-per-day limit
  (`office_daily_question_count_exceed_error`). More signed-in accounts split it;
  nothing raises one account's cap.
- The upstream contract is reverse-engineered: if the vendor changes the endpoint or
  its auth, this plugin has to change with it.

