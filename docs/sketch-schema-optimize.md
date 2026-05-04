这是正常现象：**`.sketch` 是压缩包，20M 解压成 JSON + 图片引用后变 600M 很常见**。不要把完整 Sketch JSON 当业务数据保存/传前端。

正确优化思路：

## 1. 不保存原始解析 JSON

不要这样：

```text
.sketch → parse → 保存完整 json → 前端渲染
```

改成：

```text
.sketch
↓
流式/分段解析
↓
只提取你需要的字段
↓
生成轻量 Schema
↓
前端只拿 Schema
```

---

## 2. 只保留必要字段

Sketch 原始 JSON 里很多字段你暂时用不到：

```text
不用保存：
- user
- previews
- exportOptions
- 原始 attributes 大对象
- 未支持的 prototype
- 大量 metadata
- 不渲染的隐藏图层
- 完整原始 style 备份
```

保留：

```text
id
name
type
x/y/width/height
visible/locked
text
font
fill
border
shadow
imageRef
children
```

---

## 3. 图片不要转 base64

这是大坑。

不要：

```json
{
  "src": "data:image/png;base64,..."
}
```

应该：

```json
{
  "src": "/assets/imports/xxx/image-001.png"
}
```

也就是：

```text
图片单独存文件
Schema 里只存 URL
```

---

## 4. 分页面保存

不要一个项目一个巨型 JSON。

```text
project
├─ meta.json
├─ pages/
│  ├─ page-1.schema.json
│  ├─ page-2.schema.json
│  └─ page-3.schema.json
└─ assets/
   ├─ images/
   └─ fonts/
```

前端只加载当前页面：

```text
打开页面1 → 只请求 page-1.schema.json
```

---

## 5. 隐藏图层默认不渲染

如果只是预览还原，可以跳过：

```ts
if (layer.isVisible === false) return null;
```

如果要保留编辑能力，可以只保存轻量信息：

```json
{
  "id": "xxx",
  "name": "隐藏图层",
  "visible": false,
  "children": []
}
```

---

## 6. Symbol 不要重复展开保存

如果一个 Symbol 被用了 100 次：

错误方式：

```text
展开 100 份完整节点树
```

正确方式：

```json
{
  "type": "SymbolInstance",
  "symbolId": "symbol_button_primary",
  "overrides": {}
}
```

单独保存 SymbolMaster：

```json
{
  "symbols": {
    "symbol_button_primary": {
      "schema": {}
    }
  }
}
```

前端渲染时再展开。

---

## 7. 对重复样式做去重

很多节点样式完全一样，不要每个节点都存完整 style。

```json
{
  "styleId": "style_card_shadow"
}
```

公共样式：

```json
{
  "style_card_shadow": {
    "fill": "#fff",
    "radius": 8,
    "shadow": "0 4px 12px rgba(0,0,0,.08)"
  }
}
```

---

## 8. 文本属性要压缩

Sketch 的 `attributedString` 很大，不要整段保存。

只转成：

```json
{
  "text": "应用引擎创建成功",
  "fontFamily": "PingFang SC",
  "fontSize": 24,
  "fontWeight": 600,
  "color": "#171717",
  "lineHeight": 32
}
```

多段富文本才保存 ranges：

```json
{
  "text": "hello world",
  "ranges": [
    {
      "start": 0,
      "end": 5,
      "style": {}
    }
  ]
}
```

---

## 9. 大页面按需加载 / 虚拟渲染

前端不要一次渲染全部节点。

```text
当前视口内节点 → 渲染
视口外节点 → 不渲染
```

画布缩放时尤其重要。

---

## 10. 保存格式可以压缩

数据库里不要直接存 600M JSON。可以：

```text
Schema JSON → gzip / brotli → 存对象存储
```

API 返回也开启 gzip：

```text
Content-Encoding: gzip
```

---

# 推荐最终导入产物

```text
imports/{importId}/
├─ project.json              # 项目信息
├─ pages/
│  ├─ page_001.json.gz        # 只存轻量 schema
│  └─ page_002.json.gz
├─ symbols/
│  ├─ symbol_button.json.gz
├─ styles/
│  ├─ layerStyles.json
│  └─ textStyles.json
└─ assets/
   ├─ images/
   └─ fonts/
```

---

# 优化优先级

先做这 5 个，体积会立刻降很多：

```text
1. 不保存原始 Sketch JSON
2. 图片不 base64，只存 URL
3. 按 Page 拆分
4. Symbol 引用，不重复展开
5. 删除未使用字段，只保留轻量 Schema
```

一句话：**600M 不应该进入你的业务系统；它只是中间解析产物，最终应该转成几十 MB 以内的轻量 Schema + 独立资源文件。**
