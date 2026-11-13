# DealDex 接口说明

所有接口返回 JSON，格式统一为：

```json
{ "success": true, "data": {}, "error": null, "meta": { "total": 0, "limit": 50, "offset": 0 } }
```

失败时 `success` 为 `false`，`data` 为 `null`，`error` 为 `{ "code": "...", "message": "...", "details": [...] }`。`meta` 只出现在分页列表中。调用方应以 `error.code` 判断错误类型，`message` 仅供阅读。

## 公开只读接口

无需鉴权，响应可缓存 60 秒。只返回「已发布」且在有效期内的卡，有效期按 UTC 日期判断。

### `GET /api/offers`

| 参数                                                              | 说明                                             |
| ----------------------------------------------------------------- | ------------------------------------------------ |
| `pool`                                                            | `ai` / `cloud` / `software` / `education`        |
| `rarity`                                                          | `A` / `S` / `SSR`                                |
| `provider`                                                        | 提供方 id                                        |
| `newUsersOnly` `studentOnly` `requiresPaymentMethod` `autoRenews` | `true` / `false`                                 |
| `q`                                                               | 关键词，匹配标题、摘要、权益与提供方名，≤ 100 字 |
| `limit` / `offset`                                                | 分页，`limit` 为 1–100，默认 50                  |

未知参数或格式错误返回 `400 invalid_query`。排序为 SSR、S、A，同级按标题。

### `GET /api/offers/:id`

返回单张卡。草稿、待审核、已失效、已过期或不存在的卡一律返回 `404 not_found`。

### 卡片上的热度字段

列表与单卡响应都带两个字段：`publishedAt`（首次发布时间，用于「新上架」标签，前台显示 14 天）和 `officialVisitors`（点开过官方页面的独立访客数）。访客数低于 10 时返回 `null`，前台不显示数字。所有数字都来自真实点击，没有任何基数或虚构数据。

## 内测接口（点击、反馈、内测群）

写请求只接受同源（与 `/api/me*` 相同的 Origin 校验），不会创建用户。访客以 IP 的 HMAC 哈希（`IP_HASH_SECRET`）识别，不存原始 IP；缺少密钥时写接口返回 `503 unavailable`。

| 方法与路径                   | 说明                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/offers/:id/click` | 记录一次「打开官方页面」，请求体为空。只计当前公开的卡；同一访客同一北京日对同一张卡只写一行，重复点击不产生写入。返回 `{ "recorded": true/false }` |
| `POST /api/feedback`         | 提交反馈，`201` 返回 `{ "id" }`。每个网络每小时 10 条，超出返回 `429`                                                                               |
| `GET /api/community`         | 内测群信息，未配置或已关闭时 `data` 为 `null`。二维码过期后 `qr` 为 `null`                                                                          |
| `GET /api/community/qr?v=`   | 二维码图片（同源提供，以满足 CSP `img-src 'self'`），过期或未配置时 `404`                                                                           |

反馈请求体：

```json
{ "kind": "offer", "offerId": "<卡 id>", "category": "expired | wrong_info | link_broken | other", "message": "选填，≤1000 字", "contact": "选填，≤100 字" }
{ "kind": "general", "category": "suggestion | bug | want_offer | other", "message": "必填，2–1000 字", "contact": "选填" }
```

报告的卡必须存在（已下架的卡也可以报告），否则返回 `422 unknown_offer`。

## 用户接口 `/api/me*`

轻量用户体系的 A 层：服务端签发匿名身份，无需注册。规划见 `docs/PLANNING.md` 阶段 3。

- 身份放在 Cookie `__Host-ddx_sid` 中（`HttpOnly; Secure; SameSite=Lax; Path=/`），有效期 180 天。数据库只存令牌的 SHA-256 哈希。会话使用满 30 天后自动续期并重新下发 Cookie。
- 单纯浏览、调用 `GET /api/me` 不会创建用户。用户在首次成功抽卡时创建。
- 每日次数按北京时间 0 点重置。福利有效期仍按 UTC 日期判断。
- 用户接口一律 `Cache-Control: no-store`。
- `/api/me`、`/api/me/*` 与 `/api/draws` 的写请求必须同源：`Origin` 等于本站，或浏览器未带 `Origin` 时 `Sec-Fetch-Site: same-origin`，否则返回 `403 forbidden_origin`。

### `GET /api/me`

```json
{
  "user": { "id": "u_…", "kind": "guest", "createdAt": "2026-11-12T03:00:00.000Z" },
  "quota": { "max": 3, "day": "2026-11-12", "resetsAt": "2026-11-12T16:00:00.000Z" }
}
```

没有 Cookie，或 Cookie 已过期、已吊销、无法识别时，`user` 为 `null`、`quota.used` 为 `0`，不报错。

### `POST /api/draws`

请求头必须带 `Idempotency-Key`（1–100 位字母、数字或 `_ . : -`，每次点击生成一个新的），请求体只允许 `{ "pool": "ai" | "cloud" | "software" | "education" }`，上限 1 KB。

成功返回 `201`：

```json
{
  "draw": {
    "id": "d_…",
    "pool": "cloud",
    "rarity": "S",
    "createdAt": "…",
    "isNew": true,
    "favorite": false
  },
  "offer": { "id": "…", "title": "…", "provider": { "id": "…", "name": "…" } },
  "quota": { "max": 3, "used": 1, "day": "2026-11-12", "resetsAt": "2026-11-12T16:00:00.000Z" },
  "prize": null
}
```

`prize` 为这次抽卡附带抽中的限定福利（含兑换码），没中为 `null`，见下文「限定福利」。`offer` 与 `GET /api/offers` 列表项同形（重放时若该卡已下架，则为下文的精简形式）。`isNew` 表示该用户第一次获得这张卡，`favorite` 表示已收藏。

- 随机、扣次、记录都在服务端完成。扣次与写入是同一条条件语句，并发请求不会多扣。
- 只从当前已发布且在有效期内的卡中抽取。稀有度先按基础概率（A 70% / S 25% / SSR 5%）在该池实际有卡的等级间重新归一，再在该等级内均匀选卡；与前端公示的概率由同一份代码（`src/domain/catalog.js`）计算。
- 同一用户重复使用同一个幂等键：返回第一次的结果，状态码 `200`，带 `Idempotent-Replayed: true`，不再扣次；即使次数已用完、那张卡已下架也照常返回。同一个键换了卡池返回 `422 idempotency_key_reused`。
- 没有会话时，首次成功抽卡会创建匿名用户并下发 Cookie。卡池为空时返回 `409 pool_empty`，不扣次也不建用户。
- 次数用完返回 `429 quota_exhausted`，`Retry-After` 为距离北京时间 0 点的秒数，`error.details` 为当前 `quota`。
- 按 IP 限流：每个 IP（IPv6 按 /64 前缀合并计算）每小时最多新建 20 个匿名用户、抽卡 120 次，超出返回 `429 rate_limited` 与 `Retry-After`。已有会话的重放与「次数已用完」在限流之前直接回答，不占用该 IP 的额度。IP 只以 HMAC 哈希形式存放在限流计数中。

**部署前需配置密钥** `IP_HASH_SECRET`（`wrangler secret put IP_HASH_SECRET`，至少 32 个字符的随机串）。缺失或过短时抽卡返回 `503 unavailable`，并在服务端日志记录 `config_error`。本地开发把 `.dev.vars.example` 复制为 `.dev.vars`；修改 `.dev.vars` 后需重启 `wrangler dev`。

### 限定福利

站长自己持有、数量有限的福利（兑换码、邀请链接），每个单位是一行兑换码。

- **抽取**：每次真实抽卡（`POST /api/draws` 新建的记录）在正常出卡之外再抽一次。进行中、在时间窗口内且还有库存的限定福利各按自己公示的概率参与（按 id 顺序累加），剩下的概率为「不中」。进行中的概率合计不超过 20%（`PRIZE_LIMITS`）。某份福利抽完后不再参与，其余福利的概率不变。
- **原子性**：领取一个单位的语句与抽卡记录在同一个 D1 批次里执行，且只在这次抽卡记录确实写入时生效。重放、次数已用完、并发抢最后一份都不会多发；抢不到时抽卡照常成功，`prize` 为 `null`。
- **中奖上限**：每个用户终身最多中 1 次；同一网络每个北京日最多中 1 次（IPv4 按单个地址，IPv6 按 /48 前缀，比抽卡限流的 /64 更宽，防止轮换地址）；全站每个北京日合计最多发出 30 份（`PRIZE_LIMITS.maxWinsPerDay`）。查询条件与 `prize_codes` 上的两个部分唯一索引同时保证。达到上限后照常抽卡，只是不再中奖。
- **兑换码只给中奖者**：抽卡响应与重放的 `prize`、以及 `GET /api/me/prizes` 返回完整兑换码，均为 `no-store`。公开接口、目录页、sitemap、抽卡记录、审计日志和管理接口都不包含完整兑换码（管理端中奖记录只显示后 4 位）。

```json
"prize": {
  "id": "ai-vip-month",
  "title": "某 AI 会员一个月",
  "description": "打开兑换页登录后输入兑换码",
  "redeemUrl": "https://example.com/redeem",
  "code": "ABCD-1234-WXYZ",
  "claimedAt": "2026-11-13T03:00:00.000Z"
}
```

`GET /api/prizes`（公开，缓存 60 秒）：进行中且在时间窗口内的限定福利，含已抽完的，供公示：`[{ "id", "title", "description", "valueNote", "chance", "total", "remaining", "startsAt", "endsAt" }]`。

`GET /api/me/prizes`：当前用户中过的限定福利 `{ "prizes": [ … ] }`，形如上面的 `prize`；没有会话时为空数组，不建用户。

已知限制：匿名身份清 Cookie 即可重来，所以「每人 1 次」实际上由「每网络每天 1 次」兜底；拥有大量 IPv4 地址的人仍能多中，每日合计上限用于止损。新访客第一次抽卡的响应若在网络中丢失，重试时没有 Cookie，会新建另一个匿名用户；如果第一次恰好中奖，那份兑换码留在无法再访问的用户名下，需要站长在后台核对后补发。

### 已下架的卡

用户拥有、但当前已不公开（已失效、已过期或撤回）的卡，在抽卡重放、图鉴与抽卡记录中只返回识别信息，不再返回链接、领取条件和摘要，以免展示未经审核的修改：

```json
{
  "id": "…",
  "provider": { "id": "…", "name": "…" },
  "pool": "ai",
  "rarity": "S",
  "title": "…",
  "retired": true
}
```

### `GET /api/me/collection`

图鉴：用户拥有的每张卡一条（按最近获得排序），以及对当前有效卡的收集进度。没有会话时返回空图鉴和 `found` 为 0 的进度。

```json
{
  "cards": [
    {
      "offer": { "id": "…" },
      "firstDrawnAt": "…",
      "lastDrawnAt": "…",
      "drawCount": 2,
      "favorite": true,
      "live": true
    }
  ],
  "progress": {
    "live": { "found": 3, "total": 42 },
    "retired": 1,
    "byPool": [{ "pool": "ai", "found": 2, "total": 12 }],
    "byRarity": [{ "rarity": "SSR", "found": 0, "total": 5 }]
  }
}
```

- `live` 为 false 的卡是已下架的卡，`offer` 为上面的精简形式；它们保留在图鉴中，但不计入 `progress.live`，单独计入 `progress.retired`。
- `byPool` 固定按 ai、cloud、software、education 排列，`byRarity` 按 SSR、S、A 排列。
- 迁入的旧浏览器记录计入图鉴，`drawCount` 包含它们。

### `GET /api/me/draws?before=&limit=`

真实抽卡记录，新的在前，不含迁入的旧记录。`limit` 为 1–50，默认 20；`before` 为上一页最后一条的 `id`，`nextCursor` 为 `null` 表示没有更多。其他参数返回 `400 invalid_query`。没有会话时返回空列表。

```json
{
  "items": [
    {
      "id": "d_…",
      "pool": "ai",
      "rarity": "A",
      "createdAt": "…",
      "offer": { "id": "…" },
      "live": true
    }
  ],
  "nextCursor": "d_…"
}
```

### `PUT` / `DELETE /api/me/favorites/:offerId`

收藏或取消收藏，返回 `{ "offerId": "…", "favorite": true }`，重复调用结果不变。只能收藏自己拥有的卡；没有会话或不拥有时返回 `404 not_found`。

### `POST /api/me/import`

一次性迁入此前保存在浏览器里的图鉴与收藏：

```json
{ "collection": [{ "id": "offer-id", "ts": 1794466012942 }], "favorites": ["offer-id"] }
```

- 两个数组各最多 100 条，请求体上限 32 KB，`ts` 为毫秒时间戳。
- 只保留今天仍公开的卡；卡池与稀有度取自目录，不信任浏览器。时间戳限定在过去一年内，同一张卡取最早的时间。收藏只保留迁入后拥有的卡。
- 迁入的记录不计入每日次数，也不出现在抽卡记录中。
- 每个用户只能成功迁入一次，再次调用返回 `409 already_imported`；并发的两次请求只有一次生效。没有可迁入的内容时直接返回 `{ "imported": 0, "favorites": 0 }`，不占用这次机会，也不会为匿名访客创建用户。
- 返回 `{ "imported": 2, "favorites": 1 }`。没有会话时会创建匿名用户并下发 Cookie，与抽卡共用每个 IP 的新建用户限额。

### 每个用户的写入限额

收藏与迁入共用每个用户每分钟 60 次的额度，超出返回 `429 rate_limited` 与 `Retry-After`。

## 页面与爬虫入口（HTML / XML）

以下路径同样由 Worker 处理（`wrangler.jsonc` 的 `run_worker_first`），数据与公开接口一致，只含已发布且在有效期内的卡。响应可缓存 60 秒（站点地图 300 秒）。

| 路径               | 说明                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /offers`      | 福利目录页，服务端渲染。接受 `pool` `rarity` `newUsersOnly` `studentOnly` `requiresPaymentMethod` `autoRenews` `q` 与 `page`（从 1 开始，每页 20 张）。未知或格式错误的参数被忽略，不报错。 |
| `GET /offers/:id`  | 单张福利页。不可见或不存在的卡返回 `404` HTML 页面，带 `noindex`。                                                                                                                          |
| `GET /offers/`     | `301` 到去掉末尾斜杠的地址。                                                                                                                                                                |
| `GET /sitemap.xml` | 首页（第一条）、目录、四个卡池页与每张有效福利的地址。单卡的 `lastmod` 取最后修改（内容或状态）与最后核验中较晚的日期。                                                                     |
| `GET /robots.txt`  | 允许抓取页面，禁止 `/api/`，并给出站点地图地址。                                                                                                                                            |

页面模板是构建产物 `dist/offers.html`（源文件为仓库根目录的 `offers.html`），Worker 填入标题、描述、canonical、robots 和正文。数据库出错时返回 `503` 和未填充的模板，由浏览器脚本改用 `/api/offers` 渲染。

## 安全响应头与缓存

所有响应（静态资源、页面、爬虫入口与全部 `/api/*`）都带以下响应头。Worker 处理的响应由 `worker/src/http/security.ts` 统一添加；不经过 Worker 的静态资源由 `public/_headers`（构建时复制到 `dist/_headers`，Workers 静态资源会读取）添加。两处必须一致，测试会比对。

| 响应头                      | 值                                                                                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains`                                                                                                                                                                |
| `X-Content-Type-Options`    | `nosniff`                                                                                                                                                                                            |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                                                                                                                                                    |
| `X-Frame-Options`           | `DENY`                                                                                                                                                                                               |
| `Permissions-Policy`        | `camera=(), microphone=(), geolocation=()`                                                                                                                                                           |
| `Content-Security-Policy`   | `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'` |

CSP 不允许内联脚本、`style="…"` 属性和外部资源；新增此类内容前需同时修改两处配置。通过 `el.style.setProperty` 设置的样式不受影响。

`Cache-Control`：公开读接口与目录页为 `public, max-age=60`，`/sitemap.xml` 与 `/robots.txt` 为 `public, max-age=300`；所有管理接口、用户接口、错误响应与幂等重放一律为 `no-store`。

## 管理接口 `/api/manage/*`

### 鉴权

请求头 `Authorization: Bearer <token>`。令牌用脚本签发，原文只显示一次，数据库只存 SHA-256：

```bash
node scripts/manage-token.mjs issue --name "AI inspector" --scope inspector   # 本地库
node scripts/manage-token.mjs issue --name "Owner" --scope admin --remote     # 线上库
node scripts/manage-token.mjs list [--remote]
node scripts/manage-token.mjs revoke --id ai-inspector-1a2b [--remote]
```

| 权限        | 可以做                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------ |
| `inspector` | 新增卡（进入待审核）、提交草稿、核验已发布的卡、把已发布的卡标记失效、提出内容变更、读取管理列表 |
| `admin`     | 以上全部，以及发布、驳回、恢复、直接修改内容、处理变更申请、管理提供方、查看审计、回滚           |

缺少或无效令牌返回 `401 unauthorized`，权限不足返回 `403 forbidden`。

### 写入规则

- **幂等键：** 每个写请求（POST、PATCH）必须带 `Idempotency-Key`，1–100 位字母、数字或 `_ . : -`。同一令牌、同一键、同一请求重复发送（包括首次请求尚未完成时的并发重试），会原样返回首次的成功结果，并带响应头 `Idempotent-Replayed: true`。同一键配不同请求返回 `422 idempotency_key_reused`。失败的请求不占用键，修正后可用同一键重试。键保留 24 小时，过期后视为新键。
- **请求体：** JSON，`Content-Type: application/json`，不超过 16 KB。缺少或无法识别 `Content-Length` 时按流读取，超过上限立即中止。
- **限流：** 每个令牌每分钟最多 60 次写请求（固定窗口，跨窗口边界时短时间内最多约 120 次），失败和重放的请求同样计数。超出返回 `429 rate_limited` 并带 `Retry-After`。
- **字段：** 请求体中出现未定义字段一律拒绝。状态、核验时间、版本号、创建人由服务端维护，不能直接写入；核验时间只能通过 `verify` 或带 `verified: true` 的 `publish` 记录为服务端当前时间。内容与当前完全相同的修改返回 `422 no_changes`，不增加版本号。
- **链接：** 必须是 https，不能带用户名密码，保存时规范化为标准形式（如补全末尾的 `/`）。`officialUrl`、`sourceUrl` 以及作为证据的 `sourceUrl` 都必须位于该提供方登记的官方域名或其子域名下，否则返回 `422 unofficial_url`。
- **证据：** `verify`、`expire` 以及带 `verified: true` 的 `publish` 的证据链接还必须与该卡自身 `sourceUrl` 或 `officialUrl` 的主机名完全相同，否则返回 `422 evidence_mismatch`。
- **官方域名：** 提供方不能登记公共后缀或共享托管域名（如 `github.io`、`pages.dev`、`co.uk`），只能登记其下的具体主机（如 `vendor.github.io`）。登记 `example.com` 即信任其全部子域名，若某提供方的子域名允许用户发布内容，应只登记具体主机。
- **巡检令牌额外限制：** 待审核的新卡与待处理的变更申请合计不超过 100 条，超出返回 `429 review_queue_full`；每小时最多标记 20 张卡失效，超出返回 `429 rate_limited`。
- **审计：** 每次成功写入都会在同一事务中写入审计日志。审计日志在数据库层面禁止修改和删除。采纳变更记在卡上（`entityType=offer`，`action=change.apply`，`after.appliedChangeId` 指向变更申请），提出与驳回记在变更申请上（`entityType=change`）。

### 状态流转

```text
draft ──submit──▶ pending_review ──publish──▶ published ──expire──▶ expired
  ▲                    │                       │  ▲                    │
  └──────reject────────┘                 verify┘  └──────restore───────┘
```

| 动作      | 来源状态         | 目标状态           | 权限             | 需要 `sourceUrl`             |
| --------- | ---------------- | ------------------ | ---------------- | ---------------------------- |
| `submit`  | `draft`          | `pending_review`   | admin、inspector | 否                           |
| `publish` | `pending_review` | `published`        | admin            | 否；带 `verified: true` 时是 |
| `reject`  | `pending_review` | `draft`            | admin            | 否                           |
| `expire`  | `published`      | `expired`          | admin、inspector | 是                           |
| `restore` | `expired`        | `published`        | admin            | 否                           |
| `verify`  | `published`      | 不变，刷新核验时间 | admin、inspector | 是                           |

无权限返回 `403 forbidden`，状态不符返回 `409 invalid_state`。

### 发布时记录核验

`publish` 本身**不会**写入核验时间：只做发布的卡 `lastVerifiedAt` 为 `null`，页面显示「尚未核验」。审核人在发布前已核对过官方页面时，应在同一次请求里带上证据和 `verified: true`：

```bash
curl -X POST https://free.vibe-show.com/api/manage/offers/example-ai-credit/publish   -H "Authorization: Bearer $DEALDEX_ADMIN_TOKEN"   -H "Content-Type: application/json"   -H "Idempotency-Key: publish-example-ai-credit-1"   -d '{"sourceUrl":"https://docs.example.com/terms","verified":true}'
```

发布与核验在同一条条件更新中完成（按状态与版本号校验，期间卡被修改则返回 `409 conflict`，什么都不写入），审计记一条 `offer.publish`，其 `after.lastVerifiedAt` 为服务端时间。`verified: true` 的证据规则与 `verify` 相同：缺少 `sourceUrl` 返回 `400 source_required`，主机名不符返回 `422 evidence_mismatch`。`verified` 只接受 `true`，且只能用于 `publish`，用于其他动作返回 `400 invalid_body`。

也可以先不带标志发布，再单独调用一次 `verify`（同样需要证据），效果相同，只是多一次写入和审计记录：

```bash
curl -X POST https://free.vibe-show.com/api/manage/offers/example-ai-credit/verify   -H "Authorization: Bearer $DEALDEX_ADMIN_TOKEN"   -H "Content-Type: application/json"   -H "Idempotency-Key: verify-example-ai-credit-1"   -d '{"sourceUrl":"https://docs.example.com/terms"}'
```

### 接口列表

| 方法与路径                                           | 权限   | 说明                                                                                                           |
| ---------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `GET /api/manage/offers?status=&limit=&offset=`      | 任意   | 任意状态的卡，含 `status`、`version` 等管理字段                                                                |
| `GET /api/manage/offers/:id`                         | 任意   | 单张卡，任意状态                                                                                               |
| `POST /api/manage/offers`                            | 任意   | 新增。admin 新增为草稿，inspector 新增直接进入待审核                                                           |
| `PATCH /api/manage/offers/:id`                       | admin  | 直接修改：`{ "baseVersion": 1, "changes": { ... } }`                                                           |
| `POST /api/manage/offers/:id/:action`                | 见上表 | 状态流转：`{ "sourceUrl": "https://..." }`，`publish` 另可带 `"verified": true`                                |
| `POST /api/manage/offers/:id/changes`                | 任意   | 提出变更：`{ "baseVersion": 1, "changes": { ... }, "sourceUrl": "https://..." }`                               |
| `GET /api/manage/changes?status=pending&offerId=`    | 任意   | 变更申请列表                                                                                                   |
| `POST /api/manage/changes/:id/apply`                 | admin  | 采纳变更                                                                                                       |
| `POST /api/manage/changes/:id/reject`                | admin  | 驳回变更                                                                                                       |
| `POST /api/manage/providers`                         | admin  | 新增提供方：`{ "id", "name", "officialDomains": ["example.com"] }`                                             |
| `PATCH /api/manage/providers/:id`                    | admin  | 修改名称或官方域名                                                                                             |
| `GET /api/manage/audit?entityType=&entityId=&limit=` | admin  | 审计日志，最新在前，含变更前后完整快照                                                                         |
| `POST /api/manage/audit/:id/revert`                  | admin  | 把卡的内容恢复到该条记录之前的状态，作为一次新的写入记录                                                       |
| `GET /api/manage/feedback?status=&limit=&offset=`    | admin  | 用户反馈，最新在前；`status` 为 `open`、`resolved`、`dismissed`                                                |
| `POST /api/manage/feedback/:id/:action`              | admin  | `resolve`、`dismiss`（仅待处理）或 `reopen`，可带 `{ "note": "处理备注" }`                                     |
| `GET /api/manage/stats/clicks?days=7`                | admin  | 官方链接点击统计：每日独立访客、合计与前 50 张卡，`days` 为 1–90                                               |
| `GET /api/manage/community`                          | admin  | 内测群设置与二维码指纹                                                                                         |
| `PUT /api/manage/community`                          | admin  | 保存设置；`qr: { "base64" }` 上传图片（PNG/JPEG/WebP，≤512KB），`null` 删除，省略保留                          |
| `GET /api/manage/prizes`                             | admin  | 限定福利列表，含 `total`（库存）与 `claimed`（已发出），不含兑换码                                             |
| `POST /api/manage/prizes`                            | admin  | 新建草稿：`{ id, title, description?, valueNote?, redeemUrl?, chance, startsAt?, endsAt? }`，`chance` 为 0–0.2 |
| `PATCH /api/manage/prizes/:id`                       | admin  | 修改上述字段（`id` 除外），已结束的不能改；进行中时概率合计仍受 20% 上限约束                                   |
| `POST /api/manage/prizes/:id/codes`                  | admin  | 追加库存：`{ "codes": ["…"] }`，每次 ≤500 个、每个 ≤200 字符，重复的忽略；审计只记数量                         |
| `GET /api/manage/prizes/:id/winners`                 | admin  | 中奖记录：兑换码后 4 位、中奖时间、北京日、用户 id 前缀                                                        |
| `POST /api/manage/prizes/:id/:action`                | admin  | `activate`（草稿或暂停 → 进行中）、`pause`、`end`（不可恢复）                                                  |

### 新增卡的请求体

```json
{
  "id": "example-ai-credit",
  "providerId": "example",
  "pool": "ai",
  "rarity": "S",
  "title": "不超过 60 字",
  "summary": "不超过 200 字",
  "benefit": "不超过 120 字，用户实际得到什么",
  "officialUrl": "https://www.example.com/promo",
  "sourceUrl": "https://docs.example.com/terms",
  "conditions": {
    "newUsersOnly": true,
    "studentOnly": false,
    "requiresPaymentMethod": true,
    "autoRenews": false,
    "regions": ["US", "JP"],
    "note": "不超过 200 字"
  },
  "validFrom": "2026-11-01",
  "validUntil": null
}
```

`id` 与 `providerId` 为小写字母、数字和单个连字符，3–64 位。`regions` 为 ISO 3166-1 两位大写代码，空数组表示不限地区。`conditions` 中省略的项取默认值 `false` 或空。修改时 `conditions` 整体替换，不做字段级合并。

### 并发与冲突

- 修改和提出变更都要带 `baseVersion`，与当前版本不一致返回 `409 version_conflict`。版本号只在内容变化时增加，状态流转和核验不改变版本号，因此巡检程序的待处理变更不会因为核验而失效。
- 采纳变更时，如果卡在提出后被改过，返回 `409 version_conflict`，变更保持待处理。
- 回滚只允许针对卡的最新一次内容变更；之后又有修改时返回 `409`，需先回滚更新的记录。

## AI 巡检程序的建议流程

1. 用 `inspector` 令牌调用 `GET /api/offers` 获取已发布的卡。
2. 逐条打开 `sourceUrl` 核对。仍然有效时调用 `verify`，已失效时调用 `expire`，两者都需提供官方域名下的证据链接。
3. 内容有变化时调用 `POST /api/manage/offers/:id/changes` 提交变更，由人工采纳。
4. 发现新福利时调用 `POST /api/manage/offers` 新增，卡会进入待审核，由人工发布。
5. 每次请求使用新的 `Idempotency-Key`；网络重试时沿用同一个键。

## 错误码

| HTTP | `error.code`               | 含义                                                          |
| ---- | -------------------------- | ------------------------------------------------------------- |
| 400  | `invalid_query`            | 查询参数格式错误或含未知参数                                  |
| 400  | `invalid_body`             | 请求体未通过校验，`details` 列出字段                          |
| 400  | `invalid_json`             | 请求体不是合法 JSON                                           |
| 400  | `idempotency_key_required` | 写请求缺少 `Idempotency-Key`                                  |
| 400  | `invalid_idempotency_key`  | `Idempotency-Key` 格式不符                                    |
| 400  | `source_required`          | `verify` / `expire` / 带 `verified` 的 `publish` 缺少证据链接 |
| 401  | `unauthorized`             | 缺少、无效或已吊销的令牌                                      |
| 403  | `forbidden`                | 令牌权限不足                                                  |
| 403  | `forbidden_origin`         | 带 Cookie 的写请求不是同源发起                                |
| 404  | `not_found`                | 资源不存在，或对公开接口不可见                                |
| 405  | `method_not_allowed`       | 方法不支持，`Allow` 头列出可用方法                            |
| 409  | `already_exists`           | id 已存在                                                     |
| 409  | `invalid_state`            | 当前状态不允许该动作                                          |
| 409  | `version_conflict`         | 卡在 `baseVersion` 之后被修改                                 |
| 409  | `change_not_pending`       | 变更申请已被采纳或驳回                                        |
| 409  | `conflict`                 | 其他并发冲突，重新读取后重试                                  |
| 409  | `pool_empty`               | 该卡池当前没有可抽的卡，未扣次                                |
| 409  | `already_imported`         | 旧浏览器数据已经迁入过                                        |
| 413  | `payload_too_large`        | 请求体超过 16 KB                                              |
| 415  | `unsupported_media_type`   | 请求体不是 JSON                                               |
| 422  | `unknown_provider`         | 提供方不存在                                                  |
| 422  | `unofficial_url`           | 链接不在提供方官方域名下                                      |
| 422  | `evidence_mismatch`        | 证据链接与卡自身链接的主机名不同                              |
| 422  | `no_changes`               | 修改后的内容与当前相同                                        |
| 422  | `invalid_change`           | 已保存的变更申请不再符合校验规则，应驳回                      |
| 422  | `not_revertible`           | 该审计记录不是可回滚的内容变更                                |
| 422  | `idempotency_key_reused`   | 同一幂等键用于不同请求                                        |
| 422  | `chance_cap_exceeded`      | 进行中的限定福利概率合计将超过 20%                            |
| 429  | `rate_limited`             | 写入或抽卡过快，见 `Retry-After`                              |
| 429  | `quota_exhausted`          | 今日免费次数已用完，见 `Retry-After`                          |
| 429  | `review_queue_full`        | 巡检令牌的待审核队列已满                                      |
| 500  | `internal_error`           | 服务端错误，细节只记录在服务端日志                            |
| 503  | `unavailable`              | 服务端配置缺失（如 `IP_HASH_SECRET`），暂不可抽卡             |
