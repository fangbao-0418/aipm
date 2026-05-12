# Sketch 文件解析规则（工程级整理）

你现在做的其实已经不是：

```text
Sketch 文件读取
```

而是：

```text
Design AST → Semantic UI Engine
```

所以你需要的不是：

```text
字段说明文档
```

而是：

```text
Sketch 渲染规则体系
```

下面我按：

```text
1. 文件结构
2. Layer体系
3. 渲染规则
4. 布局规则
5. 样式规则
6. Mask规则
7. Symbol规则
8. Text规则
9. 导出规则
10. AI语义恢复
```

给你整理。

---

# 一、Sketch 文件本质

`.sketch`

本质：

```text
ZIP 包
```

解压后：

```text
document.json
meta.json
user.json
pages/
images/
previews/
```

---

# 二、核心结构

---

## document.json

全局文档信息：

```json
{
  "pages": [],
  "layerStyles": [],
  "textStyles": [],
  "foreignSymbols": []
}
```

类似：

```text
设计系统入口
```

---

## pages/*.json

真正页面。

---

# 三、Layer 系统（最核心）

所有节点都有：

```json
{
  "_class": "xxx"
}
```

---

# 常见 Layer 类型

| _class         | 含义   |
| -------------- | ---- |
| page           | 页面   |
| artboard       | 画板   |
| group          | 分组   |
| shapeGroup     | 图形组  |
| shapePath      | 路径   |
| rectangle      | 矩形   |
| oval           | 圆    |
| text           | 文本   |
| bitmap         | 图片   |
| symbolMaster   | 组件定义 |
| symbolInstance | 组件实例 |
| slice          | 导出区域 |
| hotspot        | 原型热点 |

---

# 四、渲染树规则（非常重要）

Sketch：

❌ 不是 DOM

而是：

```text
Canvas Render Tree
```

---

# Layer 顺序

```text
数组顺序 = 绘制顺序
```

通常：

```text
后面的 layer 在上面
```

类似：

```css
z-index
```

---

# Group 不等于布局

Group：

只是：

```text
逻辑组织
```

不是：

```text
flex
```

---

# 五、Frame 规则

每个 layer：

```json
{
  "frame": {
    "x": 0,
    "y": 0,
    "width": 100,
    "height": 40
  }
}
```

---

# 坐标规则

默认：

```text
相对父级
```

不是全局。

---

# 六、Style 规则

所有视觉：

```json
{
  "style": {}
}
```

---

# style 组成

| 字段           | 含义  |
| ------------ | --- |
| fills        | 填充  |
| borders      | 边框  |
| shadows      | 阴影  |
| innerShadows | 内阴影 |
| blur         | 模糊  |
| opacity      | 透明度 |

---

# Fill

```json
{
  "fills": [
    {
      "color": "#1677ff"
    }
  ]
}
```

---

# Border

```json
{
  "thickness": 1
}
```

---

# Shadow

对应：

```css
box-shadow
```

---

# 七、Shape 系统

---

## shapeGroup

真正可渲染 Shape 容器。

里面：

```json
{
  "layers": [
    {
      "_class": "shapePath"
    }
  ]
}
```

---

## shapePath

矢量路径。

包含：

```json
{
  "points": []
}
```

贝塞尔曲线。

---

## rectangle

只是：

```text
特殊矢量定义
```

不是 div。

---

# 八、Text 规则（超级复杂）

---

## text layer

```json
{
  "_class": "text",
  "attributedString": {}
}
```

---

# 真正内容

在：

```json
attributedString.archivedAttributedString
```

通常：

```text
Base64 + NSAttributedString
```

---

# Text 样式

包括：

| 属性         | 含义  |
| ---------- | --- |
| font       | 字体  |
| size       | 字号  |
| color      | 颜色  |
| lineHeight | 行高  |
| kerning    | 字间距 |
| paragraph  | 段落  |

---

# Text 自动高度

需要：

```text
重新排版计算
```

不能直接：

```text
height = frame.height
```

---

# 九、Mask 规则（极重要）

你刚问过。

---

## hasClippingMask

```json
{
  "hasClippingMask": true
}
```

表示：

```text
后续 sibling 被裁剪
```

---

# Mask Chain

连续作用：

```text
Mask A
 ├── Image
 ├── Text
```

---

# Mask 本质

接近：

```svg
clipPath
```

---

# 十、Boolean Operation

布尔运算。

---

## union

合并。

---

## subtract

减去。

---

## intersect

相交。

---

## difference

差集。

---

# 前端实现

通常：

```svg
path
```

---

# 十一、Bitmap

图片。

```json
{
  "_class": "bitmap"
}
```

---

# 真正图片

在：

```text
images/
```

通过：

```json
image._ref
```

关联。

---

# 十二、Symbol 系统（组件系统）

Sketch 的核心。

---

## symbolMaster

组件定义。

类似：

```tsx
<Button />
```

---

## symbolInstance

组件实例。

类似：

```tsx
<Button type="primary" />
```

---

# overrideValues

实例覆盖值：

```json
{
  "overrideValues": []
}
```

例如：

* 文本
* 图片
* 颜色

---

# 十三、Auto Layout（新版本）

Sketch 后期才有。

---

# stackLayout

类似：

```css
flex
```

---

# 旧文件通常没有

所以很多：

```text
绝对定位
```

---

# 十四、Constraint 规则

类似：

```text
Auto Layout Constraints
```

例如：

```json
{
  "resizingConstraint": 63
}
```

---

# 这是位运算

表示：

| 位     | 含义   |
| ----- | ---- |
| top   | 固定顶部 |
| left  | 固定左边 |
| width | 固定宽度 |

---

# 十五、导出规则

---

## exportOptions

```json
{
  "exportFormats": []
}
```

---

# 可以导出：

| 类型  | 示例     |
| --- | ------ |
| PNG | 2x     |
| SVG | vector |
| PDF | print  |

---

# 十六、Blend Mode

混合模式。

例如：

| mode     | 含义   |
| -------- | ---- |
| normal   | 普通   |
| multiply | 正片叠底 |
| screen   | 滤色   |

---

# 十七、Opacity

```json
{
  "contextSettings": {
    "opacity": 0.5
  }
}
```

---

# 十八、Blur

支持：

| 类型       | 含义 |
| -------- | -- |
| Gaussian | 高斯 |
| Motion   | 动态 |
| Zoom     | 缩放 |

---

# 十九、AI 转代码真正要做的事

你现在最大误区：

不是：

```text
Sketch → HTML
```

而是：

```text
Sketch → Semantic UI
```

---

# 你真正应该构建：

---

# 第一层：Design AST

```text
Sketch Node Tree
```

---

# 第二层：Visual Analysis

分析：

* 对齐
* 间距
* 重复结构
* 颜色
* 字体
* Mask
* Grid

---

# 第三层：Semantic Recognition

推理：

| 结构             | 推断      |
| -------------- | ------- |
| Rectangle+Text | Button  |
| 多列重复           | Table   |
| 左侧重复菜单         | Sidebar |
| 输入框组合          | Form    |

---

# 第四层：Framework Adapter

输出：

```tsx
<Button />
<Table />
<Form />
```

不是：

```tsx
<div style="position:absolute">
```

---

# 二十、你现在产品真正缺的东西

你现在：

```text
Sketch解析
```

已经够了。

真正缺的是：

---

# 1. Semantic Engine

UI 语义识别。

---

# 2. Design Token System

颜色/圆角/spacing 抽象。

---

# 3. Layout Engine

从：

```text
绝对定位
```

恢复：

```text
Flex/Grid
```

---

# 4. Component Mapping Engine

把：

```text
视觉结构
```

映射：

```text
Antd
```

---

# 二十一、真正工程级架构（推荐）

你应该：

```text
Sketch/Figma
    ↓
Parser
    ↓
Design AST
    ↓
Visual Analyzer
    ↓
Semantic Engine
    ↓
Component Intent Tree
    ↓
Framework Adapter
    ↓
React/Vue/Flutter
```

---

# 二十二、你现在最值得优先做的

优先级：

---

## P0

### 1. Layer Render Tree

必须。

---

### 2. Mask System

必须。

---

### 3. Text Measure

必须。

---

### 4. Auto Layout Recovery

核心。

---

## P1

### 5. Semantic Recognition

真正 AI 核心。

---

### 6. Token 抽象

组件化核心。

---

## P2

### 7. Symbol 系统

组件复用。

---

### 8. Variant System

Antd 推理。

---

# 最后一句总结

Sketch 文件解析真正本质：

不是：

```text
读取 JSON
```

而是：

```text
重建设计软件渲染引擎
+
恢复设计语义
+
推理真实组件结构
```

你现在已经开始走：

```text
AI UI Compiler
```

这条路线了。
