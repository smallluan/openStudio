# Lobster Studio（OpenClaw 像素工作室）开发规划

本文档描述从「Electron + React 壳」走向「可扩展的龙虾工作室交互」的**阶段化路线**。条目按**编号顺序**推进；每一阶段应尽量**可演示、可回滚**，避免大爆炸式改造。

---

## 1. 目标与原则

1. **产品形态**：像素风工作室场景 + 底部对话栏；每只龙虾对应**独立智能体**，状态（思考 / 工作 / 休闲等）决定**分区与动画**。
2. **能力来源**：模型与通道仍遵循 **OpenClaw 正式链路**；用户自备 **API Key / 配置文件**，应用不内置密钥。
3. **技术原则**  
   - **主进程**：OpenClaw、文件与密钥落盘、子进程（未来 gateway）统一放主进程。  
   - **渲染进程**：仅通过 **preload 暴露的窄 IPC** 访问能力。  
   - **数据驱动**：分区表、龙虾列表、状态机规则以**可替换的配置/纯函数**维护，便于加新区、新状态、新角色。

---

## 2. 阶段 A — 基础骨架（当前迭代）

1. **目录约定**（已实现或占位）：`src/studio`（领域逻辑）、`src/components`（按 shell / studio / dev 分层）、`lib/`（主进程可复用模块）。  
2. **用户配置**：`userData` 下 JSON 存版本号、OpenClaw 相关端点、凭证是否存在；**主进程读写**，渲染进程只拿到脱敏视图。  
3. **场景 MVP**：全屏布局 + **逻辑坐标（0–100%）** 的分区注册表 + 单只龙虾占位「棋子」；不接真实 LLM。  
4. **开发面板**：OpenClaw 运行时信息独立为 dev 面板，不阻塞主 UI。

**完成标准**：应用启动后能看到工作室布局与一只可随状态切换分区的龙虾占位；配置 IPC 可写入网关地址等（密钥不落渲染层详情）。

---

## 3. 阶段 B — 状态机与多龙虾

1. 为每只龙虾维护：`id`、`displayName`、当前 `AgentMode`、当前 `ZoneId`、绑定的 **OpenClaw session/agent 标识**（具体字段与官方配置对齐后再定）。  
2. **状态转换**：由「用户输入 / OpenClaw 流式事件 / 空闲计时」触发；先 **单元测试级纯函数**（`src/studio`），再接入 IPC。  
3. **多工位**：分区表中增加 `anchors[]`（每只龙虾默认站位），渲染层按 id 取锚点。

**完成标准**：≥2 只龙虾、各自状态独立；状态变更驱动移动动画（可先线性插值）。

---

## 4. 阶段 C — OpenClaw 真连接

1. **Gateway 策略**：二选一或同时支持——**连外部 gateway URL**、或由主进程 **spawn `openclaw gateway`**（生命周期与崩溃重启策略单独文档化）。  
2. **鉴权**：将阶段 A 的凭证以 OpenClaw 期望的方式注入（环境变量 / 配置文件路径）；评估 **OS keychain / safeStorage** 加密落盘。  
3. **事件桥**：把 gateway 的会话/工具/错误事件映射为阶段 B 的状态输入。

**完成标准**：底部输入一条消息 → 对应龙虾进入 working/thinking → 流结束恢复 idle/break。

---

## 5. 阶段 D — 表现与资源

1. **美术管线**：角色精灵表、场景切片与参考图一致；统一 tile/调色板约定。  
2. **动画**：行走/站立/坐姿等状态机动画；与 `AgentMode + ZoneId` 绑定。  
3. **性能**：大图资源 lazy load；可选离屏 canvas 或 CSS Transform 批量更新。

---

## 6. 阶段 E — 打包与发布

1. **electron-builder**（或等价）：`asar`、**原生依赖 unpack**（OpenClaw 子依赖若有）。  
2. **自动更新 / 代码签名**：按平台排期。  
3. **隐私说明**：密钥存储方式、遥测（默认关）。

---

## 7. 近期任务清单（建议顺序）

1. 维护本文档与 `src/studio` 内 JSDoc/注释中的「契约」（分区 id、模式枚举）。  
2. 在阶段 B 开始前 frozen 一版 **AgentMode ↔ 默认分区** 映射表。  
3. 阶段 C 前阅读 [OpenClaw Configuration](https://docs.openclaw.ai/gateway/configuration) 与 Gateway 协议文档，确定 **一虾一会话** 的字段名。  
4. 每阶段结束打 tag 或简短 CHANGELOG，便于回滚。

---

## 8. 文档索引

| 文档 | 说明 |
|------|------|
| `docs/DEVELOPMENT_PLAN.md` | 本规划（阶段与编号） |
| `lib/config-store.cjs` | 主进程用户配置（写入 `app.getPath('userData')/studio-user-config.json`） |
| （后续）`docs/ARCHITECTURE.md` | IPC、数据流、与 OpenClaw 边界（待阶段 C 补强） |

---

*最后更新：与仓库「阶段 A」基础改造同步。*
