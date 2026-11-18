# Antigravity Claude UX

**Bring the exact macOS Claude Desktop (Code / Cowork) aesthetic, stratified model selector, live plan quota ring, in-bubble undo & edit, sidebar top Recents & collapsed folder status badges, in-app module switches, interleaved step narration, and in-flow live `TodoWrite` checklist cards to Google Antigravity Desktop 2.0 — 100% via non-invasive CDP runtime injection.**

[中文说明](#-功能亮点) · [Quick Start](#-一键安装-quick-start) · [Architecture](#-工作原理-how-it-works) · [English Summary](#english-summary)

---

## ✨ 为什么做这个项目？

很多同时深度使用 **Claude Desktop（Code / Cowork 模式）** 与 **Google Antigravity 2.0** 的用户都有两个强烈痛点：
1. **视觉噪音与交互拥挤**：
   - 原生模型下拉菜单把 9 个模型平铺挤成一列，每行重复印着 `Medium` 和满屏的 `新 / 快速 ⓘ / 提示 ⓘ` 角标，底栏还经常冒出突兀的橙色 `+38 sub` 胶囊；
   - 社区常见美化要么在输入框周围堆满 Emoji 挂件，要么套上泛黄底色、暗红粗框与打字机字体，设置页也容易出现说明文字反客为主的浓黑倒挂。
2. **“黑盒闷头干活”缺乏过程感**：
   - Antigravity 首次引导若选到默认的「知识工作模式（Knowledge Work）」，底层会强制开启 `ephemeralToolCalls: true`——**工具和 MCP 一跑完就瞬间销毁隐藏**；
   - 即便切回开发者模式，模型默认把思路憋在隐藏的 `thinking` 里不说话，回合结束瞬间外层 `已工作 Xm >` 会把整轮步骤二次打包吞没，React 卸载面板时也缺少收起动画，更没有 Claude 标志性的**流内实时跟随任务卡片（`TodoWrite`）**与**官方蓝双点旋转读秒行**。

本项目在不修改 `Antigravity.app` 安装包（不触碰 `app.asar`、不破坏 Apple 签名）的前提下，把**视觉层、模型与额度浮层、客户端隐藏配置层与 Agent 协作规则层**一次性打通。

> [!NOTE]
> “不改安装包”不等于“不改用户配置”：安装器会改写 `theme-patch/user/` 四个文件、`antigravity_state.pbtxt` 的 `product_skin`、`~/.gemini/config/config.json` 的 `verboseConversationSteps`，并在 `~/.gemini/AGENTS.md` 顶部插入规则块。每一项改动都记录在 `~/.gemini/antigravity/claude-ux/install-state.json`，`uninstall` 按记录逐项回滚。安装与自动更新会访问 GitHub；运行期界面层不发起外部请求。

---

## 🎯 功能亮点

### 1. 像素级对齐 `Claude.app` 纯白/暖炭黑界面与设置页（`user/custom.css`）
- **纯白通透浅色 + 暖炭黑深色**：浅色采用 `Claude.app` 原版纯白画布 `#FFFFFF` + 极淡中性灰侧栏 `#F9F9F8` + 无边框浅灰用户气泡 `#F3F3F0` + 中性灰行内代码 `#F3F3F1`；深色自动进入 Claude 暖炭黑（`#212120` 画布 / `#191918` 侧栏），告别刺眼冷蓝黑。
- **单层极简输入框 + 补全菜单与夜间高对比按钮**：消融双层套娃框为单层 `18px` 圆角白卡（`opacity: 1` 实色占位符），并保证 `/`、`@` 自动补全菜单实底不透字；夜间模式采用暖白发送钮 `#ECECEA` 与低调深炭待机语音钮 `#383835`。
- **100% 无衬线苹方 + Anthropic Sans 精排**：全局 UI、AI 正文、用户气泡、输入框与浮层统一使用 `Anthropic Sans + PingFang SC`（`14px` / 行高 `1.65`）。
- **纯文字 Claude 设置页**：纯白/暖炭黑侧栏配浓黑文字与 `#E5E5E5` 选中胶囊、自然中文短词导航（`常规 / 应用 / 外观 / 通知 / 模型 / 浏览器`），右侧采用 Google 官方蓝（浅色 `#2F75C3` / 深色 `#2F71E3`）渲染开关与细轨滑块，彻底修复主副标题字重倒挂。

### 2. 1:1 Claude 极简分层模型菜单 + `◎` 实时套餐限额圆环（`user/custom.js`）
- **清爽分层模型选择器**：无损接管 `model-selector-trigger` 与 `⌘/` 快捷键（直连客户端原生 React Fiber `setSelectedModel` 状态机）：
  - 主列表顶部 `模型 · 本次会话` **仅保留 4 个日常主力 Gemini 模型**（`Gemini 4 Carbon` / `Gemini 4 Argon` / `Gemini 4 Hydrogen` / `Gemini 3.8 Flash`），清掉所有重复的 `Medium` 与 `新 / 快速` 角标噪音，打开菜单后按键盘数字 **`1～4` 即可秒切**；
  - 分割线下方独立拆分 **「思考强度 >」**（悬停弹出 `Low / Medium / High / XHigh` 二级面板）与 **「更多模型 >」**（分组收纳 `Orchestrator` 多智能体编排与 `Claude / GPT` 模型）。
- **模型旁 `◎` 上下文圆环 & 真实套餐限额浮层**：紧贴模型按钮右侧挂载动态进度圆环（按占用率自动由炭黑切琥珀黄/珊瑚红），点击即弹出 Claude 风格限额卡片，实时读取客户端原生 `retrieveUserQuotaSummary` 展示 `Ultra / Pro` 套餐下的 **当前上下文、5 小时限额与每周限额** 进度条及重置倒计时。
- **极简底栏遥测 & 双段 Claude 详情浮窗**：移除突兀的 `+38 sub`、`Ctx` 与 `Out` 冗余项，底栏中央保留干净的 `tok/s · TTFT`；悬停或点击即可弹出 `272px` Claude 极简双段详卡（融合 PR #2 分区设计与分级 `Cache %` 着色，同时在首段保留 **首字耗时 `TTFT`** 与 `Xm Ys` 可读时长，悬停预览、点击锁定）。

### 3. 解锁完整步骤流 + 190ms 双向丝滑折叠动画 + 官方蓝实时秒表
- **自动解锁隐藏步骤引擎**：一键切至 `PRODUCT_SKIN_DEVELOPER`（`project4kMode = 1`）并开启 `verboseConversationSteps: true`，永久保留所有文件读写、命令执行与 MCP 调用详情。
- **解除外层二次吞没 & 补齐收起动画**：自动解封回合末 `已工作 Xm` 套娃包裹，使每句进展说明与 `13px` 工具摘要平铺展示；通过 `.ag-collapse-ghost` 补齐 `190ms` 平滑收拢动画。
- **运行中官方蓝双点旋转 + 实时秒表**：按窗格锁定正在执行的最后一步工具行，行首挂载与开关/额度条统一的 Google 官方蓝双子星旋转点（浅色 `#2F75C3` / `#7BAEE6`，深色 `#2F71E3` / `#78A9FF`），行尾挂载 `1s / 2s...` 读秒器（执行完毕即销毁，没有运行中的步骤时不保留 1 秒定时器）。

### 4. 流内实时跟随 + 双布局模式全兼容的 `TodoWrite` 进度卡片
- **中途进度零可见污染（隐形注释 + 双缓冲读取）**：中途切换阶段只需在进展说明末尾附加隐形 HTML 注释 `<!-- todo:N/M -->`（Markdown 渲染后完全不可见，绝不在正文里打印重复步骤文字；历史 `〔进度 N/M〕` 行亦自动隐藏），前置剥离代码块/反引号示例防误触发，并同时比对 React 18 `fiber` 与 `fiber.alternate` 从回合完整 `container.steps` 读取最新进度。
- **「软件工程」、「知识工作」与 `v2.33.0+` 分页虚拟滚动全兼容**：切至「知识工作（Knowledge Work）」模式后，哪怕中途带 `- [/]` 的进展步骤被客户端收进 `已工作 · N 条进展` 未挂载 DOM `<ul>`，或 `v2.33.0+` 长对话重启/翻页时 `autoscroll-viewport` 虚拟卸载了早先的开场轮次，卡片引擎仍会从回合 `container.steps`、同长度未闭环 `<!-- todo:N/M -->` 标记及 `trajectorySlice.stepsInSlice` 分页缓存溯源起点，运行期与收尾期始终稳定渲染 `14px` `#EBEBEB` 圆角边框进度卡；回答里普通的 `- [ ]` / `- [x]` 清单（材料清单、审查要点等）则**原样显示、绝不接管**。
- **对话流内动态跟随（In-Flow Tail）**：任务执行中，进度卡片始终紧跟当前轮次最后一个步骤节点的正下方——在底部观看时永远实时可见不被顶走；向上翻阅前文时随消息流自然滚走，绝不焊死在输入框头顶遮挡正文或回底按钮。
- **追问/改需求跨轮接力合并（防双卡 & 防僵尸转圈）**：
  - 任务未全部完成时，用户中途插话追问或补充需求，新一轮清单**自动吞并隐藏上一轮半截旧卡**，全屏始终只留最新 1 张活卡片；
  - 若中途打断，未完成的卡片保留在原位并标注「已暂停」（停止旋转），内容始终可见；
  - 当所有条目 **100% 打勾完工**（复刻 Claude `#666666` 实心圆白勾）后，卡片自动落位归档在总结上方作为完工记录。

### 5. 原地撤回重编消息、侧栏「最近对话」& 折叠项目角标、设置内嵌「界面增强」面板
- **气泡内原地撤回重编（`claudeUxInlineUndo`）**：无损拦截用户消息悬停 `撤回` 按钮，直接在原气泡位置展开浅灰/暖炭无框内联编辑卡（浅色 `#F6F6F4` / 深色 `#282826`，摒弃突兀彩色粗框），自动调取客户端原生 `getRevertPreviews` 列出将回滚的代码文件胶囊，内置「同步撤回文件」开关（直连 `revertPreviewState.setConversationOnly`）并完整保留原消息附图/媒体附件，按 `⌘↵` 或点「重新发送」即可通过 `inputBoxRef.current.submit()` 原地回退重发。
- **侧栏顶部「最近对话」与折叠项目聚合角标（`claudeUxRecentSection` / `claudeUxFolderStatus`）**：直接订阅客户端内存 Redux `trajectorySummaries`（`0` 外部网络请求、插入在虚拟滚动视口外层绝不破坏列表 `translateY` 偏移），在侧栏顶部固定展示可折叠的「最近对话」（按 `待确认 > 运行中 > 最近活跃` 智能置顶，默认 4 条、可展开至 8 条，基于 TanStack Router `0ms` 无刷秒切）；同时在已折叠的项目文件夹右侧聚合展示琥珀色待确认图标（终端命令 / 权限审批 / 追问等待）、官方蓝运行双点及未读蓝点计数，鼠标悬停项目行时自动淡出让位给原生 `+ / ⋯` 操作钮。
- **原生设置页内嵌「界面增强」可视化面板（`settingsPanel`）**：在客户端原生设置左侧导航栏「外观」下方注入纯文字「界面增强」入口，右侧提供 **9 项核心功能即时开关**与「恢复默认」，点击即刻 `0ms` 热生效并持久化至 `localStorage`，无需手改配置文件或重启客户端。

### 6. 客户端版本更新自动跟随 & `v2.33.0+` 调试端口无感自愈（0 Token 守护）
- **`Antigravity v2.33.0+` 免改签名冷启动 CDP 自愈**：`v2.33.0` 移除了原版默认内置的 `--remote-debugging-port=0` 并在启动时主动清理旧 `DevToolsActivePort`；安装器自动在常驻主题守护入口（`antigravity-font-daemon.mjs`）注入零开销引导——每当从 Dock、Spotlight 或客户端「重启以更新」刚拉起未带调试端口的新进程（启动 `<= 25s`），1 秒内自动无感补挂 `--remote-debugging-port=0`（完全不触碰 `/Applications/Antigravity.app` 原厂签名，零 Gatekeeper 拦截、不影响 Squirrel 应用内自更新，且绝不打断运行超过 `25s` 的存量会话）。
- macOS 安装时默认注册 `launchd` `WatchPaths` 守护（`com.antigravity.claude-ux.autosync`），监听 `Antigravity.app` 更新（若本机部署了双开副实例 `Antigravity 2.app` 也会随版本升级自动重同步），并每 12 小时检查本仓库更新（`git pull --ff-only`，拉取后先做语法与 JSON 校验再部署；已通过 `v2.32.2` → `v2.33.0` 跨大版本实机自愈验收）。
- 上游内核锁定在经过验证的提交（`install.mjs` 中的 `UPSTREAM_REF`，当前基线 `v5.4.2`：含 `plugin://swarm--` 子帧实时主题同步、`NewDocument` 0ms 防闪白与外观设置 `[ 🖥️ | ☀️ | 📖 | 🌙 ]` 四段切换），只升级、不会把你手动装的新版内核降级。
- **不覆盖你的修改**：`config.json` / `i18n.override.json` 按字段三方合并，你改过的值保留；`custom.css` / `custom.js` 若被你改过，新版本暂存到 `claude-ux/incoming/`，不覆盖（需要时加 `--overwrite-local`，旧文件先另存）。
- 后台同步不会重新插入你删掉的 `AGENTS.md` 规则块；开发者步骤开关只在客户端版本变化时重新确认。

---

## 🚀 一键安装 (Quick Start)

### 方式一：让 AI 自动帮你装（最省心）
直接把本仓库地址发给你的 Antigravity / Claude Code，说一句：
> `帮我安装 https://github.com/hongqi7/antigravity-claude-ux`

内置的 [`SKILL.md`](SKILL.md) 会引导 Agent 自动拉取最新 `main` 分支、同步字体、备份原配置并立即热注入生效。

### 方式二：终端两行命令安装（无需重启客户端）
要求已安装 Node.js `>= 22`：

```bash
git clone https://github.com/hongqi7/antigravity-claude-ux.git ~/Developer/antigravity-claude-ux
node ~/Developer/antigravity-claude-ux/install.mjs install
```

> **提示**：
> - 未安装底层 CDP 注入守护（[`Anarcadia/chuanban-antigravity-theme-patch`](https://github.com/Anarcadia/chuanban-antigravity-theme-patch)）时，`install.mjs` 会自动拉取并完成守护注册。
> - 若 Mac 上已安装 `/Applications/Claude.app`，脚本会自动提取官方 `Anthropic Sans / Serif` 可变字体到 `~/Library/Fonts/`。

### 常用诊断、手动同步与无损卸载
```bash
# 检查各层健康状态
node ~/Developer/antigravity-claude-ux/install.mjs doctor

# 手动立即从 GitHub 拉取最新更新并重部署热生效
node ~/Developer/antigravity-claude-ux/install.mjs sync-upgrade --force

# 单独开启 / 关闭客户端更新自动跟随守护
node ~/Developer/antigravity-claude-ux/install.mjs auto-update-on
node ~/Developer/antigravity-claude-ux/install.mjs auto-update-off

# 还原（移除更新守护、恢复原有 user/ 文件、回滚步骤开关、移除 AGENTS.md 规则块；重复执行为无操作）
node ~/Developer/antigravity-claude-ux/install.mjs uninstall
```

安装选项：`--no-auto-update`、`--no-step-unlock`（不改步骤开关）、`--no-agents-rule`（不插入规则）、`--overwrite-local`。

### 功能开关（可视化面板 + 配置文件双通道）
日常可直接在客户端 **设置 → 界面增强** 面板中可视化即时开关以下全部 9 项模块（`0ms` 热生效，状态保存在 `localStorage`）；也可在 `~/.gemini/antigravity/theme-patch/user/config.json` 的 `modules` 中把对应项设为 `false` 作为默认基线：

| 开关 | 作用 |
| :--- | :--- |
| `claudeUxInlineUndo` | 气泡内原地撤回重编消息与「同步撤回文件」开关 |
| `claudeUxRecentSection` | 侧边栏顶部可折叠「最近对话」无刷秒切区 |
| `claudeUxFolderStatus` | 折叠项目文件夹右侧待确认 / 运行中 / 未读聚合角标 |
| `claudeUxTodoCard` | 流内实时跟随 `TodoWrite` 执行进度卡片 |
| `claudeUxStepUnfold` | 自动展开回合末「已工作 Xm」 |
| `claudeUxCollapseAnimation` | 工具面板收起动画 |
| `claudeUxRunningTimer` | 运行中旋转点与读秒 |
| `claudeUxContextRing` | 上下文圆环、限额浮层、底栏精简 |
| `claudeUxModelMenu` | 分层模型菜单（关闭后恢复原生菜单） |

`customJs: false` 会一次性关闭以上全部脚本功能，`customCss: false` 关闭视觉层。

### 测试
```bash
npm i --no-save jsdom   # 可选：DOM 测试依赖，缺失时自动跳过
node --test test/
```
覆盖 39 项自动化测试（安装—同步—卸载—重复卸载、原文件缺失、用户配置三方合并、上游校验失败、CDP 断连/超时/异常、普通清单不被接管、热重载清理、键盘打开菜单、多窗格读秒、`<!-- todo:N/M -->` 隐形进度、代码段防误触、React `fiber.alternate` 双缓冲读取、跨轮接力、「知识工作」模式兼容、`v2.33.0+` 分页虚拟滚动 `trajectorySlice.stepsInSlice` 溯源、极简双段遥测浮窗与外层 `TTFT` 保留、气泡内原地撤回重编与文件回滚开关、折叠项目角标与顶部「最近对话」路由秒切、原生设置页「界面增强」即时开关持久化等场景）。未覆盖：真机像素比对、Windows 安装路径。

---

## 🧩 工作原理 (How It Works)

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Google Antigravity Desktop 2.0                         │
│    (app.asar untouched · Apple codesign intact · 127.0.0.1 local CDP)       │
├─────────────────────────────────────┬───────────────────────────────────────┤
│ 1. Visual & Settings Layer          │ 2. Runtime UX & Popover Layer         │
│    theme-patch/user/custom.css      │    theme-patch/user/custom.js         │
│  • Pure #FFFFFF / #212120 palette   │  • Stratified Claude Model Menu (⌘/)  │
│  • Anthropic Sans + PingFang 14px   │  • Context Ring + Live Quota Popover  │
│  • Clean single-layer composer      │  • Unfolds outer "Worked for Xm"      │
│  • Claude-matched Settings & #2F75C3│  • In-flow live cross-turn Todo card  │
├─────────────────────────────────────┼───────────────────────────────────────┤
│ 3. Native Step Engine Unlocker      │ 4. Agent Collaboration Rule           │
│    install.mjs (CDP + pbtxt/json)   │    ~/.gemini/AGENTS.md                │
│  • PRODUCT_SKIN_DEVELOPER (mode 1)  │  • 1-2 sentence mid-turn updates      │
│  • verboseConversationSteps: true   │  • Invisible <!-- todo:N/M --> sync   │
└─────────────────────────────────────┴───────────────────────────────────────┘
```

---

## 📊 开销说明 (Overhead)

| 模块 | 开销 | 说明 |
| :--- | :--- | :--- |
| 界面层（CSS、模型菜单、限额圆环、卡片、读秒） | 不占模型上下文 | 由 DOM 变化触发同步，合并到动画帧并限制为最多每 80ms 一次；自身写入的节点不会再次触发；没有运行中的步骤时无常驻定时器 |
| 全局规则（`AGENTS.md` 规则块） | 规则文本约数百 token，随系统提示词每轮发送 | 规则要求每次调用工具前写一句进展，输出 token 随工具调用次数增加 |
| 任务清单 | 只在 3 个阶段以上的任务中输出 | 仅在开场与收尾各输出一次完整清单；中途切换阶段仅附加约 5 token 的隐形注释 `<!-- todo:N/M -->`，不重打整张清单 |

> 参考数据（非真机）：在 jsdom 中模拟约 150 轮、50 个展开命令面板的长对话，单次同步耗时由 v1 的约 72ms 降到约 23ms。真实 Chromium 中的数值会不同，仅供相对比较。

---

## <a id="english-summary"></a>English Summary

**Antigravity Claude UX** is a non-invasive customization and workflow suite for **Google Antigravity Desktop 2.0** (macOS / Windows) built as a user-space extension layer on top of [`Anarcadia/chuanban-antigravity-theme-patch`](https://github.com/Anarcadia/chuanban-antigravity-theme-patch):

- **Pixel-Matched `Claude.app` Visuals & Settings (`user/custom.css`)**: Pure `#FFFFFF` light canvas & `#212120` warm charcoal dark palette, unified `14px` sans-serif typography (`Anthropic Sans` + `PingFang SC`), clean single-layer `18px` composer with opaque `/` & `@` typeahead popups (plus `#ECECEA` dark send orb & `#383835` idle voice button, stripping `+sub` badge noise), and a pure-text Claude-styled Settings sidebar paired with Google official blue (`#2F75C3` / `#2F71E3`) controls and active orbiting step dots.
- **Stratified Claude Model Menu, Live Plan Quota Ring & Minimalist Telemetry Popover (`user/custom.js`)**: Replaces the crowded 9-row flat model dropdown with a clean Claude-style popover featuring the 4 core Gemini models (`1–4` hotkeys) plus dedicated `Thinking Effort >` (`Low / Medium / High / XHigh`) and `More Models >` flyouts wired directly to Antigravity's native React Fiber `setSelectedModel`. Adds a radial context progress ring next to the model pill that opens a real-time `5h / weekly` plan quota popover via `retrieveUserQuotaSummary`, while pairing the clean outer `tok/s · TTFT` pill with a compact `272px` two-section telemetry popover (`本轮响应` with `TTFT` / speed / duration / output + `当前会话` with context & tiered cache hit rate, inspired by PR #2).
- **In-Flow `TodoWrite` Card, Knowledge Work & `v2.33+` Virtual-Scroll Compatibility (`install.mjs` + `user/custom.js`)**: Unlocks `PRODUCT_SKIN_DEVELOPER` + `verboseConversationSteps: true` and unwraps end-of-turn accordions. Mounts active `- [ ]` / `- [/]` / `- [x]` checklists **in-flow at the bottom of the active turn** (scrolling naturally with history without obscuring text), advances mid-turn via zero-noise invisible `<!-- todo:N/M -->` comments across React `fiber` / `fiber.alternate` in **both Developer and Knowledge Work modes**, preserves bordered cards across `v2.33.0+` `autoscroll-viewport` virtualized turns via `trajectorySlice.stepsInSlice` origin lookup, relays incomplete checklists across follow-up turns, marks interrupted checklists as `Paused` (`已暂停`) in place, and settles `100%` completed cards with `#666666` solid-circle checkmarks.
- **In-Bubble Undo & Edit, Sidebar Top Recents & Collapsed Folder Badges, and Native Settings `界面增强` Panel (`user/custom.js` + `user/custom.css`)**: Intercepts user-message `Revert` (`撤回`) into a clean `#F6F6F4` / `#282826` in-bubble editor with live modified-file chips (`getRevertPreviews`), a `同步撤回文件` toggle (`setConversationOnly`), preserved media attachments, and `⌘↵` resend via `inputBoxRef.current.submit()`. Subscribes directly to Redux `trajectorySummaries` (`0` network calls) to mount a collapsible top `最近对话` (`Recents`) section (`pending > running > recent`, `0ms` TanStack Router navigation) plus right-aligned pending/running/unread badges on collapsed project folders. Adds a native `设置 → 界面增强` pane with 9 `0ms` live-toggling module switches persisted to `localStorage`.
- **`v2.33.0+` Zero-Touch CDP Bootstrap & Auto-Sync Watcher**: Handles Google Antigravity `v2.33.0+`'s removal of default `--remote-debugging-port=0` on macOS without modifying `Antigravity.app` or breaking Apple Developer ID / Squirrel auto-updates — freshly launched (`<= 25s`) non-CDP instances are automatically re-opened with `--remote-debugging-port=0` within `1s`, paired with `com.antigravity.claude-ux.autosync` and upstream `chuanban-antigravity-theme-patch` `v5.4.2`.

---

## 🙏 致谢与许可 (Credits & License)

- 底层 CDP 守护与汉化指标内核由 [@Anarcadia](https://github.com/Anarcadia) 的 [`chuanban-antigravity-theme-patch`](https://github.com/Anarcadia/chuanban-antigravity-theme-patch) 提供（本仓库不分发其内核文件，安装时按需引用上游）。
- 部分色彩语义与排查思路参考了 [@AlexByoung](https://github.com/AlexByoung) 的 [`Claudized-Antigravity`](https://github.com/AlexByoung/Claudized-Antigravity)。
- 本仓库内的全部扩展脚本、样式、安装器与规则文档采用 [MIT License](LICENSE) 开源。
