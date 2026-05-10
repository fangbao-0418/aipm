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
      if (normalized.type === "icon") {
        resolved.push({
          id: normalized.id,
          type: "icon",
          name: normalized.name,
          usage: normalized.usage,
          source: "local-placeholder",
          license: "local-svg"
        });
        continue;
      }
      const query = buildAssetSearchQuery(normalized, context.userRequest);
      const searched = await searchImage(query, normalized);
      if (searched) {
        resolved.push(searched);
        continue;
      }
      const generated = await generateImage(query, normalized);
      if (generated) {
        resolved.push(generated);
        continue;
      }
      resolved.push({
        id: normalized.id,
        type: normalized.type === "illustration" ? "illustration" : "image",
        name: normalized.name,
        usage: normalized.usage,
        source: "local-placeholder",
        license: "generated-placeholder"
      });
    }
    return resolved;
  }
}

function normalizeAssetRequest(request: DesignImageAssetRequest) {
  const type = request.type === "image" || request.type === "illustration" || request.type === "icon" ? request.type : "image";
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

