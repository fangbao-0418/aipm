对，这版**已经不是大面积错乱**，但还剩几个关键问题。

## 1. 第一列整体被蓝色虚线选区压住

右图里蓝色虚线贯穿整列，说明你渲染时把某个父容器/选中框放到了内容层上面。

要检查：

```text
Overlay / SelectionLayer 层级太高
或者某个 group 的 border 被当成内容渲染了
```

处理：

```text
设计内容层 z-index: 1
选中框/辅助线 z-index: 1000
但选中框不要参与导入图层渲染
```

如果这个蓝线来自 Sketch 图层，说明你把：

```text
prototype / guide / selection / slice / hotspot
```

也渲染了，需要过滤。

---

## 2. 图标整体位置偏左 / 第一列被截断

左图第一列图标有部分在容器外或者贴边，右图第一列也明显被蓝线切过。

重点检查：

```text
shapeGroup.frame.x
父级 group.frame.x
artboard/frame.x
```

你现在可能存在：

```text
父级 x 被减了一次
或 child x 没累加
或所有图标按 page 坐标渲染，没有按父容器坐标渲染
```

如果 DOM/SVG 使用嵌套结构：

```tsx
parent: position:absolute; left: parent.x
child:  position:absolute; left: child.x
```

那 child 不要再加 parent.x。

如果你是扁平渲染：

```ts
absX = parentAbsX + child.x
```

就必须所有节点都转成绝对坐标。

**两种方式只能选一种，不能混用。**

---

## 3. 仍然有少量飞线 / 细长线条

这些一般还是 `shapePath` 坐标或曲线导致的。

但从右图看，大面积飞线少了，说明你之前改的 `shapePath.frame + point * frame` 是对的。

剩余飞线重点查：

```text
hasCurveFrom / hasCurveTo 为 false 时，不要使用 curveFrom/curveTo
shapePath.frame.width/height 为 0 或异常时跳过
path 坐标超过自身 frame 太多时跳过
```

加保护：

```ts
function shouldUseCurve(prev, curr) {
  return prev.hasCurveFrom === true && curr.hasCurveTo === true;
}
```

不要因为 `curveFrom/curveTo` 字段存在就走贝塞尔。

---

## 4. 小图标有些还是方块

右图里很多 icon 变成小黑方块，说明：

```text
有些 shapePath 没有正确转成路径
或者只画了外接矩形
或者你把 rectangle / shapePath 都统一当 rect 画了
```

你要确认：

```text
shapePath 必须用 points 生成 path
rectangle 才能转 rect/path
```

不要这样：

```ts
if layer has frame → draw rect
```

应该：

```ts
_class === shapePath → points → path
_class === rectangle → rect path
_class === oval → ellipse path
```

---

## 5. 上方白色卡片的阴影/圆角差异

右图比 Sketch 更硬、更深，尤其下边阴影明显。

需要检查：

```text
shadow blur
shadow spread
shadow opacity
多阴影是否叠加
```

Sketch 的阴影通常不是简单：

```css
box-shadow: x y blur color
```

还要叠加 opacity：

```ts
finalAlpha = shadow.color.alpha * style.contextSettings.opacity
```

---

## 6. 图标行列间距略不一致

这不是 SVG path 的问题，而是层级/父容器定位问题。

如果这一区域是一个大 group，正确结构应该是：

```text
IconGridGroup
 ├ icon1 shapeGroup
 ├ icon2 shapeGroup
 ├ icon3 shapeGroup
```

不要把所有 icon 扁平丢到页面根层，否则容器偏移会乱。

---

# 现在建议你按这个顺序排查

```text
1. 先移除/过滤蓝色选中线、guide、slice、hotspot
2. 固定一种坐标策略：嵌套相对坐标 or 全量绝对坐标
3. shapePath 只在 hasCurveFrom/hasCurveTo 为 true 时用曲线
4. path 坐标超出 shapePath.frame 2 倍以上就打日志
5. 不要把 shapePath 当 rectangle 渲染
6. 再调 shadow / radius
```

最关键一句：**现在主要问题已经不是 points 公式，而是“层级坐标策略混用 + 部分 shapePath 被错误降级成方块 + 选中/辅助图层被渲染出来”。**
