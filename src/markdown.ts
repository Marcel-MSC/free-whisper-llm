/** Tiny markdown → HTML for the webview (no external deps). */
export function renderMarkdown(md: string): string {
  const escaped = escapeHtml(md);
  const withCode = escaped.replace(
    /```(\w+)?\n([\s\S]*?)```/g,
    (_m, lang: string | undefined, code: string) =>
      `<pre class="md-code" data-lang="${lang || ""}"><code>${code}</code></pre>`
  );
  const withInline = withCode.replace(
    /`([^`]+)`/g,
    "<code class=\"md-inline\">$1</code>"
  );
  const withBold = withInline.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  const withItalic = withBold.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  const withHeadings = withItalic.replace(
    /^### (.+)$/gm,
    "<h3 class=\"md-h\">$1</h3>"
  ).replace(/^## (.+)$/gm, "<h2 class=\"md-h\">$1</h2>");
  const withLists = withHeadings.replace(
    /(?:^|\n)(?:- .+(?:\n- .+)*)/g,
    (block) => {
      const items = block
        .trim()
        .split("\n")
        .map((l) => l.replace(/^- /, ""))
        .map((l) => `<li>${l}</li>`)
        .join("");
      return `\n<ul class="md-ul">${items}</ul>`;
    }
  );
  return withLists
    .split(/\n{2,}/)
    .map((p) => {
      if (p.startsWith("<pre") || p.startsWith("<h") || p.startsWith("<ul")) {
        return p;
      }
      return `<p class="md-p">${p.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
