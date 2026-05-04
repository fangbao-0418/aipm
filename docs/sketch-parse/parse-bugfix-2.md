是的，这版明显更坏了。这个效果基本可以判断：**shapePath 坐标缩放/坐标系处理改错了**，导致很多 SVG path 被拉长、飞线、变成大黑笔画。

你现在先别继续叠功能，要回退到上一个稳定版本，然后专门修 `shapePath`。

## 主要问题判断

### 1. `shapePath.points` 被错误缩放了

你现在很多线条飞出去，说明你把 `point / curveFrom / curveTo` 乘错了。

Sketch 的点有两种可能：

```text
情况 A：0~1 归一化坐标，例如 {0.5, 0.5}
情况 B：已经是实际坐标，例如 {12, 8}
```

你现在大概率统一做了：

```ts
x = point.x * group.width
y = point.y * group.height
```

但如果点本来已经是实际坐标，就会被放大几十倍，直接飞出去。

必须先判断是不是归一化：

```ts
function isNormalizedPoint(x: number, y: number) {
  return Math.abs(x) <= 1 && Math.abs(y) <= 1;
}
```

然后：

```ts
function normalizePoint(raw: string, size: { width: number; height: number }) {
  const [x, y] = parseRawPoint(raw);

  if (isNormalizedPoint(x, y)) {
    return {
      x: x * size.width,
      y: y * size.height,
    };
  }

  return { x, y };
}
```

---

### 2. `curveFrom / curveTo` 用错方向了

Sketch 贝塞尔曲线常见规则是：

```text
上一点的 curveFrom → 当前曲线第一个控制点
当前点的 curveTo → 当前曲线第二个控制点
当前点 point → 终点
```

也就是：

```ts
prev.curveFrom
curr.curveTo
curr.point
```

如果你写成：

```ts
prev.curveTo
curr.curveFrom
```

就会出现飞线、大弧线、异常尖刺。

建议先临时关闭曲线，只用直线验证：

```ts
d += ` L ${curr.x} ${curr.y}`;
```

如果关闭曲线后图标恢复正常，说明问题就在 `curveFrom / curveTo`。

---

### 3. shapePath 不应该自己 absolute 定位

你现在很多 icon 内部路径偏移，可能是：

```text
shapeGroup 已经定位一次
shapePath 又定位一次
```

正确方式：

```text
shapeGroup 负责外层 x/y/width/height
shapePath 只负责 SVG 内部 d
```

不要给每个 path 单独加 left/top。

正确结构：

```tsx
<svg
  style={{
    position: "absolute",
    left: shapeGroup.x,
    top: shapeGroup.y,
    width: shapeGroup.width,
    height: shapeGroup.height,
  }}
  viewBox={`0 0 ${shapeGroup.width} ${shapeGroup.height}`}
>
  <path d={shapePathD} />
</svg>
```

---

## 现在建议你这样排查

### 第一步：禁用曲线

先把所有 `C` 改成 `L`。

```ts
function shapePathToD(points, size) {
  const first = toPoint(points[0].point, size);
  let d = `M ${first.x} ${first.y}`;

  for (let i = 1; i < points.length; i++) {
    const p = toPoint(points[i].point, size);
    d += ` L ${p.x} ${p.y}`;
  }

  return d + " Z";
}
```

如果飞线消失，说明曲线控制点错了。

---

### 第二步：打印异常点

加一个保护：

```ts
function assertPoint(p, size, layerName) {
  const maxX = size.width * 2;
  const maxY = size.height * 2;

  if (
    p.x < -maxX ||
    p.x > maxX ||
    p.y < -maxY ||
    p.y > maxY
  ) {
    console.warn("异常 path 点", layerName, p, size);
  }
}
```

如果你看到大量几千、几万的点，说明重复缩放了。

---

### 第三步：只渲染一个 icon

不要一次渲染 2000 个 layers。
先只取一个异常图标，比如那个大黑弧线，打印：

```text
shapeGroup.frame
shapePath.points
curveFrom
curveTo
生成的 d
```

---

## 推荐修正版核心代码

```ts
function parseRawPoint(value: string): [number, number] {
  const nums = value.match(/-?\d+(\.\d+)?/g)?.map(Number) || [0, 0];
  return [nums[0] ?? 0, nums[1] ?? 0];
}

function toSvgPoint(
  value: string,
  size: { width: number; height: number }
) {
  const [x, y] = parseRawPoint(value);

  const normalized =
    Math.abs(x) <= 1 &&
    Math.abs(y) <= 1;

  return normalized
    ? {
        x: Number((x * size.width).toFixed(3)),
        y: Number((y * size.height).toFixed(3)),
      }
    : {
        x: Number(x.toFixed(3)),
        y: Number(y.toFixed(3)),
      };
}

function shapePathToD(layer: any, size: { width: number; height: number }) {
  const points = layer.points || [];
  if (!points.length) return "";

  const first = toSvgPoint(points[0].point, size);
  let d = `M ${first.x} ${first.y}`;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    const currPoint = toSvgPoint(curr.point, size);

    const c1 = prev.curveFrom
      ? toSvgPoint(prev.curveFrom, size)
      : null;

    const c2 = curr.curveTo
      ? toSvgPoint(curr.curveTo, size)
      : null;

    const hasCurve = c1 && c2;

    if (hasCurve) {
      d += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${currPoint.x} ${currPoint.y}`;
    } else {
      d += ` L ${currPoint.x} ${currPoint.y}`;
    }
  }

  if (layer.isClosed !== false) {
    d += " Z";
  }

  return d;
}
```

---

## 先别做 boolean

你现在这个阶段先关掉：

```text
booleanOperation
evenodd
mask
curve 高级处理
```

先做到：

```text
shapeGroup 定位正确
shapePath 点位正确
icon 不飞线
```

再补 boolean。

---

## 一句话结论

你现在的问题不是样式问题，是 **SVG path 坐标系被破坏了**。
先回退，然后按这个顺序修：

```text
1. shapeGroup 只负责外层定位
2. shapePath 只生成内部 path d
3. point 判断是否归一化，避免重复缩放
4. 暂时关闭曲线，只用 L 验证
5. 再恢复 curveFrom / curveTo
```

把这 5 步做完，飞线和大黑弧线基本会消失。
