import { renderMarkdown } from './markdown';

/**
 * 网安笔记区数据源。
 *
 * 设计取舍：这些文档**不进数据库**，而是以 .md 文件形式放在
 * src/data/security/ 下，构建时由 Vite 的 import.meta.glob 静态收集。
 * 好处是：写文档就是写 Markdown 文件，扔进去 push 一下就上线，
 * 不需要登录后台、不走审核流、也不会污染文章表与标签表。
 *
 * 文件名以 _ 或 . 开头的会被忽略（放模板、草稿、说明都不影响列表）。
 */

export interface SecurityDoc {
  slug: string;
  title: string;
  date: string;
  summary: string;
  category: string;
  tags: string[];
  order?: number;
  file: string;
  body: string;
  html: string;
  minutes: number;
}

interface Frontmatter {
  [key: string]: string | string[];
}

// eager + raw：构建期一次性把全部 Markdown 原文读进来，运行时零 IO
const modules = import.meta.glob('../data/security/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

/** 极简 YAML frontmatter 解析：只支持本项目用到的键值对与 [a, b] 数组 */
function parseFrontmatter(text: string): { data: Frontmatter; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };

  const data: Frontmatter = {};
  for (const rawLine of m[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();

    if (/^\[.*\]$/.test(val)) {
      // tags: [SQL注入, XSS]
      data[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      data[key] = val.replace(/^["']|["']$/g, '');
    }
  }
  return { data, body: text.slice(m[0].length) };
}

function asString(v: string | string[] | undefined, fallback = ''): string {
  if (Array.isArray(v)) return v[0] ?? fallback;
  return v ?? fallback;
}

function asArray(v: string | string[] | undefined): string[] {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

/** 去掉标题里的 Markdown 标记，保证列表页标题干净 */
function stripInlineMd(s: string): string {
  return s
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1');
}

/** 从正文里取第一个 H1 或第一段，作为没写 summary 时的兜底摘要 */
function deriveSummary(body: string): string {
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('#')) {
      const heading = stripInlineMd(t.replace(/^#+\s*/, ''));
      if (heading) return heading;
      continue;
    }
    if (/^\|/.test(t) || /^[-*+]\s/.test(t) || /^```/.test(t)) continue;
    return stripInlineMd(t).slice(0, 90);
  }
  return '';
}

/** 摘掉正文开头的第一个 H1。
 *  详情页头部已经渲染了标题，正文里再留一个 H1 会让一页出现两个 <h1>。
 *  返回摘掉的内容，用于给没写 title 的文档兜底。 */
function stripLeadingH1(body: string): { body: string; heading: string } {
  const m = /^\s*#\s+(.+?)\s*\r?\n/.exec(body);
  if (!m) return { body, heading: '' };
  return {
    body: body.slice(m[0].length).replace(/^\s*\r?\n/, ''),
    heading: stripInlineMd(m[1]),
  };
}

function buildDoc(path: string, raw: string): SecurityDoc | null {
  const file = path.split('/').pop() || path;
  const stem = file.replace(/\.md$/i, '');

  // 下划线开头的文件是模板/草稿，不进列表
  if (stem.startsWith('_') || stem.startsWith('.')) return null;

  const { data, body: fullBody } = parseFrontmatter(raw);
  const { body, heading } = stripLeadingH1(fullBody);

  const html = renderMarkdown(body);
  const text = body.replace(/```[\s\S]*?```/g, '').replace(/[#>*`|\-]/g, '');
  const words = text.replace(/\s/g, '').length;

  const orderRaw = asString(data.order, '');
  const order = orderRaw === '' ? undefined : Number(orderRaw);

  return {
    slug: asString(data.slug, stem),
    title: asString(data.title, '') || heading || stem,
    date: asString(data.date, ''),
    summary: asString(data.summary, '') || deriveSummary(body),
    category: asString(data.category, '未分类'),
    tags: asArray(data.tags),
    order: order !== undefined && Number.isFinite(order) ? order : undefined,
    file,
    body,
    html,
    // 中文按 ~400 字/分钟估算，最少 1 分钟
    minutes: Math.max(1, Math.round(words / 400)),
  };
}

const docs: SecurityDoc[] = Object.entries(modules)
  .map(([path, raw]) => buildDoc(path, raw))
  .filter((d): d is SecurityDoc => d !== null)
  .sort((a, b) => {
    // 有 order 的按 order 升序（课程笔记要 P1→P10，不能按字母排）
    if (a.order !== undefined && b.order !== undefined && a.order !== b.order) {
      return a.order - b.order;
    }
    if (a.order !== undefined && b.order === undefined) return -1;
    if (a.order === undefined && b.order !== undefined) return 1;
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return a.title.localeCompare(b.title, 'zh-CN');
  });

export const securityDocs = docs;

export function findSecurityDoc(slug: string): SecurityDoc | undefined {
  return docs.find((d) => d.slug === slug);
}

/** 分类列表（含每类文档数），按文档数倒序 */
export function securityCategories(): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const d of docs) map.set(d.category, (map.get(d.category) ?? 0) + 1);
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
}

/** 全部标签（去重、含计数） */
export function securityTags(): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const d of docs) for (const t of d.tags) map.set(t, (map.get(t) ?? 0) + 1);
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
}

/** 获取相邻文档，用于详情页上下篇导航 */
export function securityNeighbors(slug: string): {
  prev?: SecurityDoc;
  next?: SecurityDoc;
} {
  const i = docs.findIndex((d) => d.slug === slug);
  if (i < 0) return {};
  return { prev: docs[i - 1], next: docs[i + 1] };
}
