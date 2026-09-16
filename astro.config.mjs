// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import node from '@astrojs/node';
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://krivy.cyou',
	output: 'server',
	adapter: node({ mode: 'middleware' }),
	// 部署在 Railway 反向代理之后，边缘回源的 Host 与浏览器 Origin 不一致，
	// Astro 默认的 Origin 校验会误判所有 POST 为跨站（403）。
	// CSRF 防护仍由 session cookie 的 sameSite=lax 提供。
	security: {
		checkOrigin: false,
	},
	integrations: [mdx(), sitemap()],
	fonts: [
		{
			provider: fontProviders.local(),
			name: 'Atkinson',
			cssVariable: '--font-atkinson',
			fallbacks: ['sans-serif'],
			options: {
				variants: [
					{
						src: ['./src/assets/fonts/atkinson-regular.woff'],
						weight: 400,
						style: 'normal',
						display: 'swap',
					},
					{
						src: ['./src/assets/fonts/atkinson-bold.woff'],
						weight: 700,
						style: 'normal',
						display: 'swap',
					},
				],
			},
		},
	],
});
