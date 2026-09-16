import rss from '@astrojs/rss';
import { SITE_DESCRIPTION, SITE_TITLE } from '../consts';
import { postQueries } from '../lib/db';

export async function GET(context) {
  const posts = postQueries.findApproved.all();
  return rss({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    site: context.site,
    items: posts.map((post) => ({
      title: post.title,
      description: post.description || '',
      link: `/blog/${post.slug}/`,
      pubDate: new Date(post.created_at),
    })),
  });
}
