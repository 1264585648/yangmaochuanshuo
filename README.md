# DealDex · 福利传说

一个以「开卡包」为主角的数字福利发现网站。第一阶段实现了四大卡池的可交互首页，采用手绘质感的木质场景、皮革卡包、旧金属装饰与克制的光效。

## 本地开发

需要 Node.js 22.13+、24 或 26+，推荐 24（见 `.nvmrc`）。页面运行时没有任何第三方依赖，开发依赖只用于本地服务、测试、检查与构建。

```bash
npm install
npm run dev
```

然后访问 <http://localhost:4173>。由于使用 JavaScript 模块，不要直接以 `file://` 打开页面。

不想安装依赖时，也可以用仓库自带的零依赖服务器预览：

```bash
node scripts/dev-server.mjs
```

### 常用命令

| 命令               | 作用                                        |
| ------------------ | ------------------------------------------- |
| `npm run dev`      | Vite 开发服务器，支持热更新                 |
| `npm test`         | 运行 Vitest 测试                            |
| `npm run coverage` | 运行测试并生成覆盖率报告                    |
| `npm run lint`     | ESLint 检查                                 |
| `npm run format`   | Prettier 格式化全部文件                     |
| `npm run build`    | 构建到 `dist/`                              |
| `npm run check`    | lint、格式检查、测试、构建，CI 执行同一组合 |

### 部署

构建命令为 `npm run build`，产物目录为 `dist/`，可部署到 Cloudflare Pages、GitHub Pages 或任意静态托管平台。源码目录本身仍可不经构建直接托管。

## 已实现

- 四类主题卡池：AI 福利、云服务器、软件工具、教育优惠
- 点击卡包切换、左右箭头切换、键盘左右方向键切换
- 独立卡包材质（皮革、缝线、金属包角、徽章、纹理）和自适应布局
- 开包动效、A/S/SSR 三级揭晓、概率说明（70%/25%/5%）
- 每日免费 3 次演示抽卡（浏览器本地日期重置）
- 本地发现记录、收藏与图鉴、演示福利检索
- 弹窗键盘关闭、减少动态效果偏好支持、基本无障碍语义

## 项目结构

```text
index.html             页面语义结构
styles.css             视觉和动效
src/main.js            入口：状态装配与事件绑定
src/config.js          每日次数、存储键、动效时长等常量
src/data/              卡池与演示福利数据
src/domain/            抽卡、每日次数、图鉴等纯逻辑（随机源与日期可注入）
src/storage/local.js   localStorage 读写与数据校验
src/ui/                卡包渲染、弹窗、HTML 构建与转义
assets/room.svg        原创矢量书房背景
assets/grain.svg       可重复使用的颗粒纹理
assets/favicon.svg     DealDex 标识
scripts/dev-server.mjs 零依赖本地服务器（备用）
tests/                 Vitest 单元测试与 jsdom 页面集成测试
vite.config.js         开发服务器、构建与测试配置
eslint.config.js       ESLint 配置
.github/workflows/     CI：lint、格式检查、测试、构建
docs/IMPLEMENTATION.md 第一阶段实施记录与上线边界
docs/PLANNING.md       前期规划与分阶段路线
```

## 重要：当前为视觉与交互原型

所有福利卡牌都是**演示数据**，不代表真实可领取的活动，亦不构成任何支付、赠金、会员或资格承诺。概率和抽卡次数使用浏览器侧逻辑，仅用于体验；正式版应由服务端保证抽取和次数一致性、核验优惠库存与 eligibility，并公开真实概率。正式版不提供付费抽卡。

## 接下来的工作

见 [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md)，优先继续打磨卡包真实材质、开包过场，以及真实福利目录与领取说明的服务端数据模型。
