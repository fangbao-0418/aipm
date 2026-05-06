可以，把它作为 **Agent Memory / Conversation Store Tool** 来设计。

# SQLite 会话存储与 Agent 工具方案

## 1. 目标

实现两件事：

```text
1. 每轮对话、工具调用、工具结果都持久化到 SQLite
2. Agent 在执行任务时，可以通过工具查询历史会话内容
```

用途：

```text
- 恢复上下文
- 查询用户之前说过什么
- 分析上一步工具结果
- 支持“继续刚才的任务”
- 支持失败重试和审计
```

---

# 2. 数据表设计

## conversations

存储一次会话。

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  metadata TEXT
);
```

## messages

存储用户、AI、工具相关消息。

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT,
  event_type TEXT,
  tool_name TEXT,
  tool_call_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  metadata TEXT,

  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
```

`role` 建议：

```text
user
assistant
tool
system
```

`event_type` 建议：

```text
message
plan
tool_call_start
tool_call_result
schema_patch
review
done
error
```

## tool_calls

单独存储工具调用，方便追踪。

```sql
CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments TEXT,
  result TEXT,
  status TEXT,
  error TEXT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME,

  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
```

`status`：

```text
running
success
failed
```

---

# 3. 写入流程

每次用户发送消息：

```ts
await saveMessage({
  conversationId,
  role: "user",
  content: userInput,
  eventType: "message",
});
```

Agent 输出中间消息：

```ts
await saveMessage({
  conversationId,
  role: "assistant",
  content: "我先读取当前页面 schema。",
  eventType: "message",
});
```

工具开始：

```ts
await saveToolCall({
  id: toolCallId,
  conversationId,
  toolName: "page.get_schema",
  arguments: params,
  status: "running",
});
```

工具完成：

```ts
await updateToolCall({
  id: toolCallId,
  result,
  status: "success",
});
```

同时写入 message：

```ts
await saveMessage({
  conversationId,
  role: "tool",
  eventType: "tool_call_result",
  toolName: "page.get_schema",
  toolCallId,
  content: JSON.stringify(result),
});
```

---

# 4. 提供给 Agent 的工具

建议暴露 3 个工具。

## conversation.get_recent_messages

获取最近 N 条会话。

```ts
{
  name: "conversation.get_recent_messages",
  description: "获取当前会话最近的消息记录，用于恢复上下文。",
  parameters: {
    type: "object",
    properties: {
      conversationId: { type: "string" },
      limit: {
        type: "number",
        default: 20
      }
    },
    required: ["conversationId"]
  }
}
```

返回：

```json
{
  "messages": [
    {
      "role": "user",
      "content": "当前画布上，新增一个商品管理列表",
      "createdAt": "2026-05-05T10:00:00Z"
    },
    {
      "role": "assistant",
      "content": "我先读取当前画布结构。",
      "createdAt": "2026-05-05T10:00:03Z"
    }
  ]
}
```

---

## conversation.search_messages

搜索历史会话内容。

```ts
{
  name: "conversation.search_messages",
  description: "根据关键词搜索当前会话或历史会话内容。",
  parameters: {
    type: "object",
    properties: {
      conversationId: { type: "string" },
      keyword: { type: "string" },
      limit: {
        type: "number",
        default: 10
      }
    },
    required: ["keyword"]
  }
}
```

SQL：

```sql
SELECT *
FROM messages
WHERE content LIKE '%' || ? || '%'
ORDER BY created_at DESC
LIMIT ?;
```

---

## conversation.get_tool_history

获取工具调用历史。

```ts
{
  name: "conversation.get_tool_history",
  description: "获取当前会话中的工具调用历史，包括参数、结果和失败原因。",
  parameters: {
    type: "object",
    properties: {
      conversationId: { type: "string" },
      toolName: { type: "string" },
      limit: {
        type: "number",
        default: 20
      }
    },
    required: ["conversationId"]
  }
}
```

返回：

```json
{
  "toolCalls": [
    {
      "toolName": "schema.add_nodes",
      "status": "success",
      "arguments": {},
      "result": {
        "addedCount": 0
      },
      "startedAt": "...",
      "endedAt": "..."
    }
  ]
}
```

---

# 5. Agent Prompt 增加规则

```text
你可以使用 conversation 工具查询历史会话和工具执行结果。

当用户说：
- 继续
- 按刚才的
- 还是上次那个
- 修复刚才的问题
- 为什么没有成功
- 重新执行

你必须优先调用 conversation.get_recent_messages 或 conversation.get_tool_history，恢复上下文后再继续。

如果发现最近工具调用失败，或 schema.add_nodes 新增 0 个节点，必须基于历史结果自动修复。
```

---

# 6. TypeScript 示例实现

```ts
import Database from "better-sqlite3";
import { randomUUID } from "crypto";

const db = new Database("agent.db");

export function saveMessage(input: {
  conversationId: string;
  role: string;
  content?: string;
  eventType?: string;
  toolName?: string;
  toolCallId?: string;
  metadata?: any;
}) {
  db.prepare(`
    INSERT INTO messages (
      id,
      conversation_id,
      role,
      content,
      event_type,
      tool_name,
      tool_call_id,
      metadata
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    input.conversationId,
    input.role,
    input.content ?? null,
    input.eventType ?? null,
    input.toolName ?? null,
    input.toolCallId ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null
  );
}
```

工具查询：

```ts
export function getRecentMessages(input: {
  conversationId: string;
  limit?: number;
}) {
  return db.prepare(`
    SELECT role, content, event_type, tool_name, created_at
    FROM messages
    WHERE conversation_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(input.conversationId, input.limit ?? 20).reverse();
}
```

---

# 7. 流式 Agent 中的落点

流式执行时，每个事件都同时：

```text
1. 推给前端
2. 写入 SQLite
```

伪代码：

```ts
for await (const event of agent.runStream(input)) {
  await saveEventToSqlite(conversationId, event);
  sse.send(event);
}
```

这样就能做到：

```text
前端实时展示
后端完整留痕
Agent 可随时查询历史
```

---

# 8. 推荐最终工具集

```text
conversation.get_recent_messages
conversation.search_messages
conversation.get_tool_history
conversation.get_last_failed_step
conversation.summarize_context
```

其中最有用的是：

```text
conversation.get_last_failed_step
```

用于自动修复：

```ts
SELECT *
FROM tool_calls
WHERE conversation_id = ?
AND status = 'failed'
ORDER BY started_at DESC
LIMIT 1;
```

或者：

```ts
SELECT *
FROM tool_calls
WHERE conversation_id = ?
AND tool_name = 'schema.add_nodes'
AND json_extract(result, '$.addedCount') = 0
ORDER BY started_at DESC
LIMIT 1;
```

---

# 9. 一句话方案

把 SQLite 作为 Agent 的长期执行日志和上下文存储，每个流式事件都落库，同时暴露 `conversation.*` 工具给 Agent 查询历史。这样 Agent 就能像 Codex 一样支持继续执行、失败修复、上下文恢复和过程审计。
