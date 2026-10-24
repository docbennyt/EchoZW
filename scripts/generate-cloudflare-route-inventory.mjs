import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const prettier = require("prettier");
const slash = (path) => path.replaceAll("\\", "/");
const canonical = (path) => path.replace(/:[A-Za-z][A-Za-z0-9]*/g, ":param");
function walk(node, fn) {
  fn(node);
  ts.forEachChild(node, (child) => walk(child, fn));
}
async function filesIn(dir) {
  const result = [];
  for (const entry of await readdir(resolve(root, dir), {
    withFileTypes: true,
  })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) result.push(...(await filesIn(path)));
    else if (/\.(ts|tsx|mjs)$/.test(path)) result.push(path);
  }
  return result.sort();
}
const handlerNames = [
  "adminApi",
  "academicPauseAdminApi",
  "adminAnalyticsApi",
  "analyticsApi",
  "correctionsAdminApi",
  "growthCaptureApi",
  "growthInboxAdminApi",
  "healthApi",
  "paymentApi",
  "pilotAdminApi",
  "pilotCalendarApi",
  "publicTimetableApi",
  "pushNotificationApi",
  "sourceGatewayAdminApi",
  "sourceSnapshotApi",
  "staffAdminApi",
  "staticTimetableImportApi",
  "timetablePublicSettingsAdminApi",
  "viteCalendarPlugin",
  "seoPublic",
  "productionServer",
];

export async function buildInventory(
  previous,
  { sourceOverrides = new Map() } = {},
) {
  const history = previous.historicalInventory ?? previous;
  const sources = new Map();
  for (const path of [
    ...(await filesIn("server")),
    ...(await filesIn("src")),
    ...(await filesIn("worker")),
  ]) {
    const text =
      sourceOverrides.get(path) ??
      (await readFile(resolve(root, path), "utf8"));
    sources.set(path, {
      text,
      ast: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true),
    });
  }
  const evidence = (file, node, role = "dispatch") => ({
    file,
    line:
      sources.get(file).ast.getLineAndCharacterOfPosition(node.getStart())
        .line + 1,
    role,
  });
  const routeMap = new Map();
  const dispatchCandidates = [];
  function add(file, method, path, node, body = node) {
    if (
      !path ||
      !/^\/(api\/|calendar\/|healthz|sitemap\.xml|runtime-config\.js)/.test(
        path,
      )
    )
      return;
    const id = `${method} ${canonical(path)}`;
    const item = routeMap.get(id) ?? {
      method,
      path,
      sourceEvidence: [],
      handlers: [],
    };
    const calls = [];
    walk(body, (child) => {
      if (ts.isCallExpression(child) && ts.isIdentifier(child.expression))
        calls.push(child.expression.text);
    });
    item.sourceEvidence.push(evidence(file, node));
    item.handlers.push({ file, calls, body });
    routeMap.set(id, item);
  }
  function methods(node) {
    const result = new Set();
    walk(node, (child) => {
      if (
        ts.isBinaryExpression(child) &&
        /(?:req|request)\.method$/.test(child.left.getText()) &&
        ts.isStringLiteral(child.right) &&
        child.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
      )
        result.add(child.right.text);
    });
    return [...result];
  }
  function regexPath(raw) {
    let pattern = raw.slice(1, raw.lastIndexOf("/"));
    if (
      !pattern.startsWith("^\\/") ||
      pattern.includes("(?:") ||
      pattern.includes("|")
    )
      return null;
    let index = 0;
    pattern = pattern.replace(
      /\(\[\^\/\]\+\)|\(\[0-9a-f-\]\+\)/g,
      () => `:param${++index}`,
    );
    pattern = pattern
      .replace(/^\^/, "")
      .replace(/\$$/, "")
      .replaceAll("\\/", "/")
      .replaceAll("\\.", ".");
    return /[()[\]?+*\\]/.test(pattern) ? null : pattern;
  }
  const discoveredHandlers = [...sources.keys()]
    .filter((file) => /^server\/[^/]*Api\.ts$/.test(file))
    .map((file) => file.slice(7, -3));
  for (const name of [...new Set([...handlerNames, ...discoveredHandlers])]) {
    const file = `server/${name}.ts`;
    const { ast } = sources.get(file);
    const declarations = new Map();
    walk(ast, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      )
        declarations.set(node.name.text, node.initializer);
    });
    function value(node) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        return node.text;
      if (ts.isIdentifier(node) && declarations.has(node.text))
        return value(declarations.get(node.text));
      if (ts.isTemplateExpression(node))
        return (
          node.head.text +
          node.templateSpans
            .map(
              (span) =>
                (value(span.expression) ?? ":timetableId") + span.literal.text,
            )
            .join("")
        );
      return null;
    }
    const matches = new Map();
    for (const [id, init] of declarations) {
      if (
        ts.isCallExpression(init) &&
        init.expression.getText().endsWith("pathname.match") &&
        init.arguments[0]
      ) {
        let path = regexPath(init.arguments[0].getText());
        if (name === "academicPauseAdminApi" && id === "itemMatch")
          path = "/api/admin/timetables/:timetableId/pauses/:pauseId";
        if (path) matches.set(id, path);
      }
    }
    walk(ast, (node) => {
      if (
        ts.isBinaryExpression(node) &&
        [
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ].includes(node.operatorToken.kind) &&
        /(?:\.pathname|^pathname)$/.test(node.left.getText())
      ) {
        const path = value(node.right);
        if (
          path &&
          /^\/(api\/|calendar\/|healthz|sitemap\.xml|runtime-config\.js)/.test(
            path,
          )
        )
          dispatchCandidates.push({ file, path, node });
      }
    });
    for (const [name, path] of matches)
      dispatchCandidates.push({ file, path, node: declarations.get(name) });
    walk(ast, (node) => {
      if (!ts.isIfStatement(node)) return;
      const allowed = methods(node.expression);
      if (!allowed.length) return;
      const paths = new Set();
      function conditionPaths(expr) {
        walk(expr, (child) => {
          if (ts.isIdentifier(child) && matches.has(child.text))
            paths.add(matches.get(child.text));
          if (
            ts.isBinaryExpression(child) &&
            child.operatorToken.kind ===
              ts.SyntaxKind.EqualsEqualsEqualsToken &&
            /(?:\.pathname|^pathname)$/.test(child.left.getText())
          ) {
            const path = value(child.right);
            if (path) paths.add(path);
          }
        });
      }
      conditionPaths(node.expression);
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (
          ts.isIfStatement(parent) &&
          parent.thenStatement.pos <= node.pos &&
          parent.thenStatement.end >= node.end
        )
          conditionPaths(parent.expression);
        if (ts.isFunctionDeclaration(parent)) break;
      }
      for (const path of paths)
        for (const method of allowed)
          add(file, method, path, node, node.thenStatement);
    });
    // Negative guards, ternary dispatch and optional action captures need explicit expansion.
    const exceptional =
      {
        analyticsApi: [["POST", "/api/analytics/events"]],
        sourceSnapshotApi: [["POST", "/api/internal/source-snapshots"]],
        growthCaptureApi: [
          ["POST", "/api/public/timetable-requests"],
          ["POST", "/api/public/feedback"],
        ],
        pushNotificationApi: [
          ["GET", "/api/public/push/config"],
          ["POST", "/api/public/push/subscriptions/status"],
          ["POST", "/api/public/push/subscriptions"],
          ["DELETE", "/api/public/push/subscriptions"],
        ],
        adminAnalyticsApi: [
          ["GET", "/api/admin/analytics/metrics"],
          ["GET", "/api/admin/analytics/overview"],
        ],
        timetablePublicSettingsAdminApi: [
          ["GET", "/api/admin/timetables/:timetableId/public-settings"],
          ["PUT", "/api/admin/timetables/:timetableId/public-settings"],
        ],
        staticTimetableImportApi: [
          [
            "PATCH",
            "/api/admin/static-timetable-imports/:batchId/targets/:targetId",
          ],
          ["GET", "/api/admin/static-timetable-imports/:batchId"],
          ["POST", "/api/admin/static-timetable-imports/:batchId/draft"],
        ],
      }[name] ?? [];
    for (const [method, path] of exceptional) {
      let anchor;
      walk(ast, (node) => {
        if (
          ts.isFunctionDeclaration(node) &&
          node.name?.text.startsWith("handle")
        )
          anchor ??= node;
        if (ts.isStringLiteral(node) && node.text === path) anchor = node;
      });
      add(file, method, path, anchor ?? ast, ast);
    }
  }
  for (const { file, path, node } of dispatchCandidates) {
    if (
      ![...routeMap.values()].some(
        (route) => canonical(route.path) === canonical(path),
      )
    ) {
      throw new Error(
        `Unextracted dispatch ${file}:${evidence(file, node).line} ${path}; add explicit extraction before generating complete inventory.`,
      );
    }
  }
  const worker = sources.get("worker/index.mjs");
  const workerFetchCalls = new Set();
  walk(worker.ast, (node) => {
    if (ts.isMethodDeclaration(node) && node.name.getText() === "fetch") {
      walk(node, (child) => {
        if (ts.isCallExpression(child) && ts.isIdentifier(child.expression))
          workerFetchCalls.add(child.expression.text);
      });
    }
  });
  const bridge = /return\s+proxyLegacyBackend\(/.test(worker.text);
  const unavailable = worker.text.includes("EDGE_ROUTE_UNAVAILABLE");
  const workerRoutes = [
    ...[
      "institutions",
      "programmes",
      "class-groups",
      "academic-periods",
    ].flatMap((entity) => [
      ["POST", `/api/admin/${entity}`, "handleNativeAdminEntities"],
      ["PATCH", `/api/admin/${entity}/:id`, "handleNativeAdminEntities"],
    ]),
    ["GET", "/api/admin/staff", "handleNativeStaffInvitation"],
    ["POST", "/api/admin/staff/invite-admin", "handleNativeStaffInvitation"],
    ["POST", "/api/admin/timetables", "handleNativeAdminTimetable"],
    ["GET", "/api/admin/timetables/:timetableId", "handleNativeAdminTimetable"],
    [
      "POST",
      "/api/admin/timetables/:timetableId/sessions",
      "handleNativeAdminTimetable",
    ],
    [
      "PATCH",
      "/api/admin/timetables/:timetableId/sessions/:sessionId",
      "handleNativeAdminTimetable",
    ],
    [
      "DELETE",
      "/api/admin/timetables/:timetableId/sessions/:sessionId",
      "handleNativeAdminTimetable",
    ],
    [
      "POST",
      "/api/admin/timetables/:timetableId/publish",
      "handleNativeAdminTimetable",
    ],
    [
      "POST",
      "/api/admin/timetables/:timetableId/google-calendar-sync",
      "handleGoogleCalendarRequest",
    ],
    ["GET", "/api/calendar/google/connect", "handleGoogleCalendarRequest"],
    ["GET", "/api/calendar/google/callback", "handleGoogleCalendarRequest"],
    ["POST", "/api/calendar/google/disconnect", "handleGoogleCalendarRequest"],
    ...["corrections", "exceptions"].flatMap((kind) => [
      ...["PATCH", "DELETE", "POST"].map((method) => [
        method,
        `/api/admin/timetables/:timetableId/${kind}/:itemId`,
        "handleEditorMutations",
      ]),
      [
        "POST",
        `/api/admin/timetables/:timetableId/${kind}/dedupe`,
        "handleEditorMutations",
      ],
    ]),
    [
      "POST",
      "/api/admin/timetables/:timetableId/exceptions",
      "handleEditorMutations",
    ],
    ["GET", "/__release", "releasePayload"],
    ["GET", "/runtime-config.js", "serveRuntimeConfig"],
    ["GET", "/api/health/live", null],
    ["GET", "/healthz", null],
    ["GET", "/api/health/release", "backendReleasePayload"],
    ["GET", "/api/health/ready", null],
    ["GET", "/api/public/timetables", "handleNativePublicTimetableApi"],
    ["GET", "/api/public/timetables/:slug", "handleNativePublicTimetableApi"],
    ["GET", "/api/admin/session", "handleNativeAdminSession"],
    ["GET", "/api/admin/my/timetables", "handleNativeAdminSession"],
    ["GET", "/api/admin/institutions", "handleNativeAdminSession"],
    ["GET", "/api/admin/programmes", "handleNativeAdminSession"],
    ["GET", "/api/admin/class-groups", "handleNativeAdminSession"],
    ["GET", "/api/admin/academic-periods", "handleNativeAdminSession"],
    ["GET", "/api/admin/timetables", "handleNativeAdminSession"],
    [
      "GET",
      "/api/admin/timetables/:timetableId/public-settings",
      "handleNativePublicSettings",
    ],
    [
      "PUT",
      "/api/admin/timetables/:timetableId/public-settings",
      "handleNativePublicSettings",
    ],
    ["POST", "/api/calendar/subscriptions", "handleNativeSubscription"],
    [
      "POST",
      "/api/calendar/subscriptions/:subscriptionId/revoke",
      "revokeOwnedFeedSubscription",
    ],
    ["GET", "/api/admin/academic-pauses", "handleNativeAcademicPauses"],
    ["POST", "/api/admin/academic-pauses", "handleNativeAcademicPauses"],
    [
      "POST",
      "/api/admin/academic-pauses/preview",
      "handleNativeAcademicPauses",
    ],
    [
      "DELETE",
      "/api/admin/academic-pauses/:pauseId",
      "handleNativeAcademicPauses",
    ],
    [
      "GET",
      "/api/admin/timetables/:timetableId/pauses",
      "handleNativeAcademicPauses",
    ],
    [
      "POST",
      "/api/admin/timetables/:timetableId/pauses",
      "handleNativeAcademicPauses",
    ],
    [
      "POST",
      "/api/admin/timetables/:timetableId/pauses/preview",
      "handleNativeAcademicPauses",
    ],
    [
      "DELETE",
      "/api/admin/timetables/:timetableId/pauses/:pauseId",
      "handleNativeAcademicPauses",
    ],
    [
      "GET",
      "/api/admin/timetables/:timetableId/corrections",
      "handleEditorMutations",
    ],
    [
      "POST",
      "/api/admin/timetables/:timetableId/corrections",
      "handleEditorMutations",
    ],
    ["GET", "/api/calendar/google/status", "handleGoogleCalendarRequest"],
    ["GET", "/calendar/feed/:token.ics", "handleNativeCalendarIcs"],
    ["HEAD", "/calendar/feed/:token.ics", "handleNativeCalendarIcs"],
    [
      "GET",
      "/calendar/download/:subscriptionId.ics",
      "handleNativeCalendarIcs",
    ],
    [
      "HEAD",
      "/calendar/download/:subscriptionId.ics",
      "handleNativeCalendarIcs",
    ],
    ["POST", "/api/edge/source-documents", "handleSourceDocumentUpload"],
  ];
  for (const [method, path] of workerRoutes) {
    const id = `${method} ${canonical(path)}`;
    if (!routeMap.has(id))
      routeMap.set(id, { method, path, sourceEvidence: [], handlers: [] });
    routeMap.get(id).path = path;
  }
  walk(worker.ast, (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      node.left.getText().endsWith(".pathname") &&
      ts.isStringLiteral(node.right) &&
      /^\/(api\/|calendar\/)/.test(node.right.text)
    ) {
      const path = node.right.text;
      if (
        !workerRoutes.some(([, known]) => canonical(known) === canonical(path))
      )
        throw new Error(
          `Unclassified Worker dispatch ${path}; review native/disabled/incomplete status before regeneration.`,
        );
    }
  });
  const tests = [];
  for (const file of await filesIn("tests"))
    tests.push({ file, text: await readFile(resolve(root, file), "utf8") });
  const symbolMaps = new Map();
  function symbols(file) {
    if (symbolMaps.has(file)) return symbolMaps.get(file);
    const result = new Map();
    for (const node of sources.get(file).ast.statements) {
      if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
        if (node.name) result.set(node.name.text, { node });
      } else if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations)
          if (ts.isIdentifier(declaration.name) && declaration.initializer)
            result.set(declaration.name.text, {
              node: declaration.initializer,
            });
      } else if (
        ts.isImportDeclaration(node) &&
        node.importClause &&
        !node.importClause.isTypeOnly
      ) {
        const spec = node.moduleSpecifier.text;
        const target = spec.startsWith(".")
          ? slash(
              relative(
                root,
                resolve(root, dirname(file), spec.replace(/\.js$/, ".ts")),
              ),
            )
          : null;
        const bindings = node.importClause.namedBindings;
        if (bindings && ts.isNamedImports(bindings))
          for (const binding of bindings.elements)
            if (!binding.isTypeOnly)
              result.set(binding.name.text, {
                target,
                spec,
                symbol: (binding.propertyName ?? binding.name).text,
              });
        if (node.importClause.name)
          result.set(node.importClause.name.text, {
            target,
            spec,
            symbol: "default",
          });
      }
    }
    symbolMaps.set(file, result);
    return result;
  }
  function dependencies(handlers) {
    const result = {
      tables: [],
      rpc: [],
      node: [],
      external: [],
      modules: [],
      evidence: [],
    };
    const seen = new Set();
    function visit(file, node) {
      const id = `${file}:${node.pos}:${node.end}`;
      if (seen.has(id)) return;
      seen.add(id);
      result.modules.push(file);
      result.evidence.push(
        evidence(
          file,
          node,
          "reachable static symbol/branch dependency; conditional execution may vary",
        ),
      );
      walk(node, (child) => {
        if (
          ts.isCallExpression(child) &&
          ts.isPropertyAccessExpression(child.expression) &&
          ["from", "rpc"].includes(child.expression.name.text)
        ) {
          let argument = child.arguments[0];
          if (argument && ts.isIdentifier(argument))
            argument = symbols(file).get(argument.text)?.node ?? argument;
          if (argument && ts.isStringLiteral(argument))
            result[
              child.expression.name.text === "rpc" ? "rpc" : "tables"
            ].push(argument.text);
        }
        if (
          (ts.isStringLiteral(child) ||
            ts.isNoSubstitutionTemplateLiteral(child) ||
            ts.isTemplateHead(child)) &&
          /^https:\/\//.test(child.text) &&
          /googleapis|accounts\.google|pesepay/.test(child.text)
        )
          result.external.push(child.text);
        if (!ts.isIdentifier(child)) return;
        const binding = symbols(file).get(child.text);
        if (!binding) return;
        if (binding.node) visit(file, binding.node);
        else if (binding.target && sources.has(binding.target)) {
          const definition = symbols(binding.target).get(binding.symbol);
          if (definition?.node) visit(binding.target, definition.node);
        } else if (
          binding.spec?.startsWith("node:") ||
          ["web-push", "pdf-parse", "exceljs"].includes(binding.spec)
        )
          result.node.push(binding.spec);
      });
    }
    for (const handler of handlers) visit(handler.file, handler.body);
    for (const field of ["tables", "rpc", "node", "external", "modules"])
      result[field] = [...new Set(result[field])].sort();
    return result;
  }
  let fallbackEvidence;
  walk(worker.ast, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "unavailable")
      fallbackEvidence = evidence(
        "worker/index.mjs",
        node,
        "503 unavailable response",
      );
  });
  const routes = [];
  for (const item of routeMap.values()) {
    const file = item.handlers[0]?.file;
    const deps = dependencies(item.handlers);
    const prior = history.routes?.find(
      (r) =>
        r.method.split("/").includes(item.method) &&
        canonical(r.path) === canonical(item.path),
    );
    const nativeSpec = workerRoutes.find(
      ([method, path]) =>
        method === item.method && canonical(path) === canonical(item.path),
    );
    let implementation;
    if (nativeSpec)
      for (const [implementationFile, source] of sources) {
        if (
          !implementationFile.startsWith("worker/") &&
          nativeSpec[2] !== "revokeOwnedFeedSubscription"
        )
          continue;
        walk(source.ast, (node) => {
          if (
            ts.isFunctionDeclaration(node) &&
            node.name?.text === nativeSpec[2]
          )
            implementation = evidence(
              implementationFile,
              node,
              "worker implementation",
            );
          if (
            implementationFile === "worker/index.mjs" &&
            !nativeSpec[2] &&
            ts.isStringLiteral(node) &&
            node.text === item.path
          )
            implementation = evidence(
              "worker/index.mjs",
              node,
              "worker dispatch",
            );
        });
      }
    if (nativeSpec?.[2] && !workerFetchCalls.has(nativeSpec[2]))
      implementation = undefined;
    if (
      ["/api/admin/my/timetables", "/api/admin/institutions"].includes(
        item.path,
      ) &&
      !worker.text.includes(`"${item.path}"`)
    )
      implementation = undefined;
    const upload = item.path === "/api/edge/source-documents";
    const partialSubscription =
      item.path === "/api/calendar/subscriptions" &&
      Boolean(implementation) &&
      !workerFetchCalls.has("handleGoogleCalendarRequest");
    const partialGoogleDisconnect =
      item.path === "/api/calendar/google/disconnect" &&
      Boolean(implementation);
    const disabled =
      item.path === "/api/calendar/google/status" &&
      Boolean(implementation) &&
      worker.text.includes("enabled: false");
    const native =
      Boolean(implementation) &&
      !upload &&
      !partialSubscription &&
      !partialGoogleDisconnect;
    const cloudflareStatus =
      upload || partialSubscription || partialGoogleDisconnect
        ? "native-incomplete"
        : native
          ? "native-not-live-proven"
          : bridge
            ? "bridged"
            : unavailable
              ? "unavailable"
              : "not-migrated";
    let authPolicy = "public; request validation required";
    if (item.path.startsWith("/api/admin/"))
      authPolicy = /\/staff(?:\/|$)/.test(item.path)
        ? "Supabase bearer; requireStaffManager; founder boundaries enforced by staff service"
        : /\/(corrections|exceptions|pauses)(?:\/|$)/.test(item.path)
          ? "Supabase bearer; requireTimetableEditor scoped to assigned timetable"
          : item.path.endsWith("public-settings")
            ? "Supabase bearer; requireFounderSuperadmin"
            : /\/(session|my\/timetables)$/.test(item.path)
              ? "Supabase bearer; requireStaffUser"
              : "Supabase bearer; requireOperationalAdmin";
    else if (item.path.includes("/calendar/feed/"))
      authPolicy = "private bearer feed token hashed for subscription lookup";
    else if (item.path.includes("/calendar/download/"))
      authPolicy =
        "private subscription identifier possession (existing Node contract)";
    else if (item.path.includes("source-snapshots"))
      authPolicy =
        "relay service secret; signed intake validation (sourceSnapshotApi)";
    else if (upload) authPolicy = "service bearer secret; processing disabled";
    else if (item.path.endsWith("google/config-status"))
      authPolicy =
        "x-admin-key equals GOOGLE_CONFIG_STATUS_ADMIN_KEY in production; development diagnostic access";
    else if (item.path.endsWith("google/callback"))
      authPolicy =
        "public OAuth callback; stored state validation and subscription connection ownership";
    else if (item.path.endsWith("google/status"))
      authPolicy = "public provider capability status";
    else if (/google|revoke|delete-request/.test(item.path))
      authPolicy =
        "existing subscription/session ownership or OAuth state; consult dispatch evidence";
    else if (item.path.includes("pesepay/result"))
      authPolicy = "provider callback validation/reconciliation";
    if (nativeSpec?.[2] === "handleNativeStaffInvitation")
      authPolicy =
        item.method === "GET"
          ? "Supabase bearer; requireStaffManager; active Admin or founder staff reads"
          : "Supabase bearer; requireFounderSuperadmin; non-founder Admin invitation only";
    const calls = [...new Set(item.handlers.flatMap((h) => h.calls))].filter(
      (name) =>
        !/^(send|read|parse|decode|encode|String|Number|Boolean)/.test(name),
    );
    const contractTests = tests
      .filter(
        (test) =>
          item.handlers.some((h) =>
            test.text.includes(
              `/${h.file.split("/").pop().replace(/\.ts$/, ".")}`,
            ),
          ) || test.text.includes(item.path.split("/:")[0]),
      )
      .map((test) => test.file);
    if (nativeSpec)
      contractTests.push("tests/cloudflareRuntimeFoundation.test.ts");
    const backgroundDependencies = [];
    if (deps.modules.some((m) => /googleCalendarSync/.test(m)))
      backgroundDependencies.push(
        "Google reconciliation service; native Worker Queue/outbox implemented, migration and live provider acceptance pending",
      );
    if (deps.modules.some((m) => /sourceProcessing/.test(m)))
      backgroundDependencies.push(
        "Node source processing worker; durable parse/review parity required",
      );
    if (/push/.test(item.path))
      backgroundDependencies.push(
        "push delivery jobs; Node pushNotificationWorker",
      );
    if (item.path.includes("/calendar/feed/"))
      backgroundDependencies.push("feed analytics; Worker waitUntil");
    if (upload)
      backgroundDependencies.push(
        "SOURCE_BUCKET",
        "SOURCE_PROCESSING_QUEUE; complete parser/review workflow absent",
      );
    let remainingBlocker = native
      ? "No candidate live proof. Bindings are independently inventoried in DR-178_EVIDENCE.md; trusted reviewed deployment and authorized exact-candidate acceptance remain required."
      : upload
        ? "Disabled503 until real parse-to-review persistence, retries and dead-letter handling exist; intake acceptance is not native completion."
        : bridge
          ? "Legacy proxy still in source snapshot; native transport/business parity and deployed acceptance required."
          : "Worker 503 EDGE_ROUTE_UNAVAILABLE; implement service parity and prove deployed behavior.";
    if (partialSubscription)
      remainingBlocker =
        "Native feed/download subscription subset exists; google_api is disabled503. Full Node provider parity and candidate live proof pending Supabase secret/configuration and provider restoration.";
    if (partialGoogleDisconnect)
      remainingBlocker =
        "Local disconnect and revocation result reporting implemented; deleteCreatedCalendar:true fails closed503 before mutation until durable provider cleanup is available. Deployed acceptance pending.";
    const editorTransport =
      nativeSpec?.[2] === "handleEditorMutations" ||
      nativeSpec?.[2] === "handleNativeAcademicPauses";
    if (editorTransport) {
      contractTests.push(
        nativeSpec[2] === "handleEditorMutations"
          ? "tests/nativeEditorMutations.test.ts"
          : "tests/nativeAcademicPauses.test.ts",
      );
      remainingBlocker =
        "Native editor/pause transport reuses existing services with request bindings. Authenticated deployed acceptance pending. Google delivery requires additive durable-revision migration, original credential bindings and enabled Queue recovery; remote provider acceptance is not established.";
    }
    if (nativeSpec?.[2] === "handleNativeStaffInvitation") {
      contractTests.push("tests/nativeStaffInvitations.test.ts");
      remainingBlocker =
        item.method === "GET"
          ? "Native staff-manager read reuses existing staff listing and assignment projection. Source tests cover RBAC, no-store, redaction and no provisioning writes; exact-candidate deployed acceptance pending."
          : "Founder-authorized native invitation reuses existing Supabase Auth enrollment, protected membership and audit. Existing authorized non-founder account granted Admin through deployed c807 UI; separate dedicated-account sign-in and protected reads remain unverified.";
    }
    if (nativeSpec?.[2] === "handleNativeAdminEntities") {
      contractTests.push(
        "tests/nativeAdminEntities.test.ts",
        "tests/nativeAdminEntityAuthorization.test.ts",
        "tests/adminEntityBindings.test.ts",
      );
      remainingBlocker =
        "Native operational-Admin canonical create/update transport reuses existing validation and repository services with explicit request-local bindings. Source tests cover RBAC, origin, bounded JSON, redaction and binding isolation; authenticated isolated-record staging mutation acceptance pending.";
    }
    if (disabled)
      remainingBlocker =
        "Native capability-status response returns enabled:false; no live acceptance. Google authorization/synchronization remains disabled and is not restored.";
    if (
      native &&
      !/public\/timetables|calendar\/|admin\/|ready/.test(item.path)
    )
      remainingBlocker =
        "Deploy and capture exact candidate live response; no current live evidence recorded.";
    routes.push({
      method: item.method,
      path: item.path,
      authPolicy,
      businessOwner:
        file?.replace("server/", "").replace(".ts", "") ?? "Worker runtime",
      applicationService: calls.join(", ") || nativeSpec?.[2] || file,
      databaseDependencies: [
        ...deps.tables.map((table) => `table/storage reference: ${table}`),
        ...deps.rpc.map((rpc) => `RPC: ${rpc}`),
        ...(item.path.endsWith("health/ready")
          ? [
              "Supabase schema compatibility probes; dynamic table names in server/schemaCompatibility.ts",
            ]
          : []),
      ],
      databaseOperations: ["GET", "HEAD"].includes(item.method)
        ? "Read path; transitive dependencies may include analytics/reconciliation writes. Consult source."
        : "Mutation/processing path; conservative transitive tables/RPCs, consult source for transaction boundaries.",
      externalDependencies: [
        ...new Set([
          ...deps.external,
          ...(deps.tables.length ||
          item.path.startsWith("/api/admin/") ||
          item.path.endsWith("health/ready")
            ? ["Supabase PostgreSQL/Auth/REST"]
            : []),
        ]),
      ],
      nodeOnlyDependencies: file
        ? [
            ...new Set([
              "Node IncomingMessage/ServerResponse transport",
              ...deps.node,
            ]),
          ]
        : [],
      backgroundDependencies,
      cloudflareStatus,
      currentFunctionality: upload
        ? "Processing incomplete; valid configured upload fails closed503."
        : partialGoogleDisconnect
          ? "Native local disconnect; optional remote calendar deletion explicitly unavailable."
          : partialSubscription
            ? "Native feed/download creation subset; google_api disabled503; no candidate live proof."
            : disabled
              ? "Google integration disabled; status endpoint returns enabled:false."
              : native
                ? "Native source implementation; not live proven for DR-178 candidate."
                : bridge
                  ? "Legacy bridge; not recovered Cloudflare functionality."
                  : "Unsupported in Worker; explicit service unavailable.",
      migrationImplementation: implementation ?? fallbackEvidence ?? null,
      ...(editorTransport
        ? {
            workerApplicationService:
              nativeSpec[2] === "handleEditorMutations"
                ? "correctionsCore.applyEditorMutation -> existing correction/exception repositories; audit/idempotency preserved"
                : "academicPauseCore scopedInput/previewImpact/createPauseWithImpact/deactivatePauseWithTimetables -> existing academicPauseRepository",
            workerProviderPropagation:
              "Durable Google revision/jobs require migration and enabled Queue consumer; remote synchronization is never inferred from mutation save. Canonical feeds resolve persisted corrections/pauses.",
          }
        : {}),
      ...(disabled
        ? {
            providerIntegrationEnabled: false,
            responseContract: { enabled: false },
            implementationStatus: "native-not-live-proven",
          }
        : {}),
      ...(partialSubscription
        ? {
            implementationStatus: "native transport; provider-dependent parity",
            workerApplicationService:
              "calendarSubscriptionCore.createNativeFeedSubscription -> pilotRepository.createCalendarSubscriptionRecord -> create_calendar_subscription_with_profile RPC",
            providerVariants: [
              {
                selector:
                  "provider != google_api (validated subscriptionRequestSchema)",
                cloudflareStatus: "native-not-live-proven",
                persistence:
                  "Existing create_calendar_subscription_with_profile RPC; no new database of truth",
                lastLiveRuntime: null,
                lastLiveOutcome: "not-run",
                remainingBlocker:
                  "Supabase secret/configuration and deployed acceptance pending",
              },
              {
                selector: "provider == google_api",
                cloudflareStatus: "intentionally-disabled",
                httpStatus: 503,
                errorCode: "GOOGLE_NOT_CONFIGURED",
                persistence:
                  "Rejected before createCalendarSubscriptionRecord; no subscription persisted",
                lastLiveRuntime: null,
                lastLiveOutcome: "not-run",
                remainingBlocker:
                  "Restore Google OAuth/encryption/provider reconciliation before enabling",
              },
            ],
          }
        : {}),
      contractTests: [...new Set(contractTests)].sort(),
      contractTestStatus:
        "Candidate local tests, not execution evidence or proof of route-specific coverage; deployed acceptance pending.",
      lastProvenRuntime: "not-live-proven for current DR-178 candidate",
      lastLiveRuntime: null,
      lastLiveOutcome:
        "not-run; no candidate-specific deployed acceptance evidence supplied",
      remainingBlocker,
      productionCriticality:
        /calendar|public\/timetables|admin\/(session|my|timetables)|health|runtime-config/.test(
          item.path,
        )
          ? "P0"
          : "P1",
      sourceEvidence: [
        ...item.sourceEvidence,
        ...(partialSubscription
          ? [...sources].flatMap(([sourceFile, source]) => {
              const matches = [];
              if (
                [
                  "server/calendarSubscriptionCore.ts",
                  "server/pilotRepository.ts",
                ].includes(sourceFile)
              )
                walk(source.ast, (node) => {
                  if (
                    ts.isFunctionDeclaration(node) &&
                    [
                      "createNativeFeedSubscription",
                      "createCalendarSubscriptionRecord",
                    ].includes(node.name?.text)
                  )
                    matches.push(
                      evidence(
                        sourceFile,
                        node,
                        "native subscription service / pre-persistence Google gate / existing RPC",
                      ),
                    );
                });
              return matches;
            })
          : []),
        ...(implementation
          ? [implementation]
          : fallbackEvidence
            ? [fallbackEvidence]
            : []),
      ],
      dependencyEvidence: [
        ...new Map(
          deps.evidence.sort((a, b) => a.line - b.line).map((e) => [e.file, e]),
        ).values(),
      ].sort((a, b) => a.file.localeCompare(b.file)),
      ...(prior
        ? { historicalMetadata: prior.historicalMetadata ?? prior }
        : {}),
    });
  }
  routes.sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
  const counts = {
    httpRoutes: routes.length,
    nodeDispatchRoutes: routes.filter((r) =>
      r.sourceEvidence.some((e) => e.file.startsWith("server/")),
    ).length,
    nativeImplementedNotLiveProven: routes.filter(
      (r) => r.cloudflareStatus === "native-not-live-proven",
    ).length,
    nativeLiveProven: 0,
    nativeIncomplete: routes.filter(
      (r) => r.cloudflareStatus === "native-incomplete",
    ).length,
    intentionallyDisabled: routes.filter(
      (r) => r.cloudflareStatus === "intentionally-disabled",
    ).length,
    bridged: routes.filter((r) => r.cloudflareStatus === "bridged").length,
    unavailable: routes.filter((r) =>
      ["unavailable", "not-migrated"].includes(r.cloudflareStatus),
    ).length,
  };
  const vercelText = await readFile(resolve(root, "vercel.json"), "utf8");
  const wranglerText = await readFile(resolve(root, "wrangler.jsonc"), "utf8");
  const routingState = {
    workspaceRoot: ".",
    workerRuntimeBridgePresent:
      bridge || worker.text.includes("LEGACY_BACKEND_ORIGIN"),
    workerConfigBridgePresent: wranglerText.includes("LEGACY_BACKEND_ORIGIN"),
    vercelLegacyRewrites: (JSON.parse(vercelText).rewrites ?? []).filter(
      (entry) => entry.destination?.includes("railway.app"),
    ),
    productionCutover:
      "blocked; existing Vercel routing remains; source inventory is not deployed routing acceptance",
    sourceEvidence: [
      { file: "worker/index.mjs", line: 1 },
      { file: "wrangler.jsonc", line: 1 },
      { file: "vercel.json", line: 1 },
    ],
  };
  return {
    ...Object.fromEntries(
      Object.entries(history).filter(
        ([name]) => !["routes", "legend", "generatedAt"].includes(name),
      ),
    ),
    schemaVersion: 2,
    incident: "DR-178",
    generatedAt: "deterministic source snapshot (sourceSnapshot)",
    historicalInventory: history,
    routingState,
    legend: {
      "native-not-live-proven":
        "Native source implementation; no deployed candidate acceptance. Not a live pass.",
      "native-incomplete":
        "Incomplete business parity/processing; excluded from native counts.",
      "intentionally-disabled":
        "Truthful disabled status; not a restored business capability.",
      unavailable: "Unsupported; 503 EDGE_ROUTE_UNAVAILABLE.",
      bridged: "Legacy proxy; never native success.",
      "not-migrated":
        "No native implementation or verified unavailable fallback.",
    },
    generation: {
      command: "node scripts/generate-cloudflare-route-inventory.mjs",
      scope:
        "Concrete Node API/ICS/health/SEO dispatch plus explicit Worker HTTP routes; static/SPA/redirect/background surfaces excluded from API counts.",
      dependencyPolicy:
        "Conservative transitive import graph; references are not asserted to execute for every request.",
      liveEvidencePolicy:
        "Historical claims retained verbatim, never promoted to current live proof.",
      limitations: [
        "Source fingerprints detect drift, not correctness or production acceptance.",
        "Special negative-guard/ternary/action dispatch uses explicit fingerprinted extraction adapters; review routes when source changes.",
        "Dependencies overapproximate handler imports; auth describes the Node contract, not proof of Worker parity.",
        "Concurrent Worker/repository edits require regeneration after the final snapshot.",
      ],
    },
    sourceSnapshot: Object.fromEntries(
      [
        ...sources,
        ["vercel.json", { text: vercelText }],
        ["wrangler.jsonc", { text: wranglerText }],
      ].map(([file, source]) => [
        file,
        createHash("sha256")
          .update(source.text.replaceAll("\r\n", "\n"))
          .digest("hex"),
      ]),
    ),
    counts,
    routes,
    nonHttpSurfaces: [
      {
        method: "QUEUE",
        path: "PUSH_QUEUE/google_calendar_reconcile",
        cloudflareStatus: "native-not-live-proven",
        remainingBlocker:
          "Tagged per-subscription wakeups, fenced DB leases and bounded provider reconciliation implemented. Requires reviewed delivery migration, original Google secret bindings, ENABLE_GOOGLE_DELIVERY and actual provider acceptance. Other PUSH_QUEUE messages remain unprocessed and retry/DLQ.",
      },
      {
        method: "SCHEDULED",
        path: "Google delivery recovery",
        cloudflareStatus: "native-not-live-proven",
        remainingBlocker:
          "Minute recovery is configured but disabled by default. Recovers durable intent and queues only due bounded jobs; no live Queue/cron proof or Free CPU headroom established.",
      },
      {
        method: "QUEUE",
        path: "SOURCE_PROCESSING_QUEUE",
        cloudflareStatus: "native-incomplete",
        remainingBlocker:
          "Real parse/review persistence, retries and acceptance pending; upload must remain disabled503.",
      },
      {
        method: "SCHEDULED",
        path: "static raw cleanup",
        cloudflareStatus: "not-live-proven",
        remainingBlocker:
          "Cron configuration, cleanup parity and live acceptance pending; see historical inventory.",
      },
    ],
  };
}

function markdownSource(inventory) {
  const c = inventory.counts;
  return `# DR-178 Complete Route Inventory\n\nGenerated from current Node dispatchers and Worker. Machine-readable inventory: [DR-153_ROUTE_INVENTORY.json](./DR-153_ROUTE_INVENTORY.json).\n\n${c.httpRoutes} concrete HTTP method/path entries; ${c.nodeDispatchRoutes} have Node dispatch evidence. ${c.nativeImplementedNotLiveProven} native implementations are not live proven; ${c.nativeIncomplete} native-incomplete entries are excluded from native counts. ${c.bridged} bridged, ${c.unavailable} unavailable/not migrated, ${c.nativeLiveProven} live-proven native successes.\n\nRun \`node scripts/generate-cloudflare-route-inventory.mjs\`, then \`node scripts/check-cloudflare-route-inventory.mjs\`. The checker regenerates in memory and rejects source/inventory drift. Passing proves consistency only.\n\nNative public/ICS/session/admin reads require deployed acceptance with existing Supabase records, SUPABASE_SECRET_KEY (or the existing service-role key), URL and publishable-key bindings. Historical preview/Railway claims remain under historicalInventory/historicalMetadata and are not current live evidence. Unsupported routes must return 503 EDGE_ROUTE_UNAVAILABLE after bridge removal. Source upload stays incomplete/disabled until real processing exists.\n\n## Concrete HTTP Routes\n\n| Method | Path | Status | Source evidence |\n| --- | --- | --- | --- |\n${inventory.routes.map((r) => `| ${r.method} | \`${r.path}\` | ${r.cloudflareStatus} | ${r.sourceEvidence.map((e) => `[${e.file}:${e.line}](../${e.file}#L${e.line})`).join(", ")} |`).join("\n")}\n\n## Evidence And Limitations\n\nThe JSON records auth, business owner/application service, conservative database/RPC, external, Node and background dependencies, candidate contract tests, criticality, source file/line, implementation, last live runtime/outcome and blocker for each entry. Test references do not assert execution or complete coverage.\n\n${inventory.generation.limitations.map((line) => `- ${line}`).join("\n")}\n\nStatic assets, SPA routes, redirects and background consumers never count as concrete API coverage. Historical metadata remains verbatim in JSON. No deployment, live acceptance, secret provisioning or production restoration is claimed.\n`;
}
export async function renderMarkdown(inventory) {
  const source =
    markdownSource(inventory).replace(
      `${inventory.counts.bridged} bridged,`,
      `${inventory.counts.intentionallyDisabled} intentionally disabled, ${inventory.counts.bridged} bridged,`,
    ) +
    "\n## Provider And Routing State\n\nSubscription creation reuses the existing RPC. Google creation and OAuth/single-subscription reconciliation have native source implementations, gated by original OAuth/encryption bindings and durable delivery enablement. Default staging configuration keeps Google delivery disabled pending migration, trusted deployment and provider acceptance; status reflects this. An implemented route does not prove an authorized subscriber received events. Original Apple feed evidence is retained separately in the live evidence ledger.\n\nWorker runtime/config bridge references are recorded separately from existing Vercel legacy rewrites. Production cutover remains blocked. Queue/scheduled implementations and their unproven enablement are listed separately from HTTP coverage. Source processing remains incomplete.\n";
  return prettier.format(source, { parser: "markdown" });
}

export async function renderJson(inventory) {
  return prettier.format(JSON.stringify(inventory), { parser: "json" });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const inventory = await buildInventory(
    JSON.parse(
      await readFile(resolve(root, "docs/DR-153_ROUTE_INVENTORY.json"), "utf8"),
    ),
  );
  await writeFile(
    resolve(root, "docs/DR-153_ROUTE_INVENTORY.json"),
    await renderJson(inventory),
  );
  await writeFile(
    resolve(root, "docs/DR-153_ROUTE_INVENTORY.md"),
    await renderMarkdown(inventory),
  );
  console.log(JSON.stringify(inventory.counts));
}
