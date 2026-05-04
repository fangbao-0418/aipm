可以。下面给你三份东西合并成一套工程方案：

1. **Sketch → CSS 字段级映射表**
2. **`shapePath → SVG path` 完整实现，支持曲线**
3. **90% 还原转换器模板**

说明：Sketch 官方提供文件格式规范 / JSON Schema，但不提供 Web 渲染器；Fills、Borders、Shadows、Blur 等属于 Sketch 样式能力，需要你自己映射成 CSS/SVG。([Sketch Developers][1])

---

# 一、Sketch → CSS 字段级映射表

## 1. 通用 Layer 字段

| Sketch 字段             | 说明    | Web/CSS 映射                      |
| --------------------- | ----- | ------------------------------- |
| `do_objectID`         | 图层 ID | `id`                            |
| `name`                | 图层名   | `data-name` / schema.name       |
| `_class`              | 图层类型  | `Frame/Text/Shape/Image/Vector` |
| `frame.x`             | X 坐标  | `left: xpx`                     |
| `frame.y`             | Y 坐标  | `top: ypx`                      |
| `frame.width`         | 宽     | `width: wpx`                    |
| `frame.height`        | 高     | `height: hpx`                   |
| `rotation`            | 旋转    | `transform: rotate(...)`        |
| `isVisible`           | 是否显示  | `display: none`                 |
| `isLocked`            | 是否锁定  | editor 状态，不影响 CSS               |
| `isFlippedHorizontal` | 水平翻转  | `transform: scaleX(-1)`         |
| `isFlippedVertical`   | 垂直翻转  | `transform: scaleY(-1)`         |

基础 CSS：

```ts
function parseLayout(layer: any) {
  const frame = layer.frame || {};

  return {
    position: "absolute",
    left: `${frame.x ?? 0}px`,
    top: `${frame.y ?? 0}px`,
    width: `${frame.width ?? 0}px`,
    height: `${frame.height ?? 0}px`,
    display: layer.isVisible === false ? "none" : undefined,
    transform: buildTransform(layer),
  };
}

function buildTransform(layer: any) {
  const arr: string[] = [];

  if (layer.rotation) arr.push(`rotate(${layer.rotation}deg)`);
  if (layer.isFlippedHorizontal) arr.push("scaleX(-1)");
  if (layer.isFlippedVertical) arr.push("scaleY(-1)");

  return arr.length ? arr.join(" ") : undefined;
}
```

---

## 2. Fill 映射

| Sketch 字段                      | 说明     | Web/CSS                           |
| ------------------------------ | ------ | --------------------------------- |
| `style.fills[]`                | 填充数组   | 多 background                      |
| `fill.isEnabled`               | 是否启用   | 过滤                                |
| `fill.fillType = 0`            | 纯色     | `background-color`                |
| `fill.fillType = 1`            | 渐变     | `linear-gradient/radial-gradient` |
| `fill.fillType = 4`            | 图片填充   | `background-image: url(...)`      |
| `fill.color`                   | 颜色     | `rgba(...)`                       |
| `fill.contextSettings.opacity` | 填充透明度  | 合并到 rgba                          |
| `fill.gradient`                | 渐变对象   | CSS gradient                      |
| `fill.image._ref`              | 图片资源引用 | assets URL                        |

```ts
function parseFills(style: any, ctx: ConvertContext) {
  const fills = (style?.fills || []).filter((f: any) => f.isEnabled !== false);

  if (!fills.length) return {};

  const backgrounds: string[] = [];
  let backgroundColor: string | undefined;

  for (const fill of fills) {
    if (fill.fillType === 0) {
      backgroundColor = parseColor(fill.color, fill.contextSettings?.opacity);
    }

    if (fill.fillType === 1 && fill.gradient) {
      backgrounds.push(parseGradient(fill.gradient, fill.contextSettings?.opacity));
    }

    if (fill.fillType === 4 && fill.image?._ref) {
      backgrounds.push(`url("${ctx.resolveImage(fill.image._ref)}")`);
    }
  }

  return {
    backgroundColor,
    backgroundImage: backgrounds.length ? backgrounds.join(", ") : undefined,
    backgroundSize: backgrounds.length ? "cover" : undefined,
    backgroundRepeat: backgrounds.length ? "no-repeat" : undefined,
  };
}
```

---

## 3. Border 映射

| Sketch 字段                         | 说明                    | Web/CSS                                         |
| --------------------------------- | --------------------- | ----------------------------------------------- |
| `style.borders[]`                 | 描边数组                  | `border` / `outline` / SVG stroke               |
| `border.isEnabled`                | 是否启用                  | 过滤                                              |
| `border.color`                    | 描边颜色                  | `border-color`                                  |
| `border.thickness`                | 粗细                    | `border-width`                                  |
| `border.position`                 | inside/center/outside | DOM 难 100%，SVG 更准                               |
| `style.borderOptions.dashPattern` | 虚线                    | `border-style: dashed` / SVG `stroke-dasharray` |
| `lineCapStyle`                    | 端点                    | SVG `stroke-linecap`                            |
| `lineJoinStyle`                   | 连接                    | SVG `stroke-linejoin`                           |

```ts
function parseBorders(style: any) {
  const border = (style?.borders || []).find((b: any) => b.isEnabled !== false);
  if (!border) return {};

  const color = parseColor(border.color);
  const width = border.thickness ?? 1;
  const dash = style?.borderOptions?.dashPattern;

  return {
    border: `${width}px ${dash?.length ? "dashed" : "solid"} ${color}`,
  };
}
```

复杂矢量建议不要用 CSS border，要用 SVG stroke。

---

## 4. Radius 映射

| Sketch 字段               | 说明    | Web/CSS          |
| ----------------------- | ----- | ---------------- |
| `fixedRadius`           | 固定圆角  | `border-radius`  |
| `cornerRadius`          | 圆角    | `border-radius`  |
| `points[].cornerRadius` | 路径点圆角 | SVG path，DOM 难还原 |

```ts
function parseRadius(layer: any) {
  const radius =
    layer.fixedRadius ??
    layer.cornerRadius ??
    layer.style?.cornerRadius;

  return typeof radius === "number" ? { borderRadius: `${radius}px` } : {};
}
```

---

## 5. Shadow 映射

Sketch 支持 shadow / inner shadow，官方文档也把它作为 layer/frame/group 的样式能力。([Sketch][2])

| Sketch 字段              | 说明  | Web/CSS                 |
| ---------------------- | --- | ----------------------- |
| `style.shadows[]`      | 外阴影 | `box-shadow`            |
| `style.innerShadows[]` | 内阴影 | `box-shadow: inset ...` |
| `offsetX`              | X   | box-shadow X            |
| `offsetY`              | Y   | box-shadow Y            |
| `blurRadius`           | 模糊  | box-shadow blur         |
| `spread`               | 扩散  | box-shadow spread       |
| `color`                | 颜色  | rgba                    |

```ts
function parseShadows(style: any) {
  const shadows = [
    ...(style?.shadows || []).map((s: any) => ({ ...s, inset: false })),
    ...(style?.innerShadows || []).map((s: any) => ({ ...s, inset: true })),
  ].filter((s: any) => s.isEnabled !== false);

  if (!shadows.length) return {};

  return {
    boxShadow: shadows
      .map((s: any) => {
        const inset = s.inset ? "inset " : "";
        return `${inset}${s.offsetX ?? 0}px ${s.offsetY ?? 0}px ${s.blurRadius ?? 0}px ${s.spread ?? 0}px ${parseColor(s.color)}`;
      })
      .join(", "),
  };
}
```

---

## 6. Blur / Opacity / Blend

| Sketch 字段                         | 说明      | Web/CSS                  |
| --------------------------------- | ------- | ------------------------ |
| `style.blur.isEnabled`            | 模糊启用    | 过滤                       |
| `style.blur.type`                 | blur 类型 | `filter/backdrop-filter` |
| `style.blur.radius`               | 半径      | `blur(px)`               |
| `style.contextSettings.opacity`   | 透明度     | `opacity`                |
| `style.contextSettings.blendMode` | 混合模式    | `mix-blend-mode`         |

```ts
function parseContext(style: any) {
  return {
    opacity: style?.contextSettings?.opacity ?? undefined,
    mixBlendMode: mapBlendMode(style?.contextSettings?.blendMode),
  };
}

function parseBlur(style: any) {
  const blur = style?.blur;
  if (!blur || blur.isEnabled === false) return {};

  // Sketch motion/zoom blur Web 很难完全还原，先降级
  if (blur.type === 0) {
    return { filter: `blur(${blur.radius ?? 0}px)` };
  }

  if (blur.type === 3) {
    return { backdropFilter: `blur(${blur.radius ?? 0}px)` };
  }

  return { filter: `blur(${blur.radius ?? 0}px)` };
}
```

Sketch 现在也支持 fills/borders/shadows/blurs 等多重外观样式，字段转换时要支持数组，而不是只取第一个。([Sketch][3])

---

## 7. Text 映射

| Sketch 字段                                         | 说明              | CSS               |
| ------------------------------------------------- | --------------- | ----------------- |
| `attributedString.string`                         | 文本内容            | textContent       |
| `attributes[].location`                           | 起点              | range start       |
| `attributes[].length`                             | 长度              | range end         |
| `MSAttributedStringColorAttribute`                | 字色              | `color`           |
| `MSAttributedStringFontAttribute.attributes.name` | 字体 PostScript 名 | `font-family`     |
| `MSAttributedStringFontAttribute.attributes.size` | 字号              | `font-size`       |
| `paragraphStyle.alignment`                        | 对齐              | `text-align`      |
| `paragraphStyle.minimumLineHeight`                | 行高              | `line-height`     |
| `kerning`                                         | 字间距             | `letter-spacing`  |
| `underlineStyle`                                  | 下划线             | `text-decoration` |
| `strikethroughStyle`                              | 删除线             | `text-decoration` |

```ts
function parseTextLayer(layer: any) {
  const text = layer.attributedString?.string ?? "";
  const attributes = layer.attributedString?.attributes || [];

  const ranges = attributes.map((item: any) => {
    const start = item.location ?? 0;
    const end = start + (item.length ?? text.length);
    return {
      start,
      end,
      text: safeSlice(text, start, end),
      style: parseTextAttributes(item.attributes || {}),
    };
  });

  return {
    content: text,
    ranges,
    style: ranges[0]?.style || {},
  };
}
```

---

# 二、`shapePath → SVG path` 完整实现，支持曲线

Sketch 的 `shapePath.points[]` 通常包含：

```text
point
curveFrom
curveTo
curveMode
cornerRadius
```

这些坐标很多是 `"{0.5, 0.5}"` 这种 0~1 的归一化坐标，需要乘以 layer 的 width/height。复杂路径应转 SVG，而不是 DOM。官方文件格式规范只定义数据结构，不会给你 Web 映射实现。([Sketch Developers][1])

## 1. 类型定义

```ts
type SketchPoint = {
  point: string;       // "{0.5, 0.5}"
  curveFrom?: string;  // "{0.4, 0.5}"
  curveTo?: string;    // "{0.6, 0.5}"
  curveMode?: number;
  cornerRadius?: number;
  hasCurveFrom?: boolean;
  hasCurveTo?: boolean;
};

type Size = {
  width: number;
  height: number;
};

type XY = {
  x: number;
  y: number;
};
```

---

## 2. 坐标解析

```ts
function parseSketchPoint(value?: string, size?: Size): XY | null {
  if (!value) return null;

  const matched = value.match(/-?\d+(\.\d+)?/g);
  if (!matched || matched.length < 2) return null;

  const nx = Number(matched[0]);
  const ny = Number(matched[1]);

  return {
    x: nx * (size?.width ?? 1),
    y: ny * (size?.height ?? 1),
  };
}

function fmt(n: number) {
  return Number(n.toFixed(3));
}
```

---

## 3. 核心 path 生成

原则：

```text
当前点 current
下一个点 next

如果 current.curveFrom 或 next.curveTo 存在：
  用 C cubic bezier
否则：
  用 L line
```

```ts
function sketchShapePathToSvgD(points: SketchPoint[], size: Size, closed = true) {
  if (!points?.length) return "";

  const first = parseSketchPoint(points[0].point, size);
  if (!first) return "";

  let d = `M ${fmt(first.x)} ${fmt(first.y)}`;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const current = points[i];

    const prevPoint = parseSketchPoint(prev.point, size);
    const currentPoint = parseSketchPoint(current.point, size);

    if (!prevPoint || !currentPoint) continue;

    const c1 = parseSketchPoint(prev.curveFrom, size) || prevPoint;
    const c2 = parseSketchPoint(current.curveTo, size) || currentPoint;

    const hasCurve =
      hasRealCurve(c1, prevPoint) ||
      hasRealCurve(c2, currentPoint) ||
      prev.hasCurveFrom ||
      current.hasCurveTo;

    if (hasCurve) {
      d += ` C ${fmt(c1.x)} ${fmt(c1.y)}, ${fmt(c2.x)} ${fmt(c2.y)}, ${fmt(currentPoint.x)} ${fmt(currentPoint.y)}`;
    } else {
      d += ` L ${fmt(currentPoint.x)} ${fmt(currentPoint.y)}`;
    }
  }

  if (closed) {
    const last = points[points.length - 1];
    const lastPoint = parseSketchPoint(last.point, size);

    const c1 = parseSketchPoint(last.curveFrom, size) || lastPoint;
    const c2 = parseSketchPoint(points[0].curveTo, size) || first;

    const hasClosingCurve =
      !!lastPoint &&
      (hasRealCurve(c1, lastPoint) ||
        hasRealCurve(c2, first) ||
        last.hasCurveFrom ||
        points[0].hasCurveTo);

    if (lastPoint && hasClosingCurve) {
      d += ` C ${fmt(c1!.x)} ${fmt(c1!.y)}, ${fmt(c2!.x)} ${fmt(c2!.y)}, ${fmt(first.x)} ${fmt(first.y)}`;
    }

    d += " Z";
  }

  return d;
}

function hasRealCurve(a: XY | null, b: XY | null) {
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) > 0.001 || Math.abs(a.y - b.y) > 0.001;
}
```

---

## 4. 转 SVG 节点

```ts
function convertShapePath(layer: any, ctx: ConvertContext): SchemaNode {
  const frame = layer.frame || {};
  const width = frame.width ?? 0;
  const height = frame.height ?? 0;

  const points = layer.points || [];
  const d = sketchShapePathToSvgD(points, { width, height }, layer.isClosed !== false);

  return {
    id: layer.do_objectID,
    name: layer.name,
    type: "Vector",
    visible: layer.isVisible !== false,
    locked: layer.isLocked === true,
    layout: convertLayout(layer),
    svg: {
      viewBox: `0 0 ${width} ${height}`,
      paths: [
        {
          d,
          fill: firstFillColor(layer.style, ctx),
          stroke: firstStroke(layer.style),
        },
      ],
    },
    style: {
      ...parseContext(layer.style),
    },
  };
}
```

---

## 5. React 渲染 Vector

```tsx
function RenderVector({ node }: { node: SchemaNode }) {
  const style: React.CSSProperties = {
    position: "absolute",
    left: node.layout.x,
    top: node.layout.y,
    width: node.layout.width,
    height: node.layout.height,
    transform: node.layout.transform,
    opacity: node.style?.opacity,
    overflow: "visible",
  };

  return (
    <svg
      style={style}
      viewBox={node.svg?.viewBox}
      width={node.layout.width}
      height={node.layout.height}
    >
      {node.svg?.paths?.map((p: any, index: number) => (
        <path
          key={index}
          d={p.d}
          fill={p.fill || "none"}
          stroke={p.stroke?.color || "none"}
          strokeWidth={p.stroke?.width || 0}
          strokeDasharray={p.stroke?.dashArray}
          strokeLinecap={p.stroke?.lineCap}
          strokeLinejoin={p.stroke?.lineJoin}
        />
      ))}
    </svg>
  );
}
```

---

# 三、90% 还原转换器模板

下面是一个可以直接拆文件使用的模板。

## 1. Schema 类型

```ts
export type NodeType =
  | "Frame"
  | "Group"
  | "Shape"
  | "Text"
  | "Image"
  | "Vector"
  | "SymbolInstance";

export type SchemaNode = {
  id: string;
  name: string;
  type: NodeType;
  visible: boolean;
  locked: boolean;
  layout: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    transform?: string;
  };
  style?: any;
  text?: {
    content: string;
    ranges: Array<{
      start: number;
      end: number;
      text: string;
      style: any;
    }>;
    style: any;
  };
  image?: {
    src: string;
    fit?: "cover" | "contain" | "fill" | "repeat";
  };
  svg?: {
    viewBox: string;
    paths: Array<{
      d: string;
      fill?: string;
      stroke?: any;
    }>;
  };
  children?: SchemaNode[];
  source?: any;
};

export type DesignSchema = {
  pages: Array<{
    id: string;
    name: string;
    nodes: SchemaNode[];
  }>;
  assets: {
    images: Array<{ ref: string; url: string }>;
    symbols: Record<string, SchemaNode>;
    styles: Record<string, any>;
  };
  missing: {
    fonts: string[];
    images: string[];
    libraries: string[];
  };
  importReport: {
    supported: string[];
    degraded: string[];
    unsupported: string[];
  };
};

export type ConvertContext = {
  resolveImage: (ref: string) => string;
  findSymbolMaster: (symbolID: string) => any | null;
  report: {
    supported: Set<string>;
    degraded: Set<string>;
    unsupported: Set<string>;
  };
  missingFonts: Set<string>;
};
```

---

## 2. 主入口

```ts
export async function convertSketchToSchema(sketchFile: any): Promise<DesignSchema> {
  const report = {
    supported: new Set<string>(),
    degraded: new Set<string>(),
    unsupported: new Set<string>(),
  };

  const symbolMasters = collectSymbolMasters(sketchFile);

  const ctx: ConvertContext = {
    resolveImage: (ref: string) => resolveImageUrl(ref),
    findSymbolMaster: (symbolID: string) => symbolMasters.get(symbolID) || null,
    report,
    missingFonts: new Set<string>(),
  };

  const pages = (sketchFile.contents?.pages || sketchFile.pages || []).map((page: any) => {
    return {
      id: page.do_objectID,
      name: page.name,
      nodes: (page.layers || []).map((layer: any) => convertLayer(layer, ctx)).filter(Boolean),
    };
  });

  return {
    pages,
    assets: {
      images: [],
      symbols: Object.fromEntries(
        Array.from(symbolMasters.entries()).map(([id, master]) => [
          id,
          convertLayer(master, ctx),
        ])
      ),
      styles: collectSharedStyles(sketchFile),
    },
    missing: {
      fonts: Array.from(ctx.missingFonts),
      images: [],
      libraries: [],
    },
    importReport: {
      supported: Array.from(report.supported),
      degraded: Array.from(report.degraded),
      unsupported: Array.from(report.unsupported),
    },
  };
}
```

---

## 3. Layer 分发

```ts
function convertLayer(layer: any, ctx: ConvertContext): SchemaNode | null {
  if (!layer) return null;

  switch (layer._class) {
    case "artboard":
      ctx.report.supported.add("artboard");
      return convertFrameLike(layer, "Frame", ctx);

    case "group":
      ctx.report.supported.add("group");
      return convertFrameLike(layer, "Group", ctx);

    case "shapeGroup":
    case "rectangle":
    case "oval":
    case "triangle":
    case "star":
    case "polygon":
    case "line":
      ctx.report.supported.add(layer._class);
      return convertShape(layer, ctx);

    case "shapePath":
      ctx.report.supported.add("shapePath");
      return convertShapePath(layer, ctx);

    case "text":
      ctx.report.supported.add("text");
      return convertText(layer, ctx);

    case "bitmap":
      ctx.report.supported.add("bitmap");
      return convertBitmap(layer, ctx);

    case "symbolInstance":
      ctx.report.degraded.add("symbolInstance");
      return convertSymbolInstance(layer, ctx);

    case "slice":
    case "hotspot":
      ctx.report.unsupported.add(layer._class);
      return null;

    default:
      ctx.report.unsupported.add(layer._class || "unknown");
      return convertFrameLike(layer, "Group", ctx);
  }
}
```

---

## 4. Frame / Group

```ts
function convertFrameLike(layer: any, type: NodeType, ctx: ConvertContext): SchemaNode {
  return {
    id: layer.do_objectID,
    name: layer.name,
    type,
    visible: layer.isVisible !== false,
    locked: layer.isLocked === true,
    layout: convertLayout(layer),
    style: parseLayerStyle(layer, ctx),
    children: (layer.layers || [])
      .map((child: any) => convertLayer(child, ctx))
      .filter(Boolean),
  };
}
```

---

## 5. Shape

```ts
function convertShape(layer: any, ctx: ConvertContext): SchemaNode {
  return {
    id: layer.do_objectID,
    name: layer.name,
    type: "Shape",
    visible: layer.isVisible !== false,
    locked: layer.isLocked === true,
    layout: convertLayout(layer),
    style: parseLayerStyle(layer, ctx),
    children: (layer.layers || [])
      .map((child: any) => convertLayer(child, ctx))
      .filter(Boolean),
  };
}
```

---

## 6. Text

```ts
function convertText(layer: any, ctx: ConvertContext): SchemaNode {
  const parsed = parseTextLayer(layer, ctx);

  return {
    id: layer.do_objectID,
    name: layer.name,
    type: "Text",
    visible: layer.isVisible !== false,
    locked: layer.isLocked === true,
    layout: convertLayout(layer),
    style: {
      ...parseLayerStyle(layer, ctx),
      ...parsed.style,
    },
    text: parsed,
  };
}

function parseTextLayer(layer: any, ctx: ConvertContext) {
  const text = layer.attributedString?.string ?? "";
  const attributes = layer.attributedString?.attributes || [];

  const ranges = attributes.length
    ? attributes.map((item: any) => {
        const start = item.location ?? 0;
        const end = start + (item.length ?? text.length);
        const style = parseTextAttributes(item.attributes || layer.style?.textStyle?.encodedAttributes || {}, ctx);

        return {
          start,
          end,
          text: safeSlice(text, start, end),
          style,
        };
      })
    : [
        {
          start: 0,
          end: Array.from(text).length,
          text,
          style: parseTextAttributes(layer.style?.textStyle?.encodedAttributes || {}, ctx),
        },
      ];

  return {
    content: text,
    ranges,
    style: ranges[0]?.style || {},
  };
}

function parseTextAttributes(attrs: any, ctx: ConvertContext) {
  const font = attrs.MSAttributedStringFontAttribute?.attributes || {};
  const fontName = font.name;

  if (fontName && isLikelyMissingFont(fontName)) {
    ctx.missingFonts.add(fontName);
  }

  const paragraph = attrs.paragraphStyle || {};

  return {
    fontFamily: normalizeFontFamily(fontName),
    fontSize: font.size ? `${font.size}px` : undefined,
    fontWeight: guessFontWeight(fontName),
    color: parseColor(attrs.MSAttributedStringColorAttribute),
    lineHeight:
      paragraph.maximumLineHeight || paragraph.minimumLineHeight
        ? `${paragraph.maximumLineHeight || paragraph.minimumLineHeight}px`
        : undefined,
    textAlign: mapTextAlign(paragraph.alignment),
    letterSpacing: attrs.kerning != null ? `${attrs.kerning}px` : undefined,
    textDecoration: buildTextDecoration(attrs),
  };
}
```

---

## 7. Bitmap

```ts
function convertBitmap(layer: any, ctx: ConvertContext): SchemaNode {
  const ref = layer.image?._ref;

  return {
    id: layer.do_objectID,
    name: layer.name,
    type: "Image",
    visible: layer.isVisible !== false,
    locked: layer.isLocked === true,
    layout: convertLayout(layer),
    style: parseLayerStyle(layer, ctx),
    image: {
      src: ref ? ctx.resolveImage(ref) : "",
      fit: "cover",
    },
  };
}
```

---

## 8. Symbol Instance

```ts
function convertSymbolInstance(layer: any, ctx: ConvertContext): SchemaNode {
  const master = ctx.findSymbolMaster(layer.symbolID);

  if (!master) {
    ctx.report.unsupported.add("missingSymbolMaster");
    return {
      id: layer.do_objectID,
      name: layer.name,
      type: "SymbolInstance",
      visible: layer.isVisible !== false,
      locked: layer.isLocked === true,
      layout: convertLayout(layer),
      children: [],
      source: {
        symbolID: layer.symbolID,
        missing: true,
      },
    };
  }

  const expanded = convertLayer(master, ctx);

  return {
    ...(expanded as SchemaNode),
    id: layer.do_objectID,
    name: layer.name,
    layout: convertLayout(layer),
    source: {
      type: "symbolInstance",
      symbolID: layer.symbolID,
      overrides: layer.overrideValues || [],
    },
  };
}
```

---

## 9. 样式总解析

```ts
function parseLayerStyle(layer: any, ctx: ConvertContext) {
  const style = layer.style || {};

  return cleanObject({
    ...parseFills(style, ctx),
    ...parseBorders(style),
    ...parseRadius(layer),
    ...parseShadows(style),
    ...parseBlur(style),
    ...parseContext(style),
    overflow: layer.hasClippingMask ? "hidden" : undefined,
  });
}
```

---

## 10. 工具函数

```ts
function convertLayout(layer: any) {
  const frame = layer.frame || {};

  return {
    x: frame.x ?? 0,
    y: frame.y ?? 0,
    width: frame.width ?? 0,
    height: frame.height ?? 0,
    rotation: layer.rotation ?? 0,
    transform: buildTransform(layer),
  };
}

function parseColor(color: any, opacityOverride?: number) {
  if (!color) return undefined;

  const r = Math.round((color.red ?? 0) * 255);
  const g = Math.round((color.green ?? 0) * 255);
  const b = Math.round((color.blue ?? 0) * 255);
  const a = (color.alpha ?? 1) * (opacityOverride ?? 1);

  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}

function safeSlice(text: string, start: number, end: number) {
  return Array.from(text).slice(start, end).join("");
}

function normalizeFontFamily(name = "") {
  if (name.startsWith("PingFangSC")) return "PingFang SC";
  if (name.startsWith("Helvetica")) return "Helvetica";
  if (name.startsWith("Arial")) return "Arial";
  if (name.toLowerCase().includes("iconfont")) return "iconfont";
  return name;
}

function guessFontWeight(name = "") {
  const n = name.toLowerCase();
  if (n.includes("thin")) return 100;
  if (n.includes("light")) return 300;
  if (n.includes("regular")) return 400;
  if (n.includes("medium")) return 500;
  if (n.includes("semibold")) return 600;
  if (n.includes("bold")) return 700;
  if (n.includes("heavy")) return 800;
  if (n.includes("black")) return 900;
  return 400;
}

function mapTextAlign(alignment?: number) {
  switch (alignment) {
    case 0:
      return "left";
    case 1:
      return "right";
    case 2:
      return "center";
    case 3:
      return "justify";
    default:
      return undefined;
  }
}

function buildTextDecoration(attrs: any) {
  const arr: string[] = [];
  if (attrs.underlineStyle && attrs.underlineStyle !== 0) arr.push("underline");
  if (attrs.strikethroughStyle && attrs.strikethroughStyle !== 0) arr.push("line-through");
  return arr.length ? arr.join(" ") : undefined;
}

function cleanObject<T extends Record<string, any>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "")
  ) as T;
}

function isLikelyMissingFont(fontName: string) {
  // 实际项目里要拿 document.fonts / 已上传字体 / 系统 fallback 做判断
  return Boolean(fontName);
}

function resolveImageUrl(ref: string) {
  return `/assets/imports/current/${ref.replace(/^images\//, "")}`;
}

function collectSymbolMasters(sketchFile: any) {
  const map = new Map<string, any>();

  const visit = (layers: any[] = []) => {
    for (const layer of layers) {
      if (layer._class === "symbolMaster" && layer.symbolID) {
        map.set(layer.symbolID, layer);
      }
      visit(layer.layers || []);
    }
  };

  const pages = sketchFile.contents?.pages || sketchFile.pages || [];
  pages.forEach((page: any) => visit(page.layers || []));

  return map;
}

function collectSharedStyles(sketchFile: any) {
  const document = sketchFile.contents?.document || sketchFile.document || {};
  return {
    layerStyles: document.layerStyles || {},
    textStyles: document.layerTextStyles || {},
    swatches: document.sharedSwatches || {},
  };
}
```

---

# 四、落地优先级

先按这个顺序做：

```text
P0:
1. Text attributedString
2. Fill color
3. Border
4. Radius
5. Bitmap image

P1:
6. Shadow
7. Gradient
8. shapePath → SVG
9. Symbol 展开

P2:
10. Mask
11. Symbol override
12. Shared styles
13. Blend / Blur
```

一句话：**DOM 负责 Frame/Text/Image/普通 Shape，SVG 负责复杂 Vector/Icon；这样最容易做到 90% 还原。**

[1]: https://developer.sketch.com/file-format/spec?utm_source=chatgpt.com "Sketch Developer — Specification"
[2]: https://www.sketch.com/docs/symbols-and-styles/styling/shadows/?utm_source=chatgpt.com "Shadows"
[3]: https://www.sketch.com/features/?utm_source=chatgpt.com "All Sketch Features — Symbols, Layer Styles, Color ..."
