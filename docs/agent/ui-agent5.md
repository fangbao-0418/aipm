下面是一份可直接给研发用的方案。

# 流式 Agent 技术方案

## 1. 目标

将当前“一次性返回执行结果”的 Agent，改造成类似 Codex 的流式执行体验：

用户输入需求后，Agent 能够：

```text
思考/规划 → 输出当前步骤 → 调用工具 → 输出工具结果 → 继续下一步 → 校验 → 完成
```

而不是等所有工具执行完后一次性返回。

---

# 2. 整体架构

```text
前端 Chat UI
   ↓ SSE / WebSocket
Agent Server
   ↓
Agent Runtime
   ↓
Tool Executor
   ↓
Schema Tools
  - page.get_schema
  - schema.add_nodes
  - schema.update_nodes
  - schema.validate
  - ui.review
```

推荐使用：

```text
SSE：适合单向流式输出，简单稳定
WebSocket：适合双向交互，比如中途暂停、取消、确认
```

如果只是“做一步输出一步”，优先用 **SSE**。

---

# 3. 核心事件模型

后端不要只返回最终文本，而是返回事件流。

## Event 类型设计

```ts
type AgentStreamEvent =
  | {
      type: "message";
      content: string;
    }
  | {
      type: "plan";
      steps: string[];
    }
  | {
      type: "tool_call_start";
      toolName: string;
      params?: any;
    }
  | {
      type: "tool_call_result";
      toolName: string;
      success: boolean;
      result?: any;
      error?: string;
    }
  | {
      type: "schema_patch";
      action: "add" | "update" | "delete";
      nodes?: any[];
    }
  | {
      type: "review";
      result: any;
    }
  | {
      type: "done";
      summary: string;
    }
  | {
      type: "error";
      message: string;
    };
```

---

# 4. 后端接口设计

## 请求

```http
POST /api/agent/stream
Content-Type: application/json
Accept: text/event-stream
```

```json
{
  "pageId": "page_123",
  "prompt": "当前画布上，新增一个商品管理列表",
  "stream": true
}
```

## SSE 返回示例

```text
event: message
data: {"content":"我先读取当前画布结构，确认新增内容的位置。"}

event: tool_call_start
data: {"toolName":"page.get_schema"}

event: tool_call_result
data: {"toolName":"page.get_schema","success":true}

event: message
data: {"content":"已读取页面结构。接下来我会生成商品管理列表节点。"}

event: tool_call_start
data: {"toolName":"schema.add_nodes"}

event: schema_patch
data: {"action":"add","nodes":[...]}

event: tool_call_result
data: {"toolName":"schema.add_nodes","success":true}

event: message
data: {"content":"商品管理列表已新增，接下来校验 schema。"}

event: tool_call_start
data: {"toolName":"schema.validate"}

event: tool_call_result
data: {"toolName":"schema.validate","success":true}

event: done
data: {"summary":"已完成：新增商品管理列表，包含筛选区、表格、操作按钮和分页器。"}
```

---

# 5. Agent 执行循环

核心逻辑不要写成：

```ts
const result = await agent.run(prompt);
return result;
```

而要写成：

```ts
for await (const event of agent.runStream(input)) {
  sendEventToClient(event);
}
```

Agent 内部推荐实现成循环：

```ts
while (!isDone) {
  const nextAction = await model.decideNextAction(context);

  if (nextAction.type === "message") {
    yield {
      type: "message",
      content: nextAction.content,
    };
  }

  if (nextAction.type === "tool_call") {
    yield {
      type: "tool_call_start",
      toolName: nextAction.toolName,
      params: nextAction.params,
    };

    const result = await toolExecutor.call(
      nextAction.toolName,
      nextAction.params
    );

    yield {
      type: "tool_call_result",
      toolName: nextAction.toolName,
      success: result.success,
      result,
    };

    context.toolResults.push(result);

    if (shouldRepair(result)) {
      context.mustRepair = true;
      continue;
    }
  }

  isDone = checkDone(context);
}
```

---

# 6. 工具执行生命周期

每个工具调用必须有三个阶段：

```text
before_tool_call
tool_call
after_tool_call
```

例如：

```text
message: 我先读取当前页面 schema。
tool_call_start: page.get_schema
tool_call_result: page.get_schema 成功
message: 已读取页面 schema，接下来新增商品管理列表。
```

不要让模型最后统一总结所有工具结果。

---

# 7. Agent Prompt 设计

可以放到 System Prompt：

```text
你是一个自主执行型 UI Schema Agent。

你的目标是根据用户自然语言需求，持续修改当前页面 schema，直到任务真正完成。

你必须以流式方式工作：

1. 每次调用工具前，先输出一条简短说明。
2. 调用工具。
3. 工具完成后，输出一条简短结果说明。
4. 根据工具结果决定下一步。
5. 如果工具失败或结果不符合预期，必须自动修复并继续。
6. 只有完成标准满足后，才能输出最终 done。

禁止：
- 不允许只输出完整计划后停止。
- 不允许把所有步骤完成后再一次性汇报。
- 不允许 schema.add_nodes 传空 nodes。
- 如果新增节点数为 0，必须视为失败并重新生成。
- 不允许要求用户手动输入“继续”。
```

---

# 8. Done 条件

Agent 不能只看工具有没有调用完，要看结果是否真的符合目标。

```ts
function checkDone(context) {
  return (
    context.hasReadSchema &&
    context.addedNodesCount > 0 &&
    context.validatePassed &&
    context.reviewPassed &&
    context.userGoalSatisfied
  );
}
```

针对你的例子：

```text
用户说：新增一个商品管理列表
```

完成条件应该是：

```text
1. schema 中存在商品管理模块
2. 有搜索 / 筛选 / 新增按钮
3. 有商品表格
4. 表格字段包含商品名称、价格、库存、状态、操作
5. 有分页器
6. validate 通过
7. review 无阻塞问题
```

---

# 9. 失败恢复机制

要把下面情况视为失败：

```text
schema.add_nodes 新增 0 个节点
schema.validate 失败
ui.review 发现缺少用户要求内容
工具参数为空
节点结构不合法
插入位置不存在
```

示例：

```ts
function shouldRepair(result) {
  if (!result.success) return true;

  if (
    result.toolName === "schema.add_nodes" &&
    result.addedCount === 0
  ) {
    return true;
  }

  if (
    result.toolName === "schema.validate" &&
    result.valid === false
  ) {
    return true;
  }

  return false;
}
```

---

# 10. 前端展示方案

前端接收 SSE：

```ts
const eventSource = new EventSource("/api/agent/stream");

eventSource.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  appendAgentMessage(data.content);
});

eventSource.addEventListener("tool_call_start", (event) => {
  const data = JSON.parse(event.data);
  appendStep(`准备执行：${data.toolName}`);
});

eventSource.addEventListener("tool_call_result", (event) => {
  const data = JSON.parse(event.data);
  appendStep(
    data.success
      ? `已完成：${data.toolName}`
      : `执行失败：${data.toolName}`
  );
});

eventSource.addEventListener("done", (event) => {
  const data = JSON.parse(event.data);
  appendAgentMessage(data.summary);
  eventSource.close();
});
```

前端展示可以分三层：

```text
1. Chat 气泡：自然语言说明
2. Step Timeline：工具执行进度
3. Canvas：实时渲染 schema patch
```

---

# 11. 推荐 UI 交互

```text
AI：我先读取当前画布结构。
状态：page.get_schema 执行中...
状态：page.get_schema 已完成

AI：已读取页面结构，接下来新增商品管理列表。
状态：schema.add_nodes 执行中...
Canvas 实时出现新模块
状态：schema.add_nodes 已完成

AI：已新增商品管理列表，接下来校验 schema。
状态：schema.validate 执行中...
状态：schema.validate 已通过

AI：已完成：商品管理列表已新增。
```

---

# 12. 关键结论

你现在的问题不是 Prompt 一个点能解决的，而是需要：

```text
agent.run()
```

升级成：

```text
agent.runStream()
```

并且让 Agent Runtime 暴露这些事件：

```text
message
tool_call_start
tool_call_result
schema_patch
review
done
error
```

最终效果就是：
**模型负责决策，工具负责执行，Runtime 负责流式事件，前端负责实时展示。**
