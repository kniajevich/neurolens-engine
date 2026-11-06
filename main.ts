import { DOMParser } from "npm:linkedom";
import { Readability } from "npm:@mozilla/readability";
import TurndownService from "npm:turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  hr: "---",
});

// Настройка чистки ненужных элементов
turndown.remove(["script", "style", "noscript", "iframe", "svg"]);

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Извлечение целевого URL
  let targetUrl = url.pathname.slice(1);
  if (url.searchParams.has("url")) {
    targetUrl = url.searchParams.get("url") || "";
  }

  // Декодирование, если пришло закодированным
  try {
    targetUrl = decodeURIComponent(targetUrl);
  } catch (_) {
    // оставляем как есть
  }

  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    return new Response(
      JSON.stringify({ error: "Передайте корректный целевой URL: /https://example.com" }),
      { status: 400, headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders } }
    );
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 NeuroLens-Engine/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });

    if (!response.ok) {
      throw new Error(`Целевой сайт вернул HTTP ${response.status}`);
    }

    const html = await response.text();

    // 1. Парсинг HTML через DOMParser (linkedom)
    const domParser = new DOMParser();
    const doc = domParser.parseFromString(html, "text/html");

    // 2. Извлечение статьи через Mozilla Readability
    const reader = new Readability(doc);
    const article = reader.parse();

    const title = article?.title || doc.title || "Без заголовка";
    const contentHtml = article?.content || doc.body?.innerHTML || "";

    // 3. Конвертация в чистый Markdown
    const markdownBody = turndown.turndown(contentHtml);
    const finalMarkdown = `# ${title}\n\n*Источник: [${targetUrl}](${targetUrl})*\n\n---\n\n${markdownBody}`;

    const rawTokens = Math.ceil(html.length / 4);
    const cleanTokens = Math.ceil(finalMarkdown.length / 4);
    const savedTokens = Math.max(0, rawTokens - cleanTokens);

    const data = {
      title,
      url: targetUrl,
      markdown: finalMarkdown,
      tokens_estimate: cleanTokens,
      tokens_saved: savedTokens,
      engine: "deno-heavy-readability",
    };

    const accept = req.headers.get("Accept") || "";
    const isCurl = (req.headers.get("User-Agent") || "").includes("curl");

    if (accept.includes("text/markdown") || isCurl) {
      return new Response(finalMarkdown, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "X-Engine": data.engine,
          "X-Tokens-Saved": String(data.tokens_saved),
          ...corsHeaders,
        },
      });
    }

    return new Response(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message, engine: "deno-engine-fail" }),
      { status: 502, headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders } }
    );
  }
});
