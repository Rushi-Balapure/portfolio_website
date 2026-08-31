import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context: { site?: URL }) {
  const blogs = (await getCollection('blogs'))
    .filter(({ data }) => !data.draft)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  return rss({
    title: 'Rushi Balapure · Blogs',
    description: 'Technical articles, notes, and lessons from the work.',
    site: context.site ?? new URL('https://example.com'),
    items: blogs.map(({ id, data }) => ({
      title: data.title,
      description: data.description ?? data.summary,
      pubDate: data.date,
      link: `/blogs/${id}/`,
      categories: data.tags,
    })),
  });
}
