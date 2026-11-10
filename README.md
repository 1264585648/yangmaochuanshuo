# DealDex · 福利传说

一个以「开卡包」为主角的数字福利发现网站。第一阶段实现了四大卡池的可交互首页，采用手绘质感的木质场景、皮革卡包、旧金属装饰与克制的光效。

## 直接运行

项目是零依赖的静态前端。由于使用 JavaScript 模块，请通过本地 HTTP 服务器运行，而不要直接以 `file://` 打开：

```bash
npm run dev
```

然后访问 <http://localhost:4173>。无需 `npm install`。

`npm run check` 可执行 JavaScript 语法和项目结构检查。也可以直接将本仓库部署到 GitHub Pages、Cloudflare Pages 或任意静态托管平台，不需要构建命令。

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
app.js                 卡池与交互
assets/room.svg        原创矢量书房背景
assets/grain.svg       可重复使用的颗粒纹理
assets/favicon.svg     DealDex 标识
scripts/dev-server.mjs 零依赖本地服务器
tests/smoke.mjs        静态健全性检查
docs/IMPLEMENTATION.md 阶段计划与上线边界
```

## 重要：当前为视觉与交互原型

所有福利卡牌都是**演示数据**，不代表真实可领取的活动，亦不构成任何支付、赠金、会员或资格承诺。概率和抽卡次数使用浏览器侧逻辑，仅用于体验；正式版应由服务端保证抽取和次数一致性、核验优惠库存与 eligibility，并公开真实概率。正式版不提供付费抽卡。

## 接下来的工作

见 [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md)，优先继续打磨卡包真实材质、开包过场，以及真实福利目录与领取说明的服务端数据模型。
