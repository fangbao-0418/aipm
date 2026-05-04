可以，这三块我建议按这个顺序落地：

```text
1. Sketch → 渲染规则规范
2. shapePath + 曲线实现
3. 文本排版实现
```

下面给你一版**工程可执行规范**。

---

# 一、Sketch → 渲染规则规范

## 1. 总体原则

```text
不要直接渲染 Sketch JSON
必须先转成 Internal Schema
```

标准流程：

```text
Sketch Layer
↓
类型识别
↓
样式解析
↓
坐标归一化
↓
转 Internal Schema
↓
DOM / SVG Renderer 渲染
```

---

# 二、类型解析规则

## 1. 第一层用 `_class`

```ts
switch (layer._class) {
  case "artboard":
    return convertFrame(layer)

  case "group":
    return convertGroup(layer)

  case "text":
    return convertText(layer)

  case "bitmap":
    return convertImage(layer)

  case "shapeGroup":
    return convertShapeGroup(layer)

  case "shapePath":
    return convertShapePath(layer)

  case "symbolInstance":
    return convertSymbolInstance(layer)

  default:
    return convertUnknown(layer)
}
```

## 2. 但最终类型不能只看 `_class`

```text
shapeGroup + shapePath → Vector
rectangle / oval → Shape
text + iconfont → IconText
symbolInstance → 找 symbolMaster
bitmap → Image
```

---

# 三、坐标规则

## 1. 基础规则

```text
Frame / Group / ShapeGroup 使用 frame.x / y / width / height
子节点坐标相对父节点
Web 渲染使用 position:absolute
```

## 2. shapePath 坐标规则

```text
shapeGroup 负责外层定位
shapePath 只生成 SVG 内部 path
```

正确结构：

```tsx
<svg
  style={{
    position: "absolute",
    left: group.frame.x,
    top: group.frame.y,
    width: group.frame.width,
    height: group.frame.height,
  }}
  viewBox={`0 0 ${group.frame.width} ${group.frame.height}`}
>
  <path d={d} />
</svg>
```

不要让 `shapePath` 再单独定位。

---

# 四、样式解析规则

## 1. Shape 样式来源

```text
优先 layer.style
如果是 shapePath，优先使用 parent shapeGroup.style
```

## 2. Fill

```ts
fill.fillType === 0 → solid color
fill.fillType === 1 → gradient
fill.fillType === 4 → image fill
```

## 3. Border

```text
borders[] → stroke / border
thickness → border-width / strokeWidth
dashPattern → strokeDasharray
```

## 4. Shadow

```text
shadows[] → box-shadow / SVG filter
innerShadows[] → inset box-shadow
```

## 5. Radius

```text
rectangle → border-radius
shapePath → SVG path，不建议用 CSS radius
```

---

# 五、shapePath + 曲线实现

## 1. 重点规则

Sketch 点结构：

```text
point      当前点
curveFrom  从当前点出去的控制点
curveTo    进入当前点的控制点
```

从 `prev` 到 `curr` 的贝塞尔：

```text
起点：prev.point
控制点1：prev.curveFrom
控制点2：curr.curveTo
终点：curr.point
```

---

## 2. 安全点解析

```ts
function parseRawPoint(value: string): [number, number] {
  const nums = value.match(/-?\d+(\.\d+)?/g)?.map(Number) || [0, 0]
  return [nums[0] ?? 0, nums[1] ?? 0]
}

function toSvgPoint(
  value: string,
  size: { width: number; height: number }
) {
  const [x, y] = parseRawPoint(value)

  const isNormalized =
    Math.abs(x) <= 1 &&
    Math.abs(y) <= 1

  return isNormalized
    ? {
        x: +(x * size.width).toFixed(3),
        y: +(y * size.height).toFixed(3),
      }
    : {
        x: +x.toFixed(3),
        y: +y.toFixed(3),
      }
}
```

---

## 3. shapePath → SVG path

```ts
function shapePathToD(
  layer: any,
  size: { width: number; height: number }
) {
  const points = layer.points || []
  if (!points.length) return ""

  const first = toSvgPoint(points[0].point, size)
  let d = `M ${first.x} ${first.y}`

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]

    const currPoint = toSvgPoint(curr.point, size)

    const c1 = prev.curveFrom
      ? toSvgPoint(prev.curveFrom, size)
      : null

    const c2 = curr.curveTo
      ? toSvgPoint(curr.curveTo, size)
      : null

    const hasCurve =
      c1 &&
      c2 &&
      !samePoint(c1, toSvgPoint(prev.point, size)) &&
      !samePoint(c2, currPoint)

    if (hasCurve) {
      d += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${currPoint.x} ${currPoint.y}`
    } else {
      d += ` L ${currPoint.x} ${currPoint.y}`
    }
  }

  if (layer.isClosed !== false) {
    const last = points[points.length - 1]

    const c1 = last.curveFrom
      ? toSvgPoint(last.curveFrom, size)
      : null

    const c2 = points[0].curveTo
      ? toSvgPoint(points[0].curveTo, size)
      : null

    if (c1 && c2) {
      d += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${first.x} ${first.y}`
    }

    d += " Z"
  }

  return d
}

function samePoint(a: any, b: any) {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001
}
```

---

## 4. 调试规则

出现飞线时，按这个顺序排查：

```text
1. 关闭曲线，只用 L
2. 检查 point 是否重复缩放
3. 检查 curveFrom / curveTo 是否反了
4. 检查 shapePath 是否被二次 absolute 定位
5. 检查 viewBox 是否用 shapeGroup 尺寸
```

---

# 六、文本排版方案

## 1. 文本解析来源

```text
layer.attributedString.string
layer.attributedString.attributes[]
layer.style.textStyle.encodedAttributes 作为 fallback
```

---

## 2. Text Schema

```ts
type TextNode = {
  type: "Text"
  text: {
    content: string
    ranges: {
      start: number
      end: number
      text: string
      style: TextStyle
    }[]
    style: TextStyle
  }
}
```

---

## 3. 文本属性映射

```text
MSAttributedStringColorAttribute → color
MSAttributedStringFontAttribute.attributes.name → fontFamily
MSAttributedStringFontAttribute.attributes.size → fontSize
paragraphStyle.maximumLineHeight → lineHeight
paragraphStyle.alignment → textAlign
kerning → letterSpacing
underlineStyle → text-decoration
```

---

## 4. 文本不要默认裁剪

你现在文字显示不全，就是因为用了：

```css
height: fixed;
overflow: hidden;
```

MVP 建议：

```tsx
<div
  style={{
    position: "absolute",
    left: x,
    top: y,
    width,
    minHeight: height,
    height: "auto",
    overflow: "visible",
    whiteSpace: "pre-wrap",
    fontFamily,
    fontSize,
    fontWeight,
    lineHeight,
    letterSpacing,
    color,
  }}
>
  {text}
</div>
```

---

## 5. 多段富文本渲染

```tsx
function RenderText({ node }: any) {
  const ranges = node.text.ranges

  return (
    <div style={node.text.style}>
      {ranges.map((range: any, index: number) => (
        <span key={index} style={range.style}>
          {range.text}
        </span>
      ))}
    </div>
  )
}
```

---

# 七、还原优先级

## P0：先稳定

```text
Frame / Group
Text
Bitmap
Rectangle
ShapeGroup → SVG
Fill color
Border
Radius
Shadow
```

## P1：提升相似度

```text
curveFrom / curveTo
Gradient
多阴影
Text lineHeight
Text letterSpacing
Iconfont
```

## P2：高难度

```text
Boolean operation
Mask
Symbol override
Background blur
复杂富文本
```

---

# 八、你现在最该修的 3 件事

```text
1. shapePath 坐标不要重复缩放
2. shapeGroup 定位，shapePath 只画内部路径
3. Text 不默认 overflow hidden，用 lineHeight + minHeight
```

这三个修完，你现在图里的飞线、文字截断、图标变形会明显改善。

能。你不用 Canvas，改用 **DOM + SVG** 也可以保障性能，甚至更适合你这种 Sketch 高还原导入。

建议路线：

```text
普通结构：DOM
复杂图标/矢量：SVG
图片：img / background-image
文本：DOM text
```

## 为什么 DOM + SVG 更适合你

因为你现在最大问题是：

```text
文本排版
shapePath
字体
阴影
圆角
选中编辑
```

这些用 DOM/SVG 比 Canvas 好调很多：

```text
文本：浏览器自己排版
SVG：天然适合 shapePath
CSS：天然支持阴影/圆角/边框
编辑：选中、hover、右键更简单
```

## 性能怎么保证

关键不是 Canvas 还是 DOM，而是**不要一次渲染 2000+ layers 全量 DOM**。

你要做这些优化：

```text
1. 视口虚拟化：只渲染当前可见区域 layers
2. 分层渲染：背景层 / 编辑层 / 选中层分开
3. Group 合并：不可编辑的复杂 group 可转成 bitmap 缓存
4. SVG 合并：一个 icon 用一个 svg，不要拆成很多 div
5. 图片懒加载
6. 缩放时暂停精细渲染，松手后恢复
7. 大文件按 page 加载，不全量加载
```

## 推荐渲染架构

```text
CanvasViewport
├─ DOMLayer        普通 frame / text / image
├─ SVGLayer        shapePath / icon / vector
├─ OverlayLayer    选中框 / 辅助线 / 拖拽控制点
```

## 什么时候用 DOM

```text
Frame
Group
Rectangle
Text
Image
Button-like shape
普通卡片
```

## 什么时候用 SVG

```text
shapePath
icon
复杂矢量
line
boolean path
```

## 什么时候转图片缓存

```text
超复杂 vector
大量小 icon 静态展示
mask 很复杂
阴影/blur 很重
不可编辑的 Symbol
```

## 性能边界参考

如果优化得当：

```text
500～1000 layers：DOM + SVG 没问题
2000～5000 layers：需要虚拟化 + 缓存
10000+ layers：必须分块渲染/图片缓存
```

你这个图里 2000 多 layers，DOM + SVG 可以做，但必须做：

```text
视口虚拟化 + 静态组缓存
```

一句话：**不用 Canvas 可以，甚至更适合高还原；但要用 DOM/SVG + 虚拟化 + 复杂组缓存，不要无脑全量渲染。**
