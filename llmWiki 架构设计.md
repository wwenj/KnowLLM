# llmWiki 架构设计

> 本文只保留已经确认的核心架构。待确定内容和当前明确接受的限制统一放在文末。

llmWiki 是编译型语义 Wiki：原始 Source 是事实来源，模型负责把原文整理成稳定、可读、适合 Agent 使用的 Wiki 页面。

```text
Source 编译任务
  -> 可选物理切片
  -> 一个或多个 Compile Unit
  -> 每个 Compile Unit 独立执行 Page Planner
  -> 每个 Page Plan 独立执行 Writer
  -> 合并完整 Staging
  -> 人工确认
  -> 原子替换正式 Wiki
  -> Agent 只读消费正式 Wiki
```

核心原则：准确度优先；模型调用和 Token 可以高，但必须能够在执行前估算并设置硬上限，禁止隐式增加调用。

## 1. Source 编译任务

### 1.1 入口并发

前端触发编译时允许手动设置 Source 并发数，默认值为 `1`。并发限制只作用于原始 Source 进入编译任务之前；Source 被任务接收并完成切片后，内部 Compile Unit 不再占用 Source 并发名额，也不额外设置统一并发上限。

一个 Source 从开始编译到发布、撤销或失败，始终属于同一个任务。任务中的切片、Plan、页面、Facts 和 Staging 都引用原始 `sourceId`。

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

### 2.1 调用估算

设本次 Source 形成 `U` 个 Compile Unit，第 `i` 个 Compile Unit 规划出 `Pᵢ` 个页面，则基础模型调用数为：

```text
U 次 Page Planner + ΣPᵢ 次 Page Writer
```

物理切片不产生模型调用。任一 Compile Unit 的 Planner、Writer 输出异常时，所属 Source 任务整体失败，不发布部分结果，也不隐式追加模型调用。

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
  sourceId: string;
  unitId: string;
  pages: Array<{
    pageKey: string;
    operation: "create" | "update";
    title: string;
    goal: string;
    relatedPageKeys: string[];
  }>;
};
```

当前不设置 `pageType`。页面用途和写作要求统一由 `goal` 表达。

### 3.3 Planner 提示词

```text
System:

你是 llmWiki 的 Wiki 页面规划器。

你会收到当前 Compile Unit、已有 Wiki 页面目录和本次允许使用的新页面 ID。
你的任务是规划本单元应该创建或更新哪些 Wiki 页面。

规则：
1. 当前内容中的有效知识都必须有页面负责承载。
2. 按用户阅读目的组织页面，不机械照搬原文标题。
3. 紧密相关的内容合并；用户目的不同的内容拆分。
4. 已有页面与当前目标一致时优先 update，否则 create。
5. create 只能从 availablePageKeys 中选择 ID。
6. update 必须使用 existingPages 中的 ID。
7. 同一 Plan 不得重复使用 ID，不创建明显重复页面。
8. 只规划页面，不生成正文或 Facts。
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

- JSON 和字段结构必须合法。
- 页面数不得超过本次确认值。
- `create` ID 必须来自预生成 ID 集合。
- `update` ID 必须属于已有页面。
- 同一 Plan 中 ID 必须唯一。
- `relatedPageKeys` 必须属于已有页面或同一 Plan 创建的页面。

校验失败时所属 Source 任务执行失败。跨任务产生的语义重复页面暂不在本阶段阻止，交给后续诊断处理。

## 4. Writer 与 Key Facts

Planner 产出页面计划后，每个 Page Plan 调用一次 Writer。`bodyMarkdown` 是最终 Wiki 正文，也是编译的核心产物。

```text
create：Compile Unit + Page Plan
  -> Writer
  -> 新页面完整正文 + 当前单元 Key Facts

update：Compile Unit + Page Plan + 目标页面最新正文
  -> Writer
  -> 合并后的完整正文 + 当前单元 Key Facts
```

### 4.1 数据结构

```ts
type PageWriterInput = {
  sourceId: string;
  sourceStartLine: number;
  content: string;
  pagePlan: WikiPagePlan["pages"][number];
  existingPage?: string;
  maxFactsPerPlan: 5;
};

type PageWriterOutput = {
  bodyMarkdown: string;
  keyFacts: Array<{
    fact: string;
    sourceId: string;
    sourceLine: number;
  }>;
};
```

`sourceId` 始终是原始 Source ID；`sourceLine` 是原始 Source 中从 `1` 开始的大致行号，不是切片内部行号。

### 4.2 Writer 提示词

```text
System:

你是 llmWiki 的 Wiki 页面 Writer。

你会收到当前 Compile Unit、页面 Plan，以及 update 时的已有页面正文。
请一次性返回完整 Wiki 正文和少量必要的 Key Facts。

正文规则：
1. 只写与当前页面 goal 相关的内容，不编造输入不支持的知识。
2. create 时生成完整页面。
3. update 时以 existingPage 为内容基线，将新知识合并到合适位置。
4. 不删除或改变 existingPage 中仍然独立成立的事实、命令、参数、条件、限制和警告。
5. 内容冲突时保留双方，并明确各自条件或资料差异。
6. 最终返回完整、连贯的 Markdown 正文。

Key Facts 规则：
1. Key Facts 只记录少量、精准、容易被正文忽略，但会影响操作、版本、安全或兼容性的必要事实。
2. 每条 Fact 必须独立明确，按重要程度从高到低排列。
3. 每个 Page Plan 最多返回 5 条，可以返回 0 条。
4. sourceId 使用当前原始 Source ID，sourceLine 使用原始 Source 的大致行号。
5. 不返回原文证据，不输出额外解释。
6. 只返回指定 JSON。

User:

当前原始 Source ID：{{sourceId}}
当前 Compile Unit 起始行：{{sourceStartLine}}
当前页面 Plan：{{pagePlanJson}}

当前 Compile Unit：
<source>
{{compileUnitContent}}
</source>

已有页面正文（create 时为空）：
<existing-page>
{{existingPage}}
</existing-page>

请只返回符合 PageWriterOutput 的 JSON。
```

### 4.3 Facts 边界

Facts 是辅助检索和回到原文附近查找的少量记录，不承担正文完整性证明，也不作为发布正确性的校验层。

当前规则：

- 每个 Page Plan 最多保留 5 条 Facts。
- 不设置单个 Source 的 Facts 总上限。
- Writer 返回超过 5 条时，在 update 合并前只保留前 5 条。
- 不保存原文证据，不校验 Fact 真实性或完整性。
- update 时页面已有 Facts 原样保留且不重新校验，本次保留的 `0~5` 条 Facts 再写入页面 Facts 集合。
- 模型输出无法解析或结构不合法时，按执行异常处理。

## 5. Update 合并与任务锁

锁只负责保证同一页面的 update 不被并发覆盖。create 使用预生成的唯一 `pageKey`，不处理不同任务创建语义重复页面的问题。

### 5.1 Update 执行

同一任务内：

- 不同页面可以并行 Writer。
- 多个 Compile Unit 更新同一页面时必须串行。
- 每次 update Writer 开始前读取该任务 Staging 中的最新页面；Staging 尚无该页面时读取正式 Wiki 最新正文。
- Writer 完成后把完整页面写回 Staging，后续同页 update 继续在该结果上合并。

### 5.2 锁生命周期

页面锁由 Source 编译任务持有，任务未结束前不能自动释放。

```text
planning
  -> compiling
  -> awaiting_approval
  -> publishing
  -> published

planning / compiling / awaiting_approval
  -> failed / cancelled / discarded
```

规则：

- 任务执行 update 前申请对应 `pageKey` 锁。
- 已被其他任务锁定的页面必须等待前一任务结束。
- 锁覆盖 Writer、Staging、人工确认和最终发布或撤销。
- `published`、`failed`、`cancelled`、`discarded` 是允许释放锁的终态。
- 无论任务成功还是异常，都必须由任务主动执行释放逻辑。
- 当前不设置锁超时，也不自动回收锁。
- 释放锁前先让任务写权限失效；锁释放后，晚到的模型结果和异步逻辑不得再写入 Staging 或正式 Wiki。

## 6. Staging 与发布

所有 Writer 完成后，任务生成一套完整 Staging：

```text
Pages
Key Facts
Source Map
Manifest
Search Index
```

Staging 中的页面只和原始 Source 建立关系，不保存 Compile Unit 作为正式知识实体。Agent 和正式检索在发布前继续读取当前正式 Wiki。

### 6.1 人工确认

Staging 完整生成后进入 `awaiting_approval`：

- 用户可以查看并确认发布。
- 用户可以撤销并删除本次 Staging。
- 等待确认期间任务继续持有已获得的 update 页面锁。

### 6.2 原子发布

确认发布后，Pages、Key Facts、Source Map、Manifest 和 Search Index 作为一个整体原子替换当前正式 Wiki。

规则：

- 发布过程中任一部分失败都不能暴露不完整的新 Wiki。
- 未发布 Staging 可以直接撤销。
- 发布成功后不保留历史版本，不支持撤回。
- 底层允许在原子切换期间短暂保留旧目录用于故障保护；确认新 Wiki 切换成功后立即删除。
- 发布或撤销完成后任务进入终态并释放锁。

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
- Writer 的重试策略和各阶段精确 Token 硬上限后续根据真实模型表现确定；当前输出异常直接作为任务异常处理。
- Agent 检索合同、无答案拒答和现有 `pageType` 依赖后续单独重构。
