import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

// 服务端 Markdown 渲染统一入口：marked 默认原样输出 HTML，
// 必须经 sanitize-html 白名单净化后再交给页面，防止用户内容里的
// <script> / onerror 等在所有访客（含管理员）浏览器中执行（存储型 XSS）。
const sanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    'img',
    'del',
    'ins',
    'input',
    'details',
    'summary',
  ],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: ['href', 'name', 'target', 'rel', 'title'],
    img: ['src', 'srcset', 'sizes', 'alt', 'title', 'width', 'height', 'loading'],
    code: ['class'],
    pre: ['class'],
    span: ['class'],
    input: ['type', 'checked', 'disabled'],
    th: ['align'],
    td: ['align'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  transformTags: {
    // 外链强制新窗口 + nofollow，防钓鱼/SEO 权重外流
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: 'noopener nofollow' },
    }),
  },
};

export function renderMarkdown(source: string): string {
  const raw = marked.parse(source, { async: false }) as string;
  return sanitizeHtml(raw, sanitizeOptions);
}
