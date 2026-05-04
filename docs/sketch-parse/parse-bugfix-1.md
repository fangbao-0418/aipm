对比这两张，问题已经很明确：你现在已经能还原大结构，但 **Sketch 样式解析还没进入“精细渲染阶段”**。主要差异有这些：

## 1. shapePath 路径有问题

左图里有很多细长黑线、飞线、异常拉伸，说明你的 `shapePath.points` 转 SVG path 时有问题。

常见原因：

```text
1. point / curveFrom / curveTo 坐标没按 frame width/height 缩放
2. curveFrom / curveTo 用反了
3. shapePath 自身 frame 和 shapeGroup frame 混用了
4. 没处理 isClosed
5. 没处理 group transform / rotation / flip
6. 多个 shapePath 没按 shapeGroup 坐标系合并
```

重点修正：

```ts
shapePath 的 point 通常是 0~1 归一化坐标
真实坐标 = point.x * shapeGroup.width
真实坐标 = point.y * shapeGroup.height
```

你要确认你的代码不是直接把：

```text
{0.5, 0.5}
```

当成：

```text
0.5px, 0.5px
```

也不能把它乘错成页面宽高。

---

## 2. shapeGroup 和 shapePath 的坐标混用

Sketch 里通常是：

```text
shapeGroup 有 frame
shapePath 的 points 是相对 shapeGroup 的
```

正确方式：

```text
SVG 外层用 shapeGroup.frame 定位
path 内部使用 shapePath.points * shapeGroup.width/height
```

不要给每个 shapePath 都单独用自己的 absolute 坐标。

推荐结构：

```tsx
<svg
  style={{
    position: "absolute",
    left: shapeGroup.x,
    top: shapeGroup.y,
    width: shapeGroup.width,
    height: shapeGroup.height
  }}
  viewBox={`0 0 ${shapeGroup.width} ${shapeGroup.height}`}
>
  <path d="..." />
</svg>
```

---

## 3. icon 偏移 / 错位

你现在图标有些位置能显示，但部分线条飞出去，说明：

```text
路径坐标解析不稳定
曲线控制点解析不稳定
父级 transform 没继承
```

要补：

```text
rotation
isFlippedHorizontal
isFlippedVertical
group transform
```

CSS/SVG：

```ts
transform: `
  rotate(${rotation}deg)
  scaleX(${flipX ? -1 : 1})
  scaleY(${flipY ? -1 : 1})
`
```

---

## 4. 文本显示不全

你说的这个非常关键：**不是文字没解析，而是文本容器高度/宽度导致裁剪了。**

Sketch 的文本高度有几种情况：

```text
Fixed width
Fixed size
Auto width
Auto height
```

你现在可能直接用了：

```ts
height = layer.frame.height
overflow = hidden
```

结果文本被裁掉。

建议：

```css
overflow: visible;
white-space: pre-wrap;
line-height: xxxpx;
```

对于 Text 节点，MVP 阶段不要默认 `overflow: hidden`。

```tsx
style={{
  width,
  minHeight: height,
  height: "auto",
  overflow: "visible",
  lineHeight,
}}
```

如果 Sketch 是固定文本框，再用 hidden；否则用 auto height。

---

## 5. 字体排版不一致

主要差异：

```text
标题 Icon 的大小/字重/行高不完全一致
标签文字垂直居中略偏
部分文本间距不对
```

你需要补这些字段：

```text
fontSize
fontWeight
lineHeight
letterSpacing / kerning
paragraphStyle.alignment
verticalAlignment
textBehaviour / resizingBehaviour
```

尤其要处理：

```ts
paragraphStyle.minimumLineHeight
paragraphStyle.maximumLineHeight
```

不要只用 `fontSize`，很多 Sketch 文本靠 `lineHeight` 控制垂直位置。

---

## 6. 圆角容器阴影不一致

上方白色 icon 容器，Sketch 里有明显：

```text
白底
圆角
边框
柔和阴影
```

你解析后阴影弱/位置不一致，可能缺：

```text
style.shadows
style.innerShadows
contextSettings.opacity
border position
```

补：

```ts
boxShadow = `${x}px ${y}px ${blur}px ${spread}px ${color}`
```

如果是多个 shadow，要全部拼接：

```css
box-shadow: 0 2px 8px rgba(...), 0 8px 24px rgba(...);
```

---

## 7. 红色区域高度 / 位置差异

红色 icon 区域整体看起来接近，但位置和高度还不完全一致。

可能原因：

```text
1. frame.y 偏移
2. group 子元素坐标没相对父级
3. border / shadow 占位影响
4. 页面缩放比例不一致
```

排查时打印每个大容器：

```text
name
x
y
width
height
```

先确认大容器坐标对不对，再看子节点。

---

## 8. 分割线 / 灰线样式不一致

Sketch 原图里细线更浅、更细，解析后可能粗细/颜色不对。

需要补：

```text
line 类型
border.thickness
border.color
opacity
```

线条不要用普通 div 高度随便画，要按：

```ts
height: 1px;
transform: scaleY(0.5); // 如果需要模拟 0.5px
```

---

# 你现在要完善的解析顺序

按这个顺序补，收益最大：

```text
1. 修 shapeGroup / shapePath 坐标体系
2. 修 curveFrom / curveTo 曲线路径
3. Text 不默认 overflow hidden
4. 补 lineHeight / kerning / verticalAlign
5. 补 shadows 多阴影
6. 补 border position / dash / opacity
7. 补 transform / flip / rotation
8. 补 mask / clipping
```

---

# shapePath 重点修正版逻辑

核心规则：

```ts
function convertShapeGroup(group) {
  const w = group.frame.width;
  const h = group.frame.height;

  return {
    type: "Vector",
    layout: {
      x: group.frame.x,
      y: group.frame.y,
      width: w,
      height: h,
    },
    svg: {
      viewBox: `0 0 ${w} ${h}`,
      paths: group.layers
        .filter(l => l._class === "shapePath")
        .map(path => ({
          d: shapePathToD(path, { width: w, height: h }),
          fill: parseFill(group.style?.fills),
          stroke: parseStroke(group.style?.borders),
        }))
    }
  };
}
```

不要让 `shapePath` 自己决定外层位置，除非它不是在 `shapeGroup` 里。

---

# Text 重点修正版

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
    fontFamily,
    fontSize,
    fontWeight,
    lineHeight,
    letterSpacing,
    color,
    whiteSpace: "pre-wrap",
  }}
>
  {text}
</div>
```

如果你一定要按 Sketch 固定高度裁剪，再根据文本行为判断，而不是默认裁剪。

---

# 一句话总结

你现在最大的问题不是“没解析”，而是：

```text
shapePath 坐标体系错
+
Text 尺寸行为错
+
Shadow / border / lineHeight 细节没补
```

先把这三个修掉，还原度会从现在的 80% 左右提升到 90% 左右。
