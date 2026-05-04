# 工作空间需求文档存储设计 v1

## 目标

把 `我的工作空间 -> 需求文档` 从前端 `localStorage` 过渡到：

- **正文内容保存在本地文件**
- **索引和查询保存在 SQLite**

并保证前端组件不直接依赖底层存储实现。

---

## 为什么这样设计

### 1. 本地文件更适合保存正文

需求文档正文有这些特点：

- 内容大
- 富文本结构复杂
- 需要版本快照
- 需要导出、备份、人工查看

对这类数据，文件天然更直观，也更适合做版本目录。

### 2. SQLite 更适合做索引

文档列表页需要这些能力：

- 按项目查文档
- 按更新时间排序
- 按标题搜索
- 过滤已删除文档
- 维护排序顺序

这些都更适合放到 SQLite，而不是每次扫目录和全文 JSON。

### 3. 结论

对这个项目来说，不建议二选一：

- **不是全部都存文件**
- **也不是全部都存 SQLite**

最合适的是：

- **正文文件化**
- **索引数据库化**

---

## 前端抽象层

前端不再直接调用 `localStorage`，只调用 `DocumentRepository`。

当前已经先落了一个过渡版接口：

- `/Users/fangbao/Documents/self-work/ai-pm/UI/src/app/repositories/document-repository.ts`

当前实现：

- `LocalStorageDocumentRepository`

后续替换方向：

- `WorkspaceApiDocumentRepository`

前端组件例如：

- `/Users/fangbao/Documents/self-work/ai-pm/UI/src/app/components/workspace/MyWorkspaceView.tsx`

只应依赖：

- `list(projectId)`
- `replaceAll(projectId, documents)`

后续再逐步细化成更明确的文档操作 API。

---

## 本地文件目录结构

建议文档内容落在：

```text
workspace/
  projects/
    <projectId>/
      documents/
        <documentId>/
          content.blocknote.json
          content.html
          content.txt
          meta.json
          versions/
            <versionId>.json
```

### 各文件含义

#### `content.blocknote.json`

保存 BlockNote 原始块结构，是正文主数据源。

#### `content.html`

保存导出用和预览用 HTML。

#### `content.txt`

保存纯文本，便于搜索、摘要、调试。

#### `meta.json`

保存单文档本地元信息，例如：

- `id`
- `projectId`
- `title`
- `createdAt`
- `updatedAt`
- `sortOrder`
- `deleted`

#### `versions/<versionId>.json`

保存某次文档版本快照，至少包含：

- 标题
- `contentBlocks`
- `contentHtml`
- `contentText`
- `createdAt`
- `source`

---

## SQLite 设计

建议复用现有：

- `/Users/fangbao/Documents/self-work/ai-pm/src/infrastructure/db/index-database.ts`
- 数据库文件：`/Users/fangbao/Documents/self-work/ai-pm/data/app.db`

新增两张表。

### 1. `workspace_documents`

```sql
CREATE TABLE IF NOT EXISTS workspace_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  content_file_path TEXT NOT NULL,
  html_file_path TEXT NOT NULL,
  text_file_path TEXT NOT NULL,
  latest_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_documents_project_updated
ON workspace_documents(project_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_documents_project_sort
ON workspace_documents(project_id, sort_order ASC);
```

### 2. `workspace_document_versions`

```sql
CREATE TABLE IF NOT EXISTS workspace_document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  snapshot_file_path TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_document_versions_document
ON workspace_document_versions(document_id, version_number DESC);
```

---

## 文档数据结构

建议后端正式对象定义为：

```ts
interface WorkspaceStoredDocument {
  id: string;
  projectId: string;
  title: string;
  sortOrder: number;
  deleted: boolean;
  contentBlocks: unknown[];
  contentHtml: string;
  contentText: string;
  createdAt: string;
  updatedAt: string;
}
```

版本对象：

```ts
interface WorkspaceStoredDocumentVersion {
  id: string;
  documentId: string;
  projectId: string;
  versionNumber: number;
  source: "manual" | "ai" | "import" | "rollback";
  snapshot: WorkspaceStoredDocument;
  createdAt: string;
}
```

---

## 后端 Repository 设计

建议在服务端新增：

### `WorkspaceDocumentRepository`

职责：

- 读写正文文件
- 读写版本快照
- 返回单文档内容

建议位置：

- `src/infrastructure/files/workspace-document-repository.ts`

建议方法：

```ts
listDocumentMetas(projectId: string): Promise<WorkspaceDocumentMeta[]>
getDocument(projectId: string, documentId: string): Promise<WorkspaceStoredDocument | null>
saveDocument(document: WorkspaceStoredDocument): Promise<void>
deleteDocument(projectId: string, documentId: string): Promise<void>
createVersion(version: WorkspaceStoredDocumentVersion): Promise<void>
listVersions(projectId: string, documentId: string): Promise<WorkspaceStoredDocumentVersion[]>
restoreVersion(projectId: string, documentId: string, versionId: string): Promise<WorkspaceStoredDocument>
```

### `WorkspaceDocumentIndexRepository`

职责：

- 管理 SQLite 索引
- 支撑列表、排序、搜索

建议位置：

- 基于现有 `IndexDatabase` 扩展

建议方法：

```ts
listDocuments(projectId: string): Promise<WorkspaceDocumentListItem[]>
upsertDocumentMeta(meta: WorkspaceDocumentMeta): Promise<void>
deleteDocumentMeta(projectId: string, documentId: string): Promise<void>
listVersions(projectId: string, documentId: string): Promise<WorkspaceDocumentVersionListItem[]>
upsertVersionMeta(meta: WorkspaceDocumentVersionMeta): Promise<void>
```

---

## API 设计

建议新增以下接口。

### 文档列表

#### `GET /api/workspace/projects/:id/documents`

返回文档列表元数据，不返回大段正文。

#### `POST /api/workspace/projects/:id/documents`

新建文档。

请求体：

```json
{
  "title": "未命名文档"
}
```

### 单文档

#### `GET /api/workspace/projects/:id/documents/:documentId`

返回完整正文：

- `contentBlocks`
- `contentHtml`
- `contentText`

#### `PUT /api/workspace/projects/:id/documents/:documentId`

保存文档。

请求体：

```json
{
  "title": "文档标题",
  "contentBlocks": [],
  "contentHtml": "<p>...</p>",
  "contentText": "..."
}
```

#### `DELETE /api/workspace/projects/:id/documents/:documentId`

删除文档。

### 文档排序

#### `PUT /api/workspace/projects/:id/documents/order`

请求体：

```json
{
  "orderedIds": ["doc-1", "doc-2", "doc-3"]
}
```

### 版本

#### `GET /api/workspace/projects/:id/documents/:documentId/versions`

返回版本列表。

#### `POST /api/workspace/projects/:id/documents/:documentId/versions/:versionId/restore`

恢复某一版本。

---

## 性能评估

### 本地文件更快的场景

- 保存单篇文档正文
- 保存 BlockNote JSON
- 写版本快照
- 导出和备份

### SQLite 更快的场景

- 文档列表排序
- 标题搜索
- 项目下文档统计
- 过滤已删除文档
- 查最近修改

### 这个项目的推荐结论

#### 第一选择

- **正文文件**
- **索引 SQLite**

#### 不推荐

- 继续长期使用 `localStorage`
- 把全部 BlockNote 正文直接塞进 SQLite 主表

---

## 推荐落地顺序

### 第 1 步

前端继续走 `DocumentRepository` 抽象层。

### 第 2 步

服务端新增文档文件 Repository。

### 第 3 步

扩展 SQLite 索引表。

### 第 4 步

前端把 `LocalStorageDocumentRepository` 切换成 `WorkspaceApiDocumentRepository`。

### 第 5 步

补文档版本列表、回滚、搜索、排序。

