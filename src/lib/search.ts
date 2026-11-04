import { searchQueries } from './db';

// 站内搜索的统一入口。
// 原来 /api/search 和 /pages/search.astro 各自拼一遍 SQL 和 FTS 清洗逻辑，
// 现在收在一处：FTS5 先查，结果不够再用 LIKE 兜底，最后合并去重。
//
// 为什么需要兜底：FTS5 默认的 unicode61 分词器把连续汉字当成一个整体 token，
// 「数通学习全流程」里搜「学习」「流程」都命中不了（只有词首前缀能中）。
// 本站文章量小，LIKE 全表扫描的代价可以忽略。

export interface SearchHit {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  created_at: number;
  author_name: string;
  /** 已经可以安全 set:html 的 HTML 片段：内容已转义，仅保留 <mark> 高亮 */
  preview: string;
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// FTS 的 snippet() 会在正文片段里插 <mark>，而正文本身是用户可控内容。
// 直接 set:html 等于把正文里的 <img onerror=...> 原样执行——
// 所以先整体转义，再只把 <mark> / </mark> 还原回来（见 cleanSnippet）。
const MARK_OPEN = '\u0000O\u0000';
const MARK_CLOSE = '\u0000C\u0000';

/** 把 Markdown 正文压成一行纯文本，摘要里不该出现 ## 和 ** */
function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[*_]{1,2}([^*_\s][^*_]*)[*_]{1,2}/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 清洗并转义 FTS snippet：保留高亮标记，去掉 Markdown 语法 */
function cleanSnippet(raw: string): string {
  const guarded = raw.replace(/<mark>/g, MARK_OPEN).replace(/<\/mark>/g, MARK_CLOSE);
  return escapeHtml(plainText(guarded))
    .replace(/\u0000O\u0000/g, '<mark>')
    .replace(/\u0000C\u0000/g, '</mark>')
    .replace(/\u0000/g, '');
}

/** 清洗 FTS5 运算符，只保留普通文本，避免把用户输入当查询语法执行 */
export function sanitizeQuery(raw: string): string {
  return raw
    .replace(/["'*:()\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 把关键词拆成词项（LIKE 兜底用它做二次过滤） */
function splitTerms(safeQ: string): string[] {
  return safeQ.split(' ').map((t) => t.trim()).filter(Boolean).slice(0, 5);
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

/** 取命中位置前后各一小段，当作 LIKE 结果的摘要 */
function snippetAround(text: string, term: string, radius = 50): string {
  const plain = plainText(text);
  const idx = plain.toLowerCase().indexOf(term.toLowerCase());
  if (idx < 0) return plain.slice(0, 120);
  const start = Math.max(0, idx - radius);
  const end = Math.min(plain.length, idx + term.length + radius);
  return `${start > 0 ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`;
}

/** 转义 + 用 <mark> 高亮所有词项（LIKE 结果没有 snippet，自己标） */
export function highlightText(text: string, terms: string[]): string {
  if (!terms.length) return escapeHtml(text);
  const lower = text.toLowerCase();
  let out = '';
  let i = 0;
  for (;;) {
    // 找最近的一个词项，避免多个词互相覆盖
    let hitIdx = -1;
    let hitTerm = '';
    for (const t of terms) {
      const j = lower.indexOf(t.toLowerCase(), i);
      if (j >= 0 && (hitIdx < 0 || j < hitIdx)) {
        hitIdx = j;
        hitTerm = t;
      }
    }
    if (hitIdx < 0) {
      out += escapeHtml(text.slice(i));
      break;
    }
    out += escapeHtml(text.slice(i, hitIdx));
    out += `<mark>${escapeHtml(text.slice(hitIdx, hitIdx + hitTerm.length))}</mark>`;
    i = hitIdx + hitTerm.length;
  }
  return out;
}

/**
 * 站内搜索：FTS5 优先，不足时用 LIKE 补齐并去重。
 * @param safeQ 已过 sanitizeQuery 的查询串
 */
export function searchPosts(safeQ: string, limit = 10): SearchHit[] {
  if (!safeQ) return [];
  const terms = splitTerms(safeQ);
  if (!terms.length) return [];

  const hits: SearchHit[] = [];
  const seen = new Set<number>();

  const push = (row: any, preview: string) => {
    if (seen.has(row.id) || hits.length >= limit) return;
    seen.add(row.id);
    hits.push({
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description ?? '',
      created_at: row.created_at,
      author_name: row.author_name,
      preview,
    });
  };

  // 1) 全文索引（前缀匹配）
  try {
    for (const row of searchQueries.search.all(`${safeQ}*`) as any[]) {
      push(row, cleanSnippet(row.preview || row.description || ''));
    }
  } catch {
    // FTS 查询语法异常（例如纯符号）时静默降级到 LIKE
  }

  if (hits.length >= limit) return hits;

  // 2) 中文子串兜底：用最长的词项做 LIKE（选择性最高），
  //    再在 JS 里要求所有词项都出现，等价于 AND 语义。
  const likeTerm = [...terms].sort((a, b) => b.length - a.length)[0];
  const pattern = `%${escapeLike(likeTerm)}%`;
  try {
    const rows = searchQueries.searchLike.all(pattern, pattern, pattern, pattern) as any[];
    for (const row of rows) {
      const haystack = `${row.title}\n${row.description || ''}\n${row.preview || ''}`.toLowerCase();
      if (!terms.every((t) => haystack.includes(t.toLowerCase()))) continue;
      // 标题就命中的，优先用 description 当摘要（它本来就是一句话概括）；
      // 否则从正文里截命中上下文。
      const titleHit = String(row.title).toLowerCase().includes(likeTerm.toLowerCase());
      const source = String(titleHit && row.description ? row.description : row.preview || row.description || '');
      push(row, highlightText(snippetAround(source, likeTerm), terms));
    }
  } catch {
    // LIKE 失败不影响已经拿到的 FTS 结果
  }

  return hits;
}
