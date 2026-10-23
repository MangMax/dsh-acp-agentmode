# dsh-acp-agentmode

给 `dsh --profile acp`（Agent Client Protocol 自动化模式）增加一个参数：**启动时直接选定 agent preset**。

```bash
dsh --profile acp --agentmode cordis     # 本次进程的每个新会话都用 cordis preset
dsh --profile acp                        # 用 profile 配置的默认 preset（本包默认 standard）
dsh --profile acp --list-agentmodes      # 列出本 profile 声明的 preset
```

**默认不持久化**：不带参数时复用**当前 profile** 里用户已设定的 preset（并在日志里标明来源）；`--agentmode` 只覆盖本次启动；只有显式 `--remember` 才会把选择写进当前 profile。

> ⚠️ **设定按 profile 隔离（harness 设计，不是本插件的取舍）**：Web 界面里的"默认 preset"由 settings 服务写入**当前 profile** 的 `cordis.patch.yml`。桌面端 Web 界面 = `desktop` profile，所以在那里设的值**不会**自动带到 `dsh --profile acp`；acp 会退回本 bundle 声明的部署默认 `standard`。要让 ACP 跟随某个默认，用 `--remember` 写入 acp profile（推荐），或把值放进共享 home patch `$DSH_HOME/cordis.patch.yml`（它会压住 Web 表单对该字段的写入）。

工具链：**Vite+ 1.3**（`vp check` / `vp test` / `vp pack`）+ **pnpm** + **TypeScript 7**，零运行时依赖。

## 安装、构建与卸载

```bash
pnpm install        # 只装工具链（vite-plus / typescript / vitest / @types/node）
pnpm build          # vp pack → dist/index.mjs + dist/index.d.mts + sourcemap
git clone https://github.com/MangMax/dsh-acp-agentmode.git
dsh plugin --profile acp add ./dsh-acp-agentmode
```

- 也可以直接从 GitHub Releases 下载 tarball：`dsh plugin --profile acp add ./dsh-acp-agentmode-0.3.0.tgz`（未发布到 npm，刻意为之：这个包只在 acp profile 里有意义）。
- 该 bundle 只属于 **acp profile**。界面里的 `plugin_manager` 只作用于当前 profile（本机是 `desktop`），必须用 `dsh plugin --profile acp …`。
- 安装会写 profile 的 `dependencies` 并把 `dsh-acp-agentmode` **追加到** `dsh.profile.bundles` 末尾；patch 层按顺序应用，只有排在 `@deepseek-ai/dsh-acp-app` 之后的层才能覆盖它的行。
- profile 以 symlink 方式引用本目录，因此**改完代码必须 `pnpm build`**（harness 通过 package `exports` 加载 `dist/index.mjs`）。
- 卸载：`dsh plugin --profile acp remove dsh-acp-agentmode`，profile 回到“零参数 ACP”。

## 命令

| 命令                                | 作用                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm check` / `pnpm check:fix`     | `vp check`：格式化 + oxlint（含类型感知与 tsc 类型检查）                                                        |
| `pnpm test`                         | `vp test`：69 个单元测试（纯逻辑 + 假端口，无真实 harness）                                                     |
| `pnpm build`                        | `vp pack`：ESM 库构建（含 `.d.mts` 与 sourcemap）                                                               |
| `pnpm smoke -- --agentmode minimal` | 真实端到端冒烟：拉起 `dsh --profile acp`，走 `initialize → session/new`，再从**会话日志**断言 preset 真的挂上了 |
| `pnpm smoke`                        | 同上，但走"无参数"路径，验证 profile 设定的复用                                                                 |
| `pnpm sync-presets`                 | 从已安装的 `@deepseek-ai/dsh-web-app` 重新快照四个官方 preset 声明                                              |
| `pnpm verify`                       | `check && test && build`，即 `prepack` 的完整门禁                                                               |

## 目录与模块

```
src/constants.ts   限制、退出码、计时预算、preset id 语法（安全策略集中处）
src/ports.ts       四个协作方的最小结构接口（无 @deepseek-ai/cordis 版本绑定）
src/args.ts        严格参数解析（纯函数）
src/sanitize.ts    诊断文本净化（ANSI/控制字符/换行/路径）
src/errors.ts      错误码 + 退出码映射的唯一位置
src/log.ts         唯一写 stderr 的出口
src/selection.ts   roster 等待与 resolve（带回退重试与截止时间）
src/compose.ts     会话与 preset 的绑定策略（select / mount / 降级）
src/plugin.ts      Cordis 适配层：守卫、发布就绪、事件、清理
src/index.ts       包入口（导出 name/inject/apply 及公开错误类型）
tests/unit/*.test.ts  纯逻辑单测；tests/helpers/fakes.ts  手写假端口
scripts/sync-presets.ts / scripts/smoke-acp.ts
cordis.patch.yml + presets/*.patch.yml   组合层（见下）
```

设计要点：`ports.ts` 让插件**不依赖**具体 harness 版本的类型，也让人工假端口可以完整单测；`plugin.ts` 是唯一接触真实 Cordis 上下文的地方。

## 复用你的设定：读取 / 覆盖 / 持久化

registry 解析"新会话用哪个 preset"的公式是 `selectedDefault ?? default`：

- `default` 是本 bundle 的补丁声明的**部署默认**（`standard`），只是兜底；
- `selectedDefault` 是 **volatile 用户字段**——Web 设置界面里"默认 preset"写的就是它，由 settings 服务持久化到**当前 profile** 的 Cordis 补丁层。

所以插件本来就是"读用户设定"的，`--agentmode` 只是**本次覆盖**。三种用法与来源标注：

| 用法                                           | 行为                                                                                                             | 启动日志                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `dsh --profile acp`                            | 读 `selectedDefault ?? default`                                                                                  | `agent preset: ptc (user setting)` / `(home/command-line override)` / `(deployment default)` |
| `dsh --profile acp --agentmode cordis`         | 仅本次覆盖                                                                                                       | `agent preset: cordis (from --agentmode)`                                                    |
| `dsh --profile acp --agentmode ptc --remember` | 通过官方 `settings.update('agent-preset-registry', { selectedDefault })` 写入当前 profile 补丁，之后无参数即复用 | `remembered agent preset: ptc`                                                               |

`--list-agentmodes` 也会标出 `(default, user setting)` / `(default, override)`。

**为什么 desktop/web 里的选择不会自动带到 ACP**：settings 是**按 profile 持久化**的（写入 `profileContext.patchPath`），而 `dsh --profile acp` 是另一个 profile，有独立的补丁层与存储。想跨 profile 共用一份，两条路：① 在 acp profile 里 `--remember` 一次；② 写共享的 home patch `$DSH_HOME/cordis.patch.yml`（优先级高于 profile 补丁；注意此时 settings 表单写入会被拒绝，见上游 `dsh-settings` README）。插件不会去读别的 profile 的文件——那会破坏 profile 隔离。

## 它在 profile 里改了什么

`cordis.patch.yml` 四段，全部是普通 Loader patch：

1. **接管命令行**：`disable` 官方 `acp-app-startup` 行（零参数 commander program，任何额外参数都会 `error: unknown option`），插入本包的 `acp-agentmode` 行，由它提供官方 `acp` 行 inject 的 `acpAppStartup` 服务。
2. **agent 平面搬进 preset**：禁用 base 里 23 条“每 agent 各自贡献”的行（`tool-bash` / `tool-fs` / `tool-skill` / `tool-todo` / `tool-web` / `tool-subagent*` / `compaction-basic` / `agent-instructions` / `skill-filesystem` …），与 `@deepseek-ai/dsh-web-app/cordis.patch.yml` 对 Web 面的拆分同构——ACP 一个进程服务多个会话，而这些 base 行是为“单会话、进程级组合”的表面保留的。
3. **插入 preset 选择注册表**：`agent-preset-registry`，`default: standard`（仅在没有 `--agentmode` 时兜底）。
4. **插入 host 支撑行**：`subagent-model-selection-settings`、`plugin-inventory` —— preset 子行要消费、base 不提供的 Host 服务。

## 工作原理

**命令行**：`inject: ['cmdlineArgs']` → 严格解析 → `assertAcpProfile()` 守卫 → **同步发布** `acpAppStartup` → 后台解析 preset → 成功后才 arm stdin EOF。

就绪必须同步发布：App 层启动审计会独立结算 Loader 树，若让 readiness 等 registry I/O，慢一点就会被判成“启动失败”。解析失败则打印分类错误并以对应退出码退出。

**会话绑定**：`dsh-acp` 建 agent 时只传 `meta: { cwd }`，从不挂 preset（Web 的 session controller 是在自己的 `setup` 里 `agentPresets.mount`）。所以从外部接上：监听 serial 事件 `agent/created`（agent loop 在释放排队输入**之前** await 它），对空白会话调 `agentPresets.select(agent, id)` —— 这正是 Web UI 给“活着的空白会话”换 preset 用的公开 API，且 `select` 只在 `recompose/mount` 成功后写入 `agent-preset/selected`。`session/resume` 的会话已过首轮（`select` 会以 `agent-preset/locked` 拒绝），因此沿用日志记录的 preset 并用 `agentPresets.mount()` 组合。

**两个启动期竞态**：① 声明是异步注册的 —— 按 Loader 中声明行数等待 roster 到齐（有截止时间）；② profile 的启动 patch 重载会重建 registry 行 —— 只对 `agent-preset/not-found` 做抖动退避重试，`INACTIVE_EFFECT`（实例被替换）交给替换实例。另有一个 watchdog：registry 始终不激活时报 `E_ENVIRONMENT` 并退出，而不是让客户端在“永远不会被组合”的会话上打转。

## 安全加固

| 面          | 措施                                                                                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 参数面      | 只接受 `--agentmode` / `--agentmode=` / `--list-agentmodes` / `-h`；重复参数直接报错（不做 last-wins）；`--` 之后不允许位置参数；未知选项不静默忽略                          |
| 输入校验    | preset id 在进入 registry **之前**按 `^[A-Za-z0-9][A-Za-z0-9._-]*$`、长度 ≤ 64 校验：不允许空白、控制字符、前导分隔符（防止被下游当成 flag）                                 |
| 组合守卫    | 启动时检查组合里确实有 `@deepseek-ai/dsh-acp` 行、且官方零参数启动行已被禁用；否则以 `E_ENVIRONMENT` 退出——误装到别的 profile 会**响亮地失败**而不是劫持它的 stdin/退出语义  |
| 服务发布    | 只发布一次；若别的 row 已发布 `acpAppStartup`，记警告并让位，不抛错、不崩溃                                                                                                  |
| 诊断卫生    | 所有 stderr 输出经 `oneLine` + `redactPaths`：剥离 ANSI/OSC 与控制字符（防终端劫持）、压成单行（防日志伪造）、长度截断、把 `$HOME`/`$DSH_HOME`/绝对路径替换为 `~` / `<path>` |
| 代码面      | 无 `eval`/`Function`/动态 import；不读 stdin（只挂 `end` 监听并在卸载时移除）；不调用 `process.exit`（走 launcher 的 `appExit`）；零运行时依赖                               |
| 生命周期    | 每个实例一个 `AbortController`，卸载即中止所有等待并清理全部定时器，不留悬挂句柄                                                                                             |
| stdout 纯净 | stdout 只允许 `--help` 与 `--list-agentmodes` 两个出口；ACP 协议帧独占 stdout，冒烟脚本会断言 stdout 不含诊断文本                                                            |

## 性能

- **启动零阻塞**：readiness 同步发布；preset 解析在后台，首个 `session/new` 会 await 同一个 promise（只解析一次）。
- **不做忙等**：等待策略是“先让 Loader 静止（有界 race）→ 再按声明行数等 roster”；退避 20ms 起、160ms 封顶，全部有截止时间；不存在固定轮询热路径。
- **零热路径开销**：已绑定 preset 的 agent 只做一次 `composedPreset()` 判断即返回；subagent 子代理在自身 setup 里继承父级，直接跳过。
- **构建产物**：单文件 ESM 31.6 kB（gzip 10.5 kB），无运行时依赖、无 top-level 副作用。
- **清理**：定时器统一由实例时钟登记，卸载即 `clearTimeout`。

## 错误模型

| 错误码              | 含义                                                                              | 退出码 |
| ------------------- | --------------------------------------------------------------------------------- | ------ |
| `E_USAGE`           | 调用本身不对（未知选项、缺值、非法 id、重复参数）                                 | 2      |
| `E_PRESET_UNKNOWN`  | id 不在 roster（消息附可用列表）                                                  | 3      |
| `E_PRESET_UNUSABLE` | 声明存在但无法激活（消息附 registry 给出的原因，如缺 `cordisInspect`）            | 3      |
| `E_REGISTRY`        | registry 未在预算内响应                                                           | 3      |
| `E_ENVIRONMENT`     | 组合不对（不是 ACP app、官方启动行仍激活、注入缺失、registry 从未激活）           | 4      |
| `E_BIND`            | 单个会话绑定失败——只 `warning`，降级为“无 preset 组合”，绝不让 `session/new` 失败 | —      |

`DSH_ACP_AGENTMODE_DEBUG=1` 会额外输出 cause 链与（净化后的）栈，默认只输出一行分类错误。

## 已验证

单测：`vp test` — **7 个文件 / 85 个用例**全绿（参数语法、诊断净化、roster 等待、resolve 分类与重试、空白会话判定、绑定降级、设定来源判定与 `--remember` 写入、`apply()` 的 help/守卫/发布/列表/重复发布等）。

静态门禁：`vp check` — 格式化 + oxlint（类型感知）+ tsc 类型检查，**0 error / 0 warning**。

真实端到端（本机 0.2.1-rc.2，最小 ACP 客户端，不触发模型调用）：

| 用例                                      | 结果                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `--agentmode standard/minimal/ptc/cordis` | 会话创建成功；会话日志分别写入 `agent-preset/selected: standard/minimal/ptc/cordis`                |
| 不带参数                                  | 默认 `standard`                                                                                    |
| `--agentmode nope`                        | exit 3，`E_PRESET_UNKNOWN: unknown agent preset "nope"; available: standard, ptc, minimal, cordis` |
| `--bogus`                                 | exit 2，`E_USAGE: unknown option "--bogus"`                                                        |
| `--list-agentmodes` / `--help`            | exit 0，输出正确                                                                                   |
| `session/resume`（空白会话）              | 成功，组合沿用日志记录的 preset                                                                    |
| `pnpm smoke -- --agentmode minimal`       | 通过（脚本自行读会话日志断言）                                                                     |
| stdout 纯净                               | 客户端只收到 JSON-RPC 帧                                                                           |

未实测：`session/resume` 的**非空白**会话（`mount` 分支）需要先产生一轮真实模型对话。

## 已知能力边界

- **设定按 profile 隔离**：`selectedDefault` 只存在于写入它的那个 profile；跨 profile 没有共享存储（同机 desktop/web/acp 各自独立）。要跨 profile 统一，用共享 home patch，代价是 Web 表单此后改不动该字段。
- **粒度是进程级**：一次 `dsh --profile acp` 一个 preset。要让 ACP 客户端**按会话**指定，必须改 harness 的 `dsh-acp`（`session/new` 的 `_meta` 被 SDK 保留但 bridge 完全忽略），纯插件做不到。
- **preset 不含模型**：preset 组合工具/提示词段/skills/压缩/委派；模型仍由 `acp` 行与 `agent-default-model` 决定，客户端还能用 `session/set_config_option` 改 `model`/`reasoning_effort`。
- 两个子行在该表面不可用，已在快照中 `disabled: true` 并保留上游原文：`tool-schedule`（需要 Web 专属 `sessionController` 支撑的 `schedule`）、`tool-cordis`（需要 Web 专属 inspector 的 `cordisInspect`）。因此 `cordis` preset 在 ACP 面上可用但缺少 cordis 运行时查询工具。
- 禁用清单镜像 Web 面的 23 行：上游**改名**只会产生 “warn + skip”（不致命）；上游**新增** agent 平面行会留在 host 平面并被 preset 同名行就近遮蔽，但可能带来额外 token 开销——升级后建议对照一次。
- 桌面界面的 `plugin_manager` 看不到它（不同 profile）；`locale/`、`icon.svg` 只为清单完整性准备，渲染效果无法在桌面 UI 验证。

## 升级维护

```bash
pnpm sync-presets                       # 从当前安装的 harness 重新快照 presets/
pnpm sync-presets /path/to/dsh-web-app  # 或显式指定包目录
```

脚本会按当前 harness 版本重新生成四个 preset 声明，并自动给“本表面不可用”的子行加 `disabled: true`（清单与原因写在脚本里）。升级 harness 后建议再跑一次 `pnpm verify && pnpm smoke`。

## 依赖的公开 API

`ctx.cmdlineArgs` / `ctx.appExit` / `ctx.appReady`（启动器值），`ctx.agentPresets.{list,resolve,select,mount,composedPreset,defaultId}`，`ctx.sessionProjections.stateOf(session, 'agentPreset' | 'turnBoundary')`，serial 事件 `agent/created`，Loader 的 `entries()` / `await()`。全部为公开契约，未触碰内部实现。

## 贡献与安全

- 参与开发：见 [CONTRIBUTING.md](CONTRIBUTING.md)（本地门禁是 `pnpm verify`；`dist/` 不入库，Release 构建产出）。
- 报告漏洞：请走 [SECURITY.md](SECURITY.md) 的私密渠道，不要开公开 issue。
- 行为准则：[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

`main` 受保护：所有改动经 PR + CI 全绿 + 维护者审核后合并。

MIT License.
