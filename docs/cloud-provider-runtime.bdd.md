# 云端业务凭证运行时 - BDD 规格

> 云端 Agent 需要在不接触明文凭证、不依赖本地 `.env.live` 的前提下，按业务 profile 安全读取各 provider 的真实数据。
> 状态：**草稿 - 待确认**

## 范围边界

**包含：**

- 云端按业务 profile 选择 provider 配置
- 云端通过平台 secret 注入 provider 凭证
- Agent 在任何真实读取前先执行 readiness 检查
- 缺失、过期、错配 secret 时给出可恢复诊断
- 本地 live profile 与云端 secret injection 的边界
- 多业务、多环境并存时的隔离规则

**不包含：**

- secret manager 的具体供应商实现
- provider 业务指标解释、报告、归因判断
- gkit provider capability 的具体查询字段设计
- 把本地 `.env.live` 同步到云端
- 在仓库中保存任何真实凭证

## 前提假设

- 业务 profile 是云端任务的业务归属标识，例如 `openclaw-web`。
- 云端 secret 以业务命名保存，例如 `OPENCLAW_*`，运行时再映射成 gkit profile 引用的标准输入。
- 本地和云端都以业务 profile 为默认配置边界；repo-local `.env.live` 只用于临时兼容验证。
- gkit 的每个 provider adapter 都保留 provider-native truth，不在 CLI 层生成业务洞察。

---

## 功能 1：云端按业务 profile 启动

> Agent 需要先知道本次任务属于哪个业务，再决定读取哪些 provider truth。

**场景 1.1：任务带有明确业务 profile 时启动**
Given 云端任务声明了业务 profile
And 该 profile 对应的 provider secrets 已在平台中配置
When Agent 启动 provider 读取流程
Then Agent 使用该业务 profile 作为本次任务的唯一业务归属
And 后续读取只使用该 profile 绑定的 provider secrets
And Agent 不需要知道 secret 的明文内容

**场景 1.2：任务没有声明业务 profile 时停止**
Given 云端任务没有声明业务 profile
When Agent 准备读取任意真实 provider 数据
Then Agent 停止读取流程
And 返回“缺少业务 profile”的诊断
And 不尝试使用默认业务或本地配置兜底

**场景 1.3：profile 存在但没有绑定目标 provider**
Given 云端任务声明了业务 profile
And 该 profile 没有绑定目标 provider 的 secret
When Agent 请求该 provider 的真实数据
Then Agent 返回“该业务未配置目标 provider”的诊断
And 不从其他业务 profile 借用 secret

---

## 功能 2：云端通过 secret injection 提供凭证

> 云端运行时只负责把平台 secret 注入为 CLI 可读输入，不把凭证写入仓库或构建产物。

**场景 2.1：通过环境变量注入 service account JSON**
Given 平台 secret 中保存了目标 provider 的 service account JSON
And 云端任务声明了正确业务 profile
When 运行时启动 gkit provider command
Then CLI 可以从运行时环境读取该 provider 的凭证
And 仓库中不会出现真实凭证文件
And 输出日志不会打印 secret 明文

**场景 2.2：必须使用临时文件时只写入短生命周期目录**
Given 某个 provider 只能通过文件路径读取凭证
And 平台 secret 中保存了 service account JSON
When 运行时准备 gkit provider 输入
Then 运行时把凭证写入任务级临时目录
And CLI 只接收该临时文件路径
And 任务结束后该临时文件随运行环境销毁

**场景 2.3：本地 `.env.live` 不参与云端运行**
Given 仓库中存在本地 live validation 文档
And 开发机可以使用 `.env.live`
When 云端任务启动
Then 云端不读取 `.env.live`
And 云端只使用平台注入的 profile 与 secrets
And 本地配置缺失不会影响云端任务

**场景 2.4：本地开发也按业务 profile 读取凭证**
Given 开发机已经创建业务 profile 目录
And profile 目录中保存了本地只读 provider 凭证
When Agent 在本地执行 gkit provider command
Then CLI 按业务 profile 读取 provider 配置
And 不要求每个 provider 维护自己的凭证目录
And repo-local `.env.live` 不是默认配置来源

**场景 2.5：repo 只声明 profile id，不声明 provider 凭证**
Given 开发机已经创建业务 profile 目录
And 当前 repo 的 ignored `.env.local` 只声明了业务 profile id
When Agent 执行 gkit provider command
Then CLI 先读取 repo 中的 profile id
And 再读取该 profile 目录下的 provider 配置
And profile 中的 provider 配置不会被 repo fallback 配置覆盖

---

## 功能 3：真实读取前必须 readiness 通过

> Agent 需要先证明运行时已准备好，再读取 provider truth，避免把配置错误误判为业务事实缺失。

**场景 3.1：readiness 通过后执行低量真实读取**
Given 云端任务声明了业务 profile
And 目标 provider 的必要 secrets 已注入
When Agent 准备读取真实 provider 数据
Then Agent 先执行 readiness 检查
And readiness 通过后才执行低量真实读取
And 低量读取成功后才允许执行更宽的数据读取

**场景 3.2：readiness 未通过时停止业务读取**
Given 云端任务声明了业务 profile
And 目标 provider 的 readiness 检查未通过
When Agent 准备读取真实 provider 数据
Then Agent 停止后续 provider 读取
And 返回可恢复诊断
And 不用其他 provider 的数据推断该 provider 的 truth

**场景 3.3：可选配置缺失不阻断不需要它的读取**
Given 云端任务声明了业务 profile
And 某个 provider 的可选配置未注入
And 本次读取不需要该可选配置
When Agent 执行 readiness 检查
Then readiness 可以带 warning 通过
And Agent 可以继续执行不依赖该可选配置的读取

---

## 功能 4：错误与恢复行为

> Agent 需要把配置问题、权限问题、provider 故障和无数据区分开，避免错误恢复路径污染业务判断。

**场景 4.1：缺失必要 secret 时返回配置诊断**
Given 云端任务声明了业务 profile
And 目标 provider 缺少必要 secret
When Agent 执行 readiness 检查
Then Agent 收到“必要 secret 缺失”的诊断
And 诊断包含缺失项名称
And 不发起真实 provider 查询

**场景 4.2：凭证存在但无权访问目标业务资源**
Given 目标 provider 的凭证已注入
And 该凭证无权访问当前 profile 绑定的业务资源
When Agent 执行低量真实读取
Then Agent 收到“provider 权限不足”的诊断
And 诊断能与“查询结果为空”区分开
And Agent 不把该失败解释为业务资源没有数据

**场景 4.3：provider 暂时不可用时保留原始失败**
Given 目标 provider 的凭证和 profile 配置都正确
And provider 返回临时失败或限流
When Agent 执行真实读取
Then Agent 返回“provider 暂不可用”的诊断
And 标记该失败是否可以重试
And 不用缓存、猜测或其他 provider 数据替代本次 provider truth

---

## 功能 5：多业务与多环境隔离

> 同一套 CLI 可以服务多个业务，但每次云端任务只能使用一个明确的业务上下文。

**场景 5.1：两个业务 profile 同时存在时互不串用**
Given 平台中同时存在多个业务 profile 的 secrets
And 云端任务声明使用其中一个 profile
When Agent 读取 provider truth
Then Agent 只使用该 profile 绑定的 secrets
And 不读取其他 profile 的 provider secrets
And 输出中标明本次使用的业务 profile

**场景 5.2：生产与测试环境同时存在时必须显式选择**
Given 同一业务同时存在生产和测试 secrets
When Agent 准备读取真实 provider 数据
Then Agent 必须使用任务声明的环境
And 未声明环境时停止读取流程
And 不默认使用生产环境

**场景 5.3：只读 provider 读取不产生业务侧副作用**
Given Agent 使用业务 profile 读取 provider truth
When Agent 执行只读 gkit provider command
Then provider 侧不会产生写入、变更、投放调整或账务动作
And 本次任务只产出可审计的事实输出或诊断

---

## 配置状态真值表

| 业务 profile | 必要 secrets         | readiness        | 真实读取       | Agent 行为            |
| ------------ | -------------------- | ---------------- | -------------- | --------------------- |
| 已声明       | 完整                 | 通过             | 允许低量读取   | 先验证再扩大读取      |
| 已声明       | 缺失                 | 失败             | 不允许         | 返回缺失配置诊断      |
| 未声明       | *                    | 不执行           | 不允许         | 返回缺少 profile 诊断 |
| 已声明       | 完整但无权限         | 可通过或读取失败 | 不允许扩大读取 | 返回权限诊断          |
| 已声明       | 完整但 provider 限流 | 失败或读取失败   | 可稍后重试     | 返回可重试诊断        |

## 验收说明

- 云端任务不得依赖本地 `.env.live`。
- 真实 secret 不得进入 git、构建产物或普通日志。
- 任意 provider 读取前必须存在可审计的 readiness 结果。
- 缺配置、权限不足、provider 暂不可用、真实无数据必须能区分。
- CLI 输出仍保持 provider truth，不在 CLI 层生成业务解释。
