type SpaMetadata = {
  title: string;
  description: string;
  canonicalPath: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImagePath?: string;
  robots?: string;
};

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

export function injectSpaMetadata(html: string, metadata: SpaMetadata) {
  const canonicalUrl = `https://calender.aido.co.zw${metadata.canonicalPath}`;
  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description);
  const ogTitle = metadata.ogTitle ?? metadata.title;
  const ogDescription = metadata.ogDescription ?? metadata.description;
  const ogImage = `https://calender.aido.co.zw${
    metadata.ogImagePath ?? "/web-app-manifest-512x512.png"
  }`;

  let next = html;
  next = replaceTag(
    next,
    /<title>[\s\S]*?<\/title>/,
    `<title>${title}</title>`,
  );
  next = upsertMeta(next, "name", "description", description);
  next = replaceTag(
    next,
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/,
    `<link rel="canonical" href="${canonicalUrl}" />`,
  );
  next = upsertMeta(next, "property", "og:title", ogTitle);
  next = upsertMeta(next, "property", "og:description", ogDescription);
  next = upsertMeta(next, "property", "og:url", canonicalUrl);
  next = upsertMeta(next, "property", "og:type", "website");
  next = upsertMeta(next, "property", "og:image", ogImage);
  next = upsertMeta(next, "name", "twitter:card", "summary_large_image");
  next = upsertMeta(next, "name", "twitter:title", ogTitle);
  next = upsertMeta(next, "name", "twitter:description", ogDescription);
  next = upsertMeta(next, "name", "twitter:image", ogImage);
  next = upsertMeta(
    next,
    "name",
    "robots",
    metadata.robots ?? "index, follow",
  );

  return next;
}
