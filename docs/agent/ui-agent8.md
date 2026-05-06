可以按 **“AI 生成 UI Schema → 素材解析/检索 → Sketch 渲染 → 自动评审 → 人工微调”** 做。

## 1. 总体架构

```text
用户描述
  ↓
意图理解 Agent
  ↓
页面信息架构 / 用户流 / 组件树
  ↓
Design Schema JSON
  ↓
素材 Agent
  ├─ 内部素材库：品牌图、组件、插画、图标
  ├─ 联网图片：Unsplash / Openverse / 自建爬取索引
  └─ SVG 图标：Iconify / Lucide / AI 生成
  ↓
Sketch Renderer
  ↓
截图 / 导出 Sketch 文件
  ↓
视觉评审 Agent
  ↓
修正 Schema
```

## 2. 核心不是“直接画图”，而是生成中间 Schema

你们已经有 Sketch 能力，建议把模型输出限定成严格 JSON，例如：

```json
{
  "page": {
    "name": "AI CRM Dashboard",
    "width": 1440,
    "height": 1024,
    "theme": "light"
  },
  "tokens": {
    "color.primary": "#2563EB",
    "font.heading": "Inter",
    "radius.card": 16
  },
  "nodes": [
    {
      "type": "card",
      "x": 80,
      "y": 120,
      "w": 360,
      "h": 220,
      "children": [
        {
          "type": "text",
          "role": "title",
          "content": "Revenue Overview"
        },
        {
          "type": "chart",
          "chartType": "line"
        }
      ]
    }
  ],
  "assets": [
    {
      "slot": "hero_image",
      "query": "modern SaaS dashboard abstract",
      "source": "web"
    },
    {
      "slot": "settings_icon",
      "query": "settings",
      "source": "icon"
    }
  ]
}
```

Schema 要分层：**layout、component、token、asset、interaction、annotation**。不要让模型直接生成 Sketch API 调用，否则很难校验和重试。

## 3. 素材从哪里找

优先级建议：

**第一层：企业内部素材库**
把已有品牌素材、组件、插画、历史 UI 稿做成资产库。每个素材要有 metadata：

```json
{
  "id": "hero_saas_001",
  "type": "image",
  "tags": ["saas", "dashboard", "blue", "enterprise"],
  "style": "clean-modern",
  "license": "internal",
  "embedding": "..."
}
```

检索方式用 **关键词 + 向量检索 + 规则过滤**。

**第二层：公开图片 API**
Unsplash 官方 API 支持按关键词搜索照片，适合 hero 图、背景图、场景图。([Unsplash][1])
Openverse 可以搜索开放许可图片、音频，并提供 REST API，适合对版权要求更严格的场景。([openverse.org][2])

**第三层：图标库**
Iconify 很适合做 SVG 图标检索，它支持搜索图标、获取图标数据、直接渲染 SVG，并且聚合了大量开源图标集。([iconify.design][3])

实际工程里不要让模型“随便联网找图”。应该做一个 **Asset Service**：

```text
asset.search(query, type, style, license)
asset.download(asset_id)
asset.normalize()
asset.cache()
asset.return_to_schema()
```

并且强制返回：

```json
{
  "url": "...",
  "license": "...",
  "source": "...",
  "attribution": "...",
  "width": 1200,
  "height": 800
}
```

## 4. SVG 图标怎么做

建议三种路径并存：

### A. 优先从 Iconify 搜索

流程：

```text
模型识别 icon intent：settings / user / analytics
↓
Iconify search
↓
取最匹配图标 SVG
↓
统一 stroke width / size / color
↓
写入 Sketch shape 或 image layer
```

Iconify API 可以动态生成 SVG，URI 形式是 `/{prefix}/{name}.svg`。([iconify.design][4])

### B. 常用图标本地化

把高频图标集提前缓存，比如：

```text
lucide
heroicons
material-symbols
phosphor
tabler
remix
```

这样生成速度快、风格一致。

### C. AI 生成 SVG

适合生成定制 logo、空状态插画、业务专属图标。
但不要直接信任模型输出 SVG，要加安全和质量检查：

```text
LLM 生成 SVG
↓
SVGO 清理
↓
禁止 script / foreignObject / external href
↓
path 数量限制
↓
viewBox 标准化
↓
转 Sketch vector
```

## 5. Agent 分工

可以拆成 6 个 Agent，但底层最好还是一个编排器控制。

```text
Planner Agent
- 理解用户需求
- 生成页面结构和信息架构

Design System Agent
- 匹配品牌 token
- 选择组件规范

Layout Agent
- 生成栅格、间距、层级
- 输出可渲染 schema

Asset Agent
- 内部素材检索
- 联网图片检索
- SVG 图标检索/生成

Sketch Agent
- Schema → Sketch 文件
- 图层命名、分组、组件实例化

Critic Agent
- 截图评审
- 检查对齐、留白、可读性、风格一致性
- 反向修改 schema
```

## 6. 最关键的技术点

### 结构化输出校验

所有模型输出都必须过 JSON Schema / Zod 校验：

```text
LLM output
↓
JSON parse
↓
schema validate
↓
auto repair
↓
render
```

### 素材版权控制

联网素材必须记录 license，不建议直接抓 Google 图片。
生产环境优先用：

```text
Unsplash API
Openverse API
公司内部素材库
付费图库 API
Iconify / 开源图标库
```

### 视觉评审闭环

渲染 Sketch 后导出 PNG，再让视觉模型检查：

```text
是否溢出？
是否对齐？
文字是否过长？
颜色对比是否足够？
组件风格是否统一？
是否符合用户描述？
```

然后让模型只输出 patch：

```json
{
  "op": "update",
  "nodeId": "card_1",
  "changes": {
    "w": 420,
    "x": 96
  }
}
```

不要每次全量重画。

## 7. 推荐 MVP 路线

第一阶段：

```text
文本描述 → 单页 UI Schema → Sketch 渲染
```

第二阶段：

```text
接入内部素材库 + Iconify 图标
```

第三阶段：

```text
接入 Unsplash / Openverse 图片搜索
```

第四阶段：

```text
截图评审 Agent + 自动修正
```

第五阶段：

```text
支持多页面 flow、组件复用、设计系统约束
```

一句话：**不要把它做成“AI 画图工具”，要做成“AI 生成可验证设计工程数据，再由 Sketch 渲染”的系统。**

[1]: https://unsplash.com/documentation?utm_source=chatgpt.com "Unsplash API Documentation | Free HD Photo API"
[2]: https://openverse.org/?utm_source=chatgpt.com "Openverse: Openly Licensed Images, Audio and More"
[3]: https://iconify.design/docs/api/?utm_source=chatgpt.com "Iconify API"
[4]: https://iconify.design/docs/api/svg.html?utm_source=chatgpt.com "Rendering SVG"
