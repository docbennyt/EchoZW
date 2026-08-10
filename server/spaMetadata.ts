type SpaMetadata = {
  title: string;
  description: string;
  canonicalPath: string;
  ogTitle?: string;
  ogDescription?: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function replaceTag(
  html: string,
  pattern: RegExp,
  replacement: string,
) {
  return pattern.test(html) ? html.replace(pattern, replacement) : html;
}

export function injectSpaMetadata(html: string, metadata: SpaMetadata) {
  const canonicalUrl = `https://calender.aido.co.zw${metadata.canonicalPath}`;
  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description);
  const ogTitle = escapeHtml(metadata.ogTitle ?? metadata.title);
  const ogDescription = escapeHtml(metadata.ogDescription ?? metadata.description);

  let next = html;
  next = replaceTag(next, /<title>.*?<\/title>/, `<title>${title}</title>`);
  next = replaceTag(
    next,
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${description}" />`,
  );
  next = replaceTag(
    next,
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/,
    `<link rel="canonical" href="${canonicalUrl}" />`,
  );
  next = replaceTag(
    next,
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:title" content="${ogTitle}" />`,
  );
  next = replaceTag(
    next,
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:description" content="${ogDescription}" />`,
  );
  next = replaceTag(
    next,
    /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:url" content="${canonicalUrl}" />`,
  );

  return next;
}
