# Antigravity Claude UX

**Bring the exact macOS Claude Desktop (Code / Cowork) aesthetic, stratified model selector, live plan quota ring, interleaved step narration, and cross-turn auto-docking `TodoWrite` checklist cards to Google Antigravity Desktop 2.0 — 100% via non-invasive CDP runtime injection.**

[中文说明](#-功能亮点) · [Quick Start](#-一键安装-quick-start) · [Architecture](#-工作原理-how-it-works) · [English Summary](#english-summary)

---

## ✨ 为什么做这个项目？

很多同时深度使用 **Claude Desktop（Code / Cowork 模式）** 与 **Google Antigravity 2.0** 的用户都有两个强烈痛点：
1. **视觉噪音与交互拥挤**：
   - 原生模型下拉菜单把 9 个模型平铺挤成一列，每行重复印着 `Medium` 和满屏的 `新 / 快速 ⓘ / 提示 ⓘ` 角标，底栏还经常冒出突兀的橙色 `+38 sub` 胶囊；
   - 社区常见美化要么在输入框周围堆满 Emoji 挂件，要么套上泛黄底色、暗红粗框与打字机字体，设置页也容易出现说明文字反客为主的浓黑倒挂。
2. **“黑盒闷头干活”缺乏过程感**：
   - Antigravity 首次引导若选到默认的「知识工作模式（Knowledge Work）」，底层会强制开启 `ephemeralToolCalls: true`——**工具和 MCP 一跑完就瞬间销毁隐藏**；
   - 即便切回开发者模式，模型默认把思路憋在隐藏的 `thinking` 里不说话，回合结束瞬间外层 `已工作 Xm >` 会把整轮步骤二次打包吞没，React 卸载面板时也缺少收起动画，更没有 Claude 标志性的**置底跟随任务卡片（`TodoWrite`）**与**陶土橙双点旋转读秒行**。

本项目在不修改 `Antigravity.app` 安装包（不触碰 `app.asar`、不破坏 Apple 签名）的前提下，把**视觉层、模型与额度浮层、客户端隐藏配置层与 Agent 协作规则层**一次性打通。

> [!NOTE]
> “不改安装包”不等于“不改用户配置”：安装器会改写 `theme-patch/user/` 四个文件、`antigravity_state.pbtxt` 的 `product_skin`、`~/.gemini/config/config.json` 的 `verboseConversationSteps`，并在 `~/.gemini/AGENTS.md` 顶部插入规则块。每一项改动都记录在 `~/.gemini/antigravity/claude-ux/install-state.json`，`uninstall` 按记录逐项回滚。安装与自动更新会访问 GitHub；运行期界面层不发起外部请求。

---

## 🎯 功能亮点

### 1. 像素级对齐 `Claude.app` 纯白/暖炭黑界面与设置页（`user/custom.css`）
- **纯白通透浅色 + 暖炭黑深色**：浅色采用 `Claude.app` 原版纯白画布 `#FFFFFF` + 极淡中性灰侧栏 `#F9F9F8` + 无边框浅灰用户气泡 `#F3F3F0` + 中性灰行内代码 `#F3F3F1`；深色自动进入 Claude 暖炭黑（`#212120` 画布 / `#191918` 侧栏），告别刺眼冷蓝黑。
- **100% 无衬线苹方 + Anthropic Sans 精排**：全局 UI、AI 正文、用户气泡、输入框与浮层统一使用 `Anthropic Sans + PingFang SC`（`14px` / 行高 `1.65`），输入框占位符采用 `opacity: 1` 实色渲染消除发虚。
- **设置页 1:1 复刻**：纯白侧栏配 `#191918` 浓黑文字与 `#E5E5E5` 选中胶囊、自然中文短词导航（`常规 / 应用 / 外观 / 通知 / 模型 / 浏览器`），右侧采用 Google 官方蓝（`#2F75C3`）渲染开关与细轨滑块，彻底修复主副标题字重倒挂。

### 2. 1:1 Claude 极简分层模型菜单 + `◎` 实时套餐限额圆环（`user/custom.js`）
- **清爽分层模型选择器**：无损接管 `model-selector-trigger` 与 `⌘/` 快捷键（直连客户端原生 React Fiber `setSelectedModel` 状态机）：
  - 主列表顶部 `模型 · 本次会话` **仅保留 4 个日常主力 Gemini 模型**（`Gemini 4 Carbon` / `Gemini 4 Argon` / `Gemini 4 Hydrogen` / `Gemini 3.8 Flash`），清掉所有重复的 `Medium` 与 `新 / 快速` 角标噪音，打开菜单后按键盘数字 **`1～4` 即可秒切**；
  - 分割线下方独立拆分 **「思考强度 >」**（悬停弹出 `Low / Medium / High / XHigh` 二级面板）与 **「更多模型 >」**（分组收纳 `Orchestrator` 多智能体编排与 `Claude / GPT` 模型）。
- **模型旁 `◎` 上下文圆环 & 真实套餐限额浮层**：紧贴模型按钮右侧挂载动态进度圆环（按占用率自动由炭黑切琥珀黄/珊瑚红），点击即弹出 Claude 风格限额卡片，实时读取客户端原生 `retrieveUserQuotaSummary` 展示 `Ultra / Pro` 套餐下的 **当前上下文、5 小时限额与每周限额** 进度条及重置倒计时。
- **极简底栏遥测**：移除突兀的 `+38 sub`、`Ctx` 与 `Out` 冗余项，底栏中央仅保留干净居中的 `tok/s · TTFT`。

### 3. 解锁完整步骤流 + 190ms 双向丝滑折叠动画 + 陶土橙实时秒表
- **自动解锁隐藏步骤引擎**：一键切至 `PRODUCT_SKIN_DEVELOPER`（`project4kMode = 1`）并开启 `verboseConversationSteps: true`，永久保留所有文件读写、命令执行与 MCP 调用详情。
- **解除外层二次吞没 & 补齐收起动画**：自动解封回合末 `已工作 Xm` 套娃包裹，使每句进展说明与 `13px` 工具摘要平铺展示；通过 `.ag-collapse-ghost` 补齐 `190ms` 平滑收拢动画。
- **运行中陶土橙双点旋转 + 实时秒表**：按窗格锁定正在执行的最后一步工具行，行首挂载 `#D97757` 双子星旋转点，行尾挂载 `1s / 2s...` 读秒器（执行完毕即销毁，没有运行中的步骤时不保留 1 秒定时器）。

### 4. 运行期置底跟随 + 跨轮单卡接力的 `TodoWrite` 进度卡片
- **只接管执行进度清单**：以含 `- [/]`（进行中）条目的清单为起点，后续演化版本跨轮并入同一张卡；回答里普通的 `- [ ]` / `- [x]` 清单（材料清单、审查要点等）**原样显示、不接管**。
- **生成期间自动下跳置底（Live Dock）**：任务执行中，进度卡片自动悬浮停靠在输入框正上方（带柔和纯白渐隐遮罩），哪怕中间跑几十步工具也绝不会被顶出视野。
- **追问/改需求跨轮接力合并（防双卡 & 防僵尸转圈）**：
  - 任务未全部完成时，用户中途插话追问或补充需求，新一轮清单**自动吞并隐藏上一轮半截旧卡**，全屏始终只留最新 1 张活卡片；
  - 若中途打断，未完成的卡片保留在原位并标注「已暂停」（停止旋转），内容始终可见；
  - 当所有条目 **100% 打勾完工**（复刻 Claude `#666666` 实心圆白勾）后，卡片自动落位归档在总结上方作为完工记录。

### 5. 客户端版本更新自动跟随（0 Token 事件监听守护）
- macOS 安装时默认注册 `launchd` `WatchPaths` 守护（`com.antigravity.claude-ux.autosync`），监听 `Antigravity.app` 更新，并每 12 小时检查本仓库更新（`git pull --ff-only`，拉取后先做语法与 JSON 校验再部署）。
- 上游内核锁定在经过验证的提交（`install.mjs` 中的 `UPSTREAM_REF`），只升级、不会把你手动装的新版内核降级。
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

### 功能开关（排障用）
在 `~/.gemini/antigravity/theme-patch/user/config.json` 的 `modules` 中把对应项设为 `false` 即可单独关闭，热重载生效：

| 开关 | 作用 |
| :--- | :--- |
| `claudeUxStepUnfold` | 自动展开回合末「已工作 Xm」 |
| `claudeUxCollapseAnimation` | 工具面板收起动画 |
| `claudeUxTodoCard` | 执行进度卡片 |
| `claudeUxRunningTimer` | 运行中旋转点与读秒 |
| `claudeUxContextRing` | 上下文圆环、限额浮层、底栏精简 |
| `claudeUxModelMenu` | 分层模型菜单（关闭后恢复原生菜单） |

`customJs: false` 会一次性关闭以上全部脚本功能，`customCss: false` 关闭视觉层。

### 测试
```bash
npm i --no-save jsdom   # 可选：DOM 测试依赖，缺失时自动跳过
node --test test/
```
覆盖安装—同步—卸载—重复卸载、原文件缺失、用户配置合并、上游校验失败、CDP 断连/超时/异常、普通清单不被接管、热重载清理、键盘打开菜单、多窗格读秒等场景。未覆盖：真机像素比对、Windows 安装路径。

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
│  • Claude-matched Settings & #2F75C3│  • Auto-docking cross-turn Todo card  │
├─────────────────────────────────────┼───────────────────────────────────────┤
│ 3. Native Step Engine Unlocker      │ 4. Agent Collaboration Rule           │
│    install.mjs (CDP + pbtxt/json)   │    ~/.gemini/AGENTS.md                │
│  • PRODUCT_SKIN_DEVELOPER (mode 1)  │  • 1-2 sentence mid-turn updates      │
│  • verboseConversationSteps: true   │  • Cross-turn 3-state checklist sync  │
└─────────────────────────────────────┴───────────────────────────────────────┘
```

---

## 📊 开销说明 (Overhead)

| 模块 | 开销 | 说明 |
| :--- | :--- | :--- |
| 界面层（CSS、模型菜单、限额圆环、卡片、读秒） | 不占模型上下文 | 由 DOM 变化触发同步，合并到动画帧并限制为最多每 80ms 一次；自身写入的节点不会再次触发；没有运行中的步骤时无常驻定时器 |
| 全局规则（`AGENTS.md` 规则块） | 规则文本约数百 token，随系统提示词每轮发送 | 规则要求每次调用工具前写一句进展，输出 token 随工具调用次数增加 |
| 任务清单 | 只在 3 个阶段以上的任务中输出 | 每次更新都会重新输出整张清单 |

> 参考数据（非真机）：在 jsdom 中模拟约 150 轮、50 个展开命令面板的长对话，单次同步耗时由 v1 的约 72ms 降到约 23ms。真实 Chromium 中的数值会不同，仅供相对比较。

---

## <a id="english-summary"></a>English Summary

**Antigravity Claude UX** is a non-invasive customization and workflow suite for **Google Antigravity Desktop 2.0** (macOS / Windows) built as a user-space extension layer on top of [`Anarcadia/chuanban-antigravity-theme-patch`](https://github.com/Anarcadia/chuanban-antigravity-theme-patch):

- **Pixel-Matched `Claude.app` Visuals & Settings (`user/custom.css`)**: Pure `#FFFFFF` light canvas & `#212120` warm charcoal dark palette, unified `14px` sans-serif typography (`Anthropic Sans` + `PingFang SC`), clean single-layer composer (stripping `+sub` badge noise), and a 1:1 Claude-styled Settings sidebar paired with Google blue (`#2F75C3`) controls.
- **Stratified Claude Model Menu & Live Plan Quota Ring (`user/custom.js`)**: Replaces the crowded 9-row flat model dropdown with a clean Claude-style popover featuring the 4 core Gemini models (`1–4` hotkeys) plus dedicated `Thinking Effort >` (`Low / Medium / High / XHigh`) and `More Models >` flyouts wired directly to Antigravity's native React Fiber `setSelectedModel`. Adds a radial context progress ring next to the model pill that opens a real-time `5h / weekly` plan quota popover via `retrieveUserQuotaSummary`.
- **Cross-Turn Auto-Docking `TodoWrite` Card & Step Stream (`install.mjs` + `user/custom.js`)**: Unlocks `PRODUCT_SKIN_DEVELOPER` + `verboseConversationSteps: true`, unwraps end-of-turn accordions, and docks active `- [ ]` / `- [/]` / `- [x]` checklists directly above the composer while working — seamlessly merging mid-task follow-ups into a single live card, hiding interrupted incomplete cards, and archiving `100%` completed checklists in place.
- **Zero-Token Auto-Sync Watcher**: Registers a lightweight macOS `launchd` daemon (`com.antigravity.claude-ux.autosync`) that automatically pulls updates and re-applies settings across Antigravity app upgrades.

---

## 🙏 致谢与许可 (Credits & License)

- 底层 CDP 守护与汉化指标内核由 [@Anarcadia](https://github.com/Anarcadia) 的 [`chuanban-antigravity-theme-patch`](https://github.com/Anarcadia/chuanban-antigravity-theme-patch) 提供（本仓库不分发其内核文件，安装时按需引用上游）。
- 部分色彩语义与排查思路参考了 [@AlexByoung](https://github.com/AlexByoung) 的 [`Claudized-Antigravity`](https://github.com/AlexByoung/Claudized-Antigravity)。
- 本仓库内的全部扩展脚本、样式、安装器与规则文档采用 [MIT License](LICENSE) 开源。
