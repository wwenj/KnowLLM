# llmWiki 架构设计

> 本文只保留已经确认的核心架构。待确定内容和当前明确接受的限制统一放在文末。

llmWiki 是编译型语义 Wiki：原始 Source 是事实来源，模型负责把原文整理成稳定、可读、适合 Agent 使用的 Wiki 页面。

```text
Source 编译任务
  -> 可选物理切片
  -> 一个或多个 Compile Unit
  -> 每个 Compile Unit 独立执行 Page Planner
  -> 每个 Compile Unit 执行一次统一多页面 Writer
  -> Source 结果原子合并到共享 Staging
  -> 人工确认
  -> 原子替换正式 Wiki
  -> Agent 只读消费正式 Wiki
```

核心原则：准确度优先；模型调用和 Token 可以高，但必须能够在执行前估算并设置硬上限，禁止隐式增加调用。

## 1. Source 编译任务

### 1.1 入口并发

前端触发编译时允许手动设置 Source 并发数，默认值为 `1`。并发限制只作用于原始 Source 进入编译任务之前；Source 被任务接收并完成切片后，内部 Compile Unit 不再占用 Source 并发名额，也不额外设置统一并发上限。

一个 Source 从开始编译到成功合并或失败，始终属于同一个 Job。Job 结束后，共享 Staging 独立保留并可继续接收后续 Job，直到统一发布或撤销。切片、Plan、页面和 Facts 始终引用原始 `sourceId`。

### 1.2 Source 快照

任务开始时固定本次使用的 Source 内容，后续所有阶段都基于同一份快照执行。

```ts
type SourceSnapshot = {
  sourceId: string;
  content: string;
  contentHash: string;
};
```

## 2. 切片与 Compile Unit

切片只用于解决原文超过模型有效上下文的问题，不代表 Wiki 页面结构，也不改变原始 Source。完整原文能够被模型稳定处理时默认不切片。

当前采用程序物理切片，不调用模型。切片保持原文顺序和内容，不做摘要、改写或事实抽取。

```ts
type CompileUnit = {
  unitId: string;
  sourceId: string; // 始终为原始 Source ID
  content: string;
  startOffset: number;
  endOffset: number;
  startLine: number; // 在原始 Source 中的起始行
  contentHash: string;
};
```

不切片时，完整 Source 直接形成一个 Compile Unit；切片后，每个分片形成一个 Compile Unit，并独立进入与普通 Source 相同的 Planner、Writer 流程。

Compile Unit 只是任务内的中间产物。最终正式数据只保留原始 Source 与 Wiki 页面的对应关系，不把切片作为独立 Source，也不让 Agent 感知切片。

### 2.1 动态页面上限

后端按每个 Compile Unit 的字符数计算局部 `maxPages`，不由前端传入：

| 字符数 | maxPages |
|---:|---:|
| 1～4,000 | 2 |
| 4,001～10,000 | 3 |
| 10,001～19,000 | 4 |
| 19,001～31,000 | 5 |
| 31,001～46,000 | 6 |
| 46,001～64,000 | 7 |
| 64,001 以上 | 8 |

`maxPages` 只是上限，最低为 `2` 是为了保留拆页弹性，Planner 仍可只返回 `1` 页。规则使用固定阈值数组，并将版本纳入编译 `confirmHash`。

### 2.2 调用估算

设本次共形成 `U` 个 Compile Unit，则模型调用上限为：

```text
U 次 Page Planner + U 次统一 Writer = 2U
```

输出 Token 上限为 `U × plannerMaxOutputTokens + U × writerMaxOutputTokens`。估算结果同时返回每个 Unit 的字符数、`maxPages` 和全部 Unit 的最大规划页面数。

当前默认 `chunkChars=12000`、Planner 输出上限 `2000 tokens`、Writer 输出上限 `8000 tokens`；Source 并发默认为 `1`，允许 `1~16`。每次模型调用最多等待 `5` 分钟。

物理切片不产生模型调用。任一 Compile Unit 的 Planner 或 Writer 输出异常、超时，所属 Source 整体失败，不写入部分结果，也不重试或隐式追加模型调用。

## 3. Wiki Page Plan

每个 Compile Unit 独立读取当前可见的 Wiki 页面目录，规划本单元应该创建或更新的页面。Planner 只负责页面规划，不生成正文和 Facts。

### 3.1 页面 ID

`pageKey` 是后端生成的永久唯一 ID，不包含标题、路径或主题语义。页面改名、移动或调整目标时不修改 `pageKey`。

后端在调用 Planner 前预生成一组不重复的 8 位随机 ID，并与已有页面和本次任务已预留的 ID 做冲突校验。

规则：

- `create` 只能使用后端预生成且未占用的 ID。
- `update` 必须使用真实存在的已有页面 ID。
- 同一 Plan 中 `pageKey` 不得重复。
- 页面关联可以引用已有页面，也可以引用同一 Plan 中创建的页面。
- 未被 Planner 使用的预生成 ID 在 Plan 结束后释放。

### 3.2 数据结构

```ts
type ExistingPage = {
  pageKey: string;
  title: string;
  goal: string;
};

type WikiPagePlan = {
  sourceId: string; // 后端注入
  unitId: string; // 后端注入
  partitionIntent: string;
  pages: Array<{
    pageKey: string;
    operation: "create" | "update";
    title: string;
    goal: string;
    scope: string;
    outline: Array<{
      heading: string;
      writingPoints: string[];
      sourceAnchors: string[];
    }>;
    relatedPageKeys: string[];
  }>;
};
```

当前不设置 `pageType`。页面用途和写作要求统一由 `goal` 表达。

### 3.3 Planner 提示词

```text
System:

你是 llmWiki 的 Wiki 页面规划器。

你会收到带原始全局行号的完整当前 Compile Unit、已有 Wiki 页面目录、本次允许使用的新页面 ID 和动态 maxPages。
你的任务是规划本单元应该创建或更新哪些 Wiki 页面。

规则：
1. 只生成写作计划，不生成最终正文或 Facts。
2. partitionIntent 说明整体拆分思路；每页的 scope + outline 明确负责内容和拆分边界。
3. outline 中每个章节必须给出具体 writingPoints 和用于定位原文的 sourceAnchors。
4. 按用户阅读目的组织页面，同一内容不得同时分配给多页重复展开。
5. 外部链接、目录项或“参见某文档”不能视为已有正文。
6. pages 可少于 maxPages，但至少返回 1 页，不得为凑数量拆页。
7. 已有页面与当前目标一致时优先 update，否则 create。
8. create 只能使用 availablePageKeys；update 只能使用 existingPages 中的 ID。
9. 只返回指定 JSON。

User:

已有页面：
{{existingPagesJson}}

可用新页面 ID：
{{availablePageKeysJson}}

当前 Compile Unit：
<source>
{{compileUnitContent}}
</source>

最大页面数：{{maxPages}}
```

### 3.4 Plan 校验

模型返回后，后端只做确定性的协议和 ID 校验：

- 输出必须是合法 JSON 对象，`pages` 必须是 `1~maxPages` 的非空数组。
- `partitionIntent` 和所有必填字符串不得为空。
- `outline`、`writingPoints`、`sourceAnchors` 必须是非空数组，内部字符串不得为空。
- `relatedPageKeys` 必须是数组，允许为空。
- `create` ID 必须来自预生成 ID 集合。
- `update` ID 必须属于已有页面。
- 同一 Plan 中 ID 必须唯一。
- 页面不得关联自身。
- `relatedPageKeys` 必须属于已有页面或同一 Plan 创建的页面。

校验失败时所属 Source 执行失败。语义覆盖率、scope 合理性、页面语义重复等问题不做后端判断。

## 4. 统一 Writer 与 Key Facts

每个 Compile Unit 的 Planner 产出完整多页面 Plan 后，只调用一次统一 Writer。Writer 同时看到完整 Unit 和完整 Plan，一次生成该 Unit 涉及的全部页面。

```text
带全局行号的完整 Compile Unit
  + 完整 WikiPagePlan
  + 本 Plan 中 update 页面的最新完整正文
  -> 1 次统一 Writer
  -> 当前 Unit 的全部页面正文与 Key Facts
```

`existingPages` 只包含当前 Plan 中 `operation=update` 的页面：create 页面不传旧正文，不传整个 Wiki，也不传旧 Key Facts。

### 4.1 数据结构

```ts
type MultiPageWriterInput = {
  sourceId: string;
  completeSource: string; // 带原始全局行号的完整当前 Unit
  pagePlan: WikiPagePlan;
  existingPages: Record<string, {
    title: string;
    goal: string;
    bodyMarkdown: string;
  }>;
};

type MultiPageWriterOutput = {
  pages: Array<{
    pageKey: string;
    bodyMarkdown: string;
    keyFacts: Array<{
      fact: string;
      sourceLine: number;
    }>;
  }>;
};
```

Writer 不能改写 title、goal 和关联关系，这些字段只使用 Plan 数据。模型不返回 `sourceId`，后端持久化时统一注入原始 Source ID。

### 4.2 Writer 核心规则

- 当前 Compile Unit 是本次写入的唯一事实来源。
- 严格按 `partitionIntent + scope + outline` 决定内容归属，分配给其他页面的知识不重复展开。
- 必要的共享前置条件或安全警告可以保持一致地重复。
- Writer 必须返回 Plan 中所有 pageKey 且各返回一次，不得缺页、多页或重复。
- create 返回完整新页面；update 以 `existingPages` 为基线，返回合并后的完整正文。
- update 不得删除仍成立的旧事实、命令、参数、条件、限制和警告。
- 完整 Source、Plan 和 update 正文超过模型上下文时，由 provider 返回错误，当前 Source 原子失败；不截断、不降级为多个 Writer、不重试。

### 4.3 Writer 输出校验

- Writer pageKey 集合必须与 Plan 完全一致。
- `bodyMarkdown` 必须为非空字符串。
- create 页面已存在或 update 页面不存在时，当前 Source 失败。
- Writer 提示词要求 `sourceLine` 返回单个 JSON 整数；后端兼容纯数字字符串和常见行号范围，无法得到有效行号时保存为 `null`，不影响 Fact 和正文进入 Staging。
- 其他结构不合法时按 Writer 异常处理。

### 4.4 Facts 边界

Facts 是辅助检索和回到原文附近查找的少量记录，不承担正文完整性证明，也不作为发布正确性的校验层。

当前规则：

- 只记录忽略后可能导致错误操作、安全或设备风险、版本或兼容问题的非直觉限制、关键参数和异常条件；不记录页面摘要、普通背景、一般步骤和低影响事实。
- 每个 Page Plan 最多保留 5 条 Facts。
- 不设置单个 Source 的 Facts 总上限。
- 每页 Facts 先做 NFKC、大小写、空格和尾部标点规范化去重，再保留前 5 条。
- 同一 Source 的多个 Unit 更新同页时，新 Facts 按 Unit 顺序追加并做同样的文本去重。
- `sourceId` 不由模型返回，后端统一注入当前原始 Source ID。
- `sourceLine` 只用于辅助定位，格式异常或越界不会使 Source 编译失败。
- 不保存原文证据，不校验 Fact 真实性或完整性。
- update 时页面已有 Facts 原样保留且不重新校验，本次保留的 `0~5` 条 Facts 再写入页面 Facts 集合。
- 模型输出无法解析或结构不合法时，按执行异常处理。

## 5. Update 合并与任务锁

锁只负责保证同一页面的 update 不被并发覆盖。create 使用预生成的唯一 `pageKey`，不处理语义重复页面。

### 5.1 Update 执行

- 同一 Source 的 Planner 可并行执行；全部 Plan 成功后，收集涉及的全部 pageKey 并按固定顺序加锁。
- Writer 必须按 Compile Unit 的 `startOffset` 顺序串行执行。
- Source 内部使用私有工作副本；后一 Unit 优先读取前一 Unit 对同页的更新，其次读取加锁后的共享 Staging。
- 所有 Unit 的 Writer 都成功后，才生成一次 Source Overlay 并原子提交到共享 Staging。
- 任一 Writer 失败时丢弃该 Source 全部私有结果，不留下部分页面。

### 5.2 锁生命周期

页面锁由 Source 执行持有，在 Source Overlay 提交成功、失败或取消后主动释放。

```text
pending -> planning -> writing -> completed
                         -> failed / cancelled
```

规则：

- 同时只允许一个编译 Job 运行，Job 内 Source 并发数由前端配置，默认为 `1`。
- 无论 Source 成功还是异常，都必须主动执行锁释放逻辑。
- 当前不设置锁超时，也不自动回收锁。
- 取消时先让 Job 写令牌失效，再中止模型请求；每次异步返回和写入前都重新校验令牌。
- 晚到的模型结果不得写入 Source 私有结果、Staging 或正式 Wiki。

## 6. Staging 与发布

全系统同时只存在一个未发布共享 Staging。每个成功 Source 都以 Overlay 形式原子合并；一个 Job 内的其他 Source 失败不影响已成功合并的 Source。

Staging 始终包含一套完整产物：

```text
Pages
Key Facts
Source Map
Manifest
Search Index
```

Job 结束后可继续发起下一个 Job，结果仍合并到同一 Staging，直到用户统一发布或撤销。Staging 页面只和原始 Source 建立关系，不保存 Compile Unit 作为正式知识实体。Agent 和正式检索在发布前继续读取当前正式 Wiki。

同一个 `sourceId` 成功合并后，不能在当前 Staging 中重复编译；失败的 Source 可以重新提交。其他 Source 失败不影响已经合并的结果。

### 6.1 人工确认

没有运行中 Job 时，当前 Staging 可以进入人工确认：

- 用户可以查看并确认发布。
- 发布前必须不存在运行中的编译 Job。
- 撤销会先使写令牌失效并取消活动请求，再删除整个共享 Staging；正式 Wiki 始终不变。

### 6.2 原子发布

确认发布后，Pages、Key Facts、Source Map、Manifest 和 Search Index 作为一个整体原子替换当前正式 Wiki。

规则：

- 发布过程中任一部分失败都不能暴露不完整的新 Wiki。
- 未发布 Staging 可以直接撤销。
- 发布成功后不保留历史版本，不支持撤回。
- 底层允许在原子切换期间短暂保留旧目录用于故障保护；确认新 Wiki 切换成功后立即删除。
- 发布提交点是正式 Wiki 指针的原子切换；切换前失败不影响旧 Wiki。

## 7. Agent 边界

Agent 只读取已经正式发布的 Wiki、Manifest 和 Search Index，不读取 Compile Unit 或未发布 Staging。

当前编译架构不设置 `pageType`；Agent 层现有的页面类型、检索、证据复核和拒答逻辑后续单独重构，本阶段不展开。

## 8. 待确定和注意事项

- 不同模型的有效上下文上限、物理切片大小和 Token 换算方式仍需通过真实运行确定。
- 物理切片可能截断完整事实并造成 Planner、Writer 遗漏，当前版本接受为正常损耗，后续再优化切片策略。
- PDF、扫描件、图片和复杂表格如何转换成可靠输入尚未设计。
- Source 并发数大于 `1` 时的多页面锁顺序和死锁问题暂不处理。
- 当前不实现锁超时、异常进程退出后的自动解锁和恢复逻辑。
- 并发任务可能创建语义重复页面，当前依赖后续诊断发现和处理。
- Facts 不证明正文或 Source 的完整覆盖，也不做真实性校验；重复编译同一 Source 时的 Facts 替换和去重策略后续确定。
- 当前不做模型重试；上下文大小和输出 Token 默认值后续根据真实模型表现继续调整。
- Agent 检索合同、无答案拒答和现有 `pageType` 依赖后续单独重构。
