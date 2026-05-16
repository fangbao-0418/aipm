export interface ResolvedDesignImageAsset {
  id: string;
  type: "image" | "illustration" | "icon";
  name: string;
  usage: string;
  source: "unsplash" | "pexels" | "openai-image" | "local-placeholder";
  imageUrl?: string;
  alt?: string;
  license?: string;
  width?: number;
  height?: number;
}

export interface DesignImageAssetRequest {
  type?: string;
  name?: string;
  query?: string;
  usage?: string;
  prompt?: string;
}

export class ImageAssetProvider {
  async resolveAssets(requests: DesignImageAssetRequest[], context: { userRequest: string }) {
    const resolved: ResolvedDesignImageAsset[] = [];
    for (const request of requests) {
      const normalized = normalizeAssetRequest(request);
      const query = buildAssetSearchQuery(normalized, context.userRequest);
      resolved.push({
        id: normalized.id,
        type: normalized.type,
        name: normalized.name,
        usage: normalized.usage,
        source: "local-placeholder",
        license: "local-placeholder",
        imageUrl: buildPlaceholderSvgDataUrl({
          label: normalized.name,
          kind: normalized.type,
          hint: query
        }),
        alt: `${normalized.name} placeholder`,
        width: 512,
        height: 320
      });
    }
    return resolved;
  }
}

function normalizeAssetRequest(request: DesignImageAssetRequest) {
  const type: ResolvedDesignImageAsset["type"] = request.type === "image" || request.type === "illustration" || request.type === "icon" ? request.type : "image";
  const name = request.name || request.query || request.prompt || "design asset";
  return {
    id: `${type}_${name}`.replace(/[^\w-]+/g, "_").toLowerCase(),
    type,
    name,
    usage: request.usage || name,
    query: request.query || request.prompt || name
  };
}

function buildAssetSearchQuery(request: ReturnType<typeof normalizeAssetRequest>, userRequest: string) {
  const businessHint = /商品|产品/.test(userRequest)
    ? "product photography clean background"
    : /实名|认证|安全|登录|注册/.test(userRequest)
      ? "security identity app illustration"
      : /地图|地址|出行/.test(userRequest)
        ? "map location mobile app"
        : /支付|收益|提现/.test(userRequest)
          ? "finance wallet mobile app"
          : "modern app interface illustration";
  return `${request.query} ${businessHint}`.trim();
}

async function searchImage(query: string, request: ReturnType<typeof normalizeAssetRequest>): Promise<ResolvedDesignImageAsset | undefined> {
  const provider = (process.env.AIPM_IMAGE_SEARCH_PROVIDER || "").toLowerCase();
  if (provider === "pexels" || (!provider && process.env.PEXELS_API_KEY)) {
    return searchPexels(query, request);
  }
  if (provider === "unsplash" || (!provider && process.env.UNSPLASH_ACCESS_KEY)) {
    return searchUnsplash(query, request);
  }
  return undefined;
}

function buildPlaceholderSvgDataUrl(input: { label: string; kind: string; hint: string }) {
  const title = sanitizeSvgText(input.label || input.kind || "Image").slice(0, 12);
  const subtitle = input.kind === "icon" ? "ICON" : input.kind === "illustration" ? "ILLUSTRATION" : "IMAGE";
  const bg = input.kind === "icon" ? "#2563eb" : input.kind === "illustration" ? "#eef4ff" : "#f3f6fb";
  const fg = input.kind === "icon" ? "#ffffff" : "#64748b";
  const accent = input.kind === "icon" ? "#ffffff" : "#2563eb";
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="320" viewBox="0 0 512 320">`,
    `<rect width="512" height="320" rx="28" fill="${bg}"/>`,
    `<rect x="36" y="36" width="440" height="248" rx="20" fill="none" stroke="${accent}" stroke-opacity="0.18" stroke-width="2" stroke-dasharray="10 10"/>`,
    `<circle cx="176" cy="132" r="34" fill="${accent}" fill-opacity="${input.kind === "icon" ? "0.28" : "0.16"}"/>`,
    `<rect x="226" y="108" width="126" height="14" rx="7" fill="${fg}" fill-opacity="${input.kind === "icon" ? "0.9" : "0.32"}"/>`,
    `<rect x="226" y="136" width="172" height="12" rx="6" fill="${fg}" fill-opacity="${input.kind === "icon" ? "0.72" : "0.22"}"/>`,
    `<rect x="116" y="198" width="280" height="12" rx="6" fill="${fg}" fill-opacity="${input.kind === "icon" ? "0.62" : "0.2"}"/>`,
    `<text x="256" y="250" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="${fg}">${subtitle}</text>`,
    `<text x="256" y="274" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" fill="${fg}" fill-opacity="0.78">${title}</text>`,
    `</svg>`
  ].join("");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function sanitizeSvgText(value: string) {
  return value.replace(/[<>&"']/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "\"": "&quot;",
    "'": "&apos;"
  }[char] ?? char));
}

async function searchUnsplash(query: string, request: ReturnType<typeof normalizeAssetRequest>): Promise<ResolvedDesignImageAsset | undefined> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) return undefined;
  try {
    const url = new URL("https://api.unsplash.com/search/photos");
    url.searchParams.set("query", query);
    url.searchParams.set("per_page", "1");
    url.searchParams.set("orientation", "landscape");
    const response = await fetch(url, {
      headers: { Authorization: `Client-ID ${accessKey}` }
    });
    if (!response.ok) return undefined;
    const payload = await response.json() as {
      results?: Array<{
        id?: string;
        alt_description?: string;
        width?: number;
        height?: number;
        urls?: { regular?: string; small?: string };
        links?: { html?: string };
      }>;
    };
    const photo = payload.results?.[0];
    const imageUrl = photo?.urls?.regular || photo?.urls?.small;
    if (!imageUrl) return undefined;
    return {
      id: request.id,
      type: request.type === "illustration" ? "illustration" : "image",
      name: request.name,
      usage: request.usage,
      source: "unsplash",
      imageUrl,
      alt: photo?.alt_description || query,
      license: photo?.links?.html ? `Unsplash: ${photo.links.html}` : "Unsplash",
      width: photo?.width,
      height: photo?.height
    };
  } catch {
    return undefined;
  }
}

async function searchPexels(query: string, request: ReturnType<typeof normalizeAssetRequest>): Promise<ResolvedDesignImageAsset | undefined> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return undefined;
  try {
    const url = new URL("https://api.pexels.com/v1/search");
    url.searchParams.set("query", query);
    url.searchParams.set("per_page", "1");
    url.searchParams.set("orientation", "landscape");
    const response = await fetch(url, {
      headers: { Authorization: apiKey }
    });
    if (!response.ok) return undefined;
    const payload = await response.json() as {
      photos?: Array<{
        alt?: string;
        width?: number;
        height?: number;
        url?: string;
        src?: { large?: string; medium?: string; landscape?: string };
      }>;
    };
    const photo = payload.photos?.[0];
    const imageUrl = photo?.src?.large || photo?.src?.landscape || photo?.src?.medium;
    if (!imageUrl) return undefined;
    return {
      id: request.id,
      type: request.type === "illustration" ? "illustration" : "image",
      name: request.name,
      usage: request.usage,
      source: "pexels",
      imageUrl,
      alt: photo?.alt || query,
      license: photo?.url ? `Pexels: ${photo.url}` : "Pexels",
      width: photo?.width,
      height: photo?.height
    };
  } catch {
    return undefined;
  }
}

async function generateImage(prompt: string, request: ReturnType<typeof normalizeAssetRequest>): Promise<ResolvedDesignImageAsset | undefined> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.AIPM_IMAGE_GENERATION_API_KEY;
  if (!apiKey) return undefined;
  const baseUrl = (process.env.AIPM_IMAGE_GENERATION_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.AIPM_IMAGE_GENERATION_MODEL || process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  try {
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        prompt: `Create a polished product UI demo image or illustration for: ${prompt}. Clean composition, no text-heavy screenshot.`,
        size: process.env.AIPM_IMAGE_GENERATION_SIZE || "1024x1024",
        n: 1
      })
    });
    if (!response.ok) return undefined;
    const payload = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
    const item = payload.data?.[0];
    const imageUrl = item?.b64_json ? `data:image/png;base64,${item.b64_json}` : item?.url;
    if (!imageUrl) return undefined;
    return {
      id: request.id,
      type: request.type === "illustration" ? "illustration" : "image",
      name: request.name,
      usage: request.usage,
      source: "openai-image",
      imageUrl,
      alt: prompt,
      license: "generated"
    };
  } catch {
    return undefined;
  }
}
