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

`Cache-Control`：公开读接口与目录页为 `public, max-age=60`，`/sitemap.xml` 与 `/robots.txt` 为 `public, max-age=300`；所有管理接口、错误响应与幂等重放一律为 `no-store`。

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

| 方法与路径                                           | 权限   | 说明                                                                             |
| ---------------------------------------------------- | ------ | -------------------------------------------------------------------------------- |
| `GET /api/manage/offers?status=&limit=&offset=`      | 任意   | 任意状态的卡，含 `status`、`version` 等管理字段                                  |
| `GET /api/manage/offers/:id`                         | 任意   | 单张卡，任意状态                                                                 |
| `POST /api/manage/offers`                            | 任意   | 新增。admin 新增为草稿，inspector 新增直接进入待审核                             |
| `PATCH /api/manage/offers/:id`                       | admin  | 直接修改：`{ "baseVersion": 1, "changes": { ... } }`                             |
| `POST /api/manage/offers/:id/:action`                | 见上表 | 状态流转：`{ "sourceUrl": "https://..." }`，`publish` 另可带 `"verified": true`  |
| `POST /api/manage/offers/:id/changes`                | 任意   | 提出变更：`{ "baseVersion": 1, "changes": { ... }, "sourceUrl": "https://..." }` |
| `GET /api/manage/changes?status=pending&offerId=`    | 任意   | 变更申请列表                                                                     |
| `POST /api/manage/changes/:id/apply`                 | admin  | 采纳变更                                                                         |
| `POST /api/manage/changes/:id/reject`                | admin  | 驳回变更                                                                         |
| `POST /api/manage/providers`                         | admin  | 新增提供方：`{ "id", "name", "officialDomains": ["example.com"] }`               |
| `PATCH /api/manage/providers/:id`                    | admin  | 修改名称或官方域名                                                               |
| `GET /api/manage/audit?entityType=&entityId=&limit=` | admin  | 审计日志，最新在前，含变更前后完整快照                                           |
| `POST /api/manage/audit/:id/revert`                  | admin  | 把卡的内容恢复到该条记录之前的状态，作为一次新的写入记录                         |

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
| 404  | `not_found`                | 资源不存在，或对公开接口不可见                                |
| 405  | `method_not_allowed`       | 方法不支持，`Allow` 头列出可用方法                            |
| 409  | `already_exists`           | id 已存在                                                     |
| 409  | `invalid_state`            | 当前状态不允许该动作                                          |
| 409  | `version_conflict`         | 卡在 `baseVersion` 之后被修改                                 |
| 409  | `change_not_pending`       | 变更申请已被采纳或驳回                                        |
| 409  | `conflict`                 | 其他并发冲突，重新读取后重试                                  |
| 413  | `payload_too_large`        | 请求体超过 16 KB                                              |
| 415  | `unsupported_media_type`   | 请求体不是 JSON                                               |
| 422  | `unknown_provider`         | 提供方不存在                                                  |
| 422  | `unofficial_url`           | 链接不在提供方官方域名下                                      |
| 422  | `evidence_mismatch`        | 证据链接与卡自身链接的主机名不同                              |
| 422  | `no_changes`               | 修改后的内容与当前相同                                        |
| 422  | `invalid_change`           | 已保存的变更申请不再符合校验规则，应驳回                      |
| 422  | `not_revertible`           | 该审计记录不是可回滚的内容变更                                |
| 422  | `idempotency_key_reused`   | 同一幂等键用于不同请求                                        |
| 429  | `rate_limited`             | 写入过快，见 `Retry-After`                                    |
| 429  | `review_queue_full`        | 巡检令牌的待审核队列已满                                      |
| 500  | `internal_error`           | 服务端错误，细节只记录在服务端日志                            |
