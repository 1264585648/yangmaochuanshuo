# DealDex · 福利传说

一个以「开卡包」为主角的数字福利发现网站。第一阶段实现了四大卡池的可交互首页，采用手绘质感的木质场景、皮革卡包、旧金属装饰与克制的光效。

## 本地开发

需要 Node.js 22.13+、24 或 26+，推荐 24（见 `.nvmrc`）。页面运行时没有任何第三方依赖，开发依赖只用于本地服务、测试、检查与构建。

页面的福利数据全部来自 `/api/offers`，没有内置演示数据。本地开发需要同时运行接口：

```bash
npm install
npm run db:seed:local   # 迁移本地 D1，并写入一组虚构示例福利（仅本地）
npm run dev:api         # 终端 1：构建前端并以 wrangler 在 8787 端口提供页面与接口
npm run dev             # 终端 2：Vite 热更新，/api 代理到 8787
```

然后访问 <http://localhost:4173>（热更新）或 <http://localhost:8787>（与线上一致的形态）。目录页在 8787 上由 Worker 渲染；在 4173 上由浏览器脚本通过接口渲染，功能相同。

`db:seed:local` 写入的卡片标题均带「【示例】」，链接指向保留域名 `example.*`，不对应任何真实活动；脚本拒绝 `--remote`。真实福利只通过管理接口录入，见 [`docs/API.md`](docs/API.md)。不写入示例数据时，页面会显示「卡池补充中」的空状态，这也是线上目录为空时的真实表现。

### 常用命令

| 命令                        | 作用                                            |
| --------------------------- | ----------------------------------------------- |
| `npm run dev`               | Vite 开发服务器，支持热更新，`/api` 代理到 8787 |
| `npm run dev:api`           | 构建前端并用 wrangler 运行 Worker 与本地 D1     |
| `npm run db:seed:local`     | 迁移本地 D1 并写入虚构示例福利                  |
| `npm run dev:remote`        | 本地运行页面，接口连接 Cloudflare 上的线上 D1   |
| `npm run db:migrate:remote` | 对线上 D1 执行迁移                              |
| `npm test`                  | 运行 Vitest 测试                                |
| `npm run coverage`          | 运行测试并生成覆盖率报告                        |
| `npm run lint`              | ESLint 检查                                     |
| `npm run format`            | Prettier 格式化全部文件                         |
| `npm run build`             | 构建到 `dist/`                                  |
| `npm run check`             | lint、格式检查、测试、构建，CI 执行同一组合     |

### 部署与数据库

前端与接口一起部署为一个 Cloudflare Worker（`wrangler.jsonc`）：`npm run build` 生成 `dist/`，由 Worker 作为静态资源提供；`/api/*`、目录页 `/offers`、`/sitemap.xml` 与 `/robots.txt` 由 Worker 处理。页面依赖同源的 `/api/offers`，单独部署到纯静态托管只会显示「暂不可用」。发布时先构建再部署（`npm run build && npx wrangler deploy`）：`wrangler deploy` 不会自动构建，而静态资源的安全响应头来自构建时复制进 `dist/` 的 `public/_headers`，用旧的 `dist/` 部署会缺少这些响应头。

线上数据库是 Cloudflare D1 `dealdex`，已在 `wrangler.jsonc` 中配置并完成迁移。新增迁移后执行 `npm run db:migrate:remote`。

- `npm run dev:api` 与测试只使用本机的 D1 副本，不会写入线上数据。
- `npm run dev:remote` 让本地页面直接读写线上 D1，适合核对真实数据；在这个模式下调用管理接口会修改线上内容。
- 线上目录初始为空。真实福利通过管理接口录入：先用 `node scripts/manage-token.mjs issue --name "Owner" --scope admin --remote` 签发令牌，再按 [`docs/API.md`](docs/API.md) 新增提供方和福利、发布。示例数据脚本不会写入线上库。
- 发布不会自动记录核验时间，只调用 `publish` 的卡会显示「尚未核验」。审核人核对过官方页面后，应在发布请求里带上证据：`POST /api/manage/offers/<id>/publish`，请求体 `{"sourceUrl":"https://<与卡链接同主机>/...","verified":true}`；或在发布后调用一次 `verify`（同样需要 `sourceUrl`）。完整示例见 [`docs/API.md` 的「发布时记录核验」](docs/API.md#发布时记录核验)。
- 安全响应头（CSP、HSTS 等）由 `worker/src/http/security.ts` 与 `public/_headers` 共同提供，两处须保持一致，见 [`docs/API.md`](docs/API.md#安全响应头与缓存)。

## 已实现

- 四类主题卡池：AI 福利、云服务器、软件工具、教育优惠，卡包上显示每个池当前的有效福利数
- 福利数据来自公开接口，前端逐条校验字段，链接仅允许 https 并以 `noopener noreferrer` 打开
- 载入、空卡池、网络失败（可重试，恢复联网后自动重载）、数据过期自动刷新等状态
- 开包过场：蓄力、开包、卡牌翻面揭晓，SSR 有额外光效；动画与目录刷新并行，抽不到卡时不扣次数
- 结果与详情：提供方、你能得到什么、领取条件（新用户、学生、支付方式、自动续费、地区）、核验时间、有效期、官方链接与来源
- 概率：公示基础概率，并按各卡池实际有卡的等级换算出真实抽取概率
- 「发现优惠」独立目录页 `/offers`：Worker 从 D1 渲染整页 HTML（标题、描述、canonical、robots），筛选与页码写在网址里，可直接分享；单卡页 `/offers/<id>`；每张卡显示来源链接与最后核验日期，下架的卡返回 404；提供 `/sitemap.xml` 与 `/robots.txt`
- 图鉴：点开查看详情；已下架的卡不再显示并给出数量提示
- 弹窗进出场动画、焦点限制与归还、背景 `inert`；指针倾斜与光泽、触屏左右滑动切换
- 每日免费 3 次（浏览器本地日期重置）、本地收藏；减少动态效果偏好下所有动画直接到终态

## 项目结构

```text
index.html             抽卡大厅页面
offers.html            目录页模板（/offers 与 /offers/<id>，由 Worker 填充）
styles.css             场景、卡包与基础组件
styles/offers.css      福利详情、列表、筛选、图鉴
styles/motion.css      状态与动效
styles/catalog.css     目录页布局与卡片
src/main.js            大厅入口：状态装配与事件绑定
src/catalog.js         目录页入口
src/config.js          每日次数、存储键、接口与动效参数
src/api/client.js      公开接口客户端：响应信封校验、超时、取消、分页
src/app/               目录状态、大厅渲染、目录页导航、交互动效
src/data/pools.js      四个卡池的界面定义
src/domain/            福利校验、各池概率与抽取、每日次数、图鉴等纯逻辑
src/storage/local.js   localStorage 读写与数据校验
src/ui/                卡包渲染、弹窗、目录页 HTML 与元信息（浏览器与 Worker 共用）、转义
assets/room.svg        原创矢量书房背景
assets/grain.svg       可重复使用的颗粒纹理
assets/favicon.svg     DealDex 标识
scripts/dev-server.mjs 零依赖静态服务器（只能预览界面，不含接口）
worker/src/             Cloudflare Worker：公开只读接口、管理写入接口、目录页渲染与站点地图
migrations/            D1 建表迁移
wrangler.jsonc         Worker、静态资源与 D1 配置
scripts/manage-token.mjs 写入接口令牌的签发、列出与吊销
scripts/seed-local.mjs 本地 D1 示例数据（拒绝远程）
tests/                 Vitest 单元测试、jsdom 页面集成测试与本地 D1 接口测试
vite.config.js         开发服务器、构建与测试配置
eslint.config.js       ESLint 配置
.github/workflows/     CI：lint、格式检查、测试、构建
docs/IMPLEMENTATION.md 第一阶段实施记录与上线边界
docs/PLANNING.md       前期规划与分阶段路线
docs/API.md            接口说明（含 AI 巡检接入流程）
```

## 当前边界

福利目录是真实接口数据，但**抽卡仍在浏览器中完成**：从已发布的福利中按公示概率抽取，次数与收藏保存在本机，清理浏览器数据会重置。服务端抽卡（原子扣次、防重放）是 `docs/PLANNING.md` 的阶段 3。稀有度只代表推荐价值，本站不发放兑换码、赠金或资格，不提供付费抽卡。

## 接下来的工作

见 [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md)，优先继续打磨卡包真实材质、开包过场，以及真实福利目录与领取说明的服务端数据模型。
