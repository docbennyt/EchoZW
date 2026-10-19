export type SpaMetadata = {
  title: string;
  description: string;
  canonicalPath: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImagePath?: string;
  robots?: string;
};

export const DEFAULT_SOCIAL_IMAGE_PATH =
  "/og/calendarzw-own-your-semester-wide.png?v=2";

const DEFAULT_SOCIAL_IMAGES = [
  {
    path: DEFAULT_SOCIAL_IMAGE_PATH,
    width: 1731,
    height: 909,
    alt: "CalenderZW promotional preview showing a student and the message Own your semester.",
  },
  {
    path: "/og/calendarzw-own-your-semester-square.png?v=2",
    width: 1254,
    height: 1254,
    alt: "CalenderZW square promotional preview showing a student and the message Own your semester.",
  },
] as const;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function replaceTag(html: string, pattern: RegExp, replacement: string) {
  return pattern.test(html) ? html.replace(pattern, replacement) : html;
}

function upsertMeta(
  html: string,
  attribute: "name" | "property",
  key: string,
  value: string,
) {
  const escaped = escapeHtml(value);
  const pattern = new RegExp(
    `<meta\\s+${attribute}="${key}"\\s+content="[^"]*"\\s*\\/?>`,
  );
  const replacement = `<meta ${attribute}="${key}" content="${escaped}" />`;
  if (pattern.test(html)) return html.replace(pattern, replacement);
  return html.replace("</head>", `    ${replacement}\n  </head>`);
}

function removeMeta(html: string, attribute: "name" | "property", key: string) {
  const pattern = new RegExp(
    `\\s*<meta\\s+${attribute}="${key}"[\\s\\S]*?\\/?>\\s*`,
    "g",
  );
  return html.replace(pattern, "\n");
}

function absoluteSocialImageUrl(path: string) {
  if (/^https?:\/\//.test(path)) return path;
  return `https://calender.aido.co.zw${path}`;
}

function renderSocialImageMeta() {
  return DEFAULT_SOCIAL_IMAGES.map((image) => {
    const url = absoluteSocialImageUrl(image.path);
    return [
      `    <meta property="og:image" content="${escapeHtml(url)}" />`,
      `    <meta property="og:image:width" content="${image.width}" />`,
      `    <meta property="og:image:height" content="${image.height}" />`,
      '    <meta property="og:image:type" content="image/png" />',
      `    <meta property="og:image:alt" content="${escapeHtml(image.alt)}" />`,
    ].join("\n");
  }).join("\n");
}

function replaceSocialImageMeta(html: string) {
  let next = html;
  for (const key of [
    "og:image",
    "og:image:secure_url",
    "og:image:width",
    "og:image:height",
    "og:image:type",
    "og:image:alt",
  ]) {
    next = removeMeta(next, "property", key);
  }

  const imageMeta = `${renderSocialImageMeta()}\n`;
  const twitterCardPattern =
    /\s*<meta\s+name="twitter:card"\s+content="[^"]*"\s*\/?>/;
  if (twitterCardPattern.test(next)) {
    return next.replace(twitterCardPattern, `\n${imageMeta}$&`);
  }
  return next.replace("</head>", `${imageMeta}  </head>`);
}

export function injectSpaMetadata(html: string, metadata: SpaMetadata) {
  const canonicalUrl = `https://calender.aido.co.zw${metadata.canonicalPath}`;
  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description);
  const ogTitle = metadata.ogTitle ?? metadata.title;
  const ogDescription = metadata.ogDescription ?? metadata.description;
  const ogImagePath = metadata.ogImagePath ?? DEFAULT_SOCIAL_IMAGE_PATH;
  const ogImage = `https://calender.aido.co.zw${ogImagePath}`;
  const titlePattern = /<title>[\s\S]*?<\/title>/;
  const canonicalPattern = /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/;

  let next = html;
  next = replaceTag(next, titlePattern, `<title>${title}</title>`);
  next = upsertMeta(next, "name", "description", description);
  next = replaceTag(
    next,
    canonicalPattern,
    `<link rel="canonical" href="${canonicalUrl}" />`,
  );
  next = upsertMeta(next, "property", "og:title", ogTitle);
  next = upsertMeta(next, "property", "og:description", ogDescription);
  next = upsertMeta(next, "property", "og:url", canonicalUrl);
  next = upsertMeta(next, "property", "og:type", "website");
  next = replaceSocialImageMeta(next);
  next = upsertMeta(next, "name", "twitter:card", "summary_large_image");
  next = upsertMeta(next, "name", "twitter:title", ogTitle);
  next = upsertMeta(next, "name", "twitter:description", ogDescription);
  next = upsertMeta(next, "name", "twitter:image", ogImage);
  next = upsertMeta(next, "name", "robots", metadata.robots ?? "index, follow");

  return next;
}
