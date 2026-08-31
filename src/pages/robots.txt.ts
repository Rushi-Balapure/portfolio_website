export function GET({ site }: { site?: URL }) {
  const origin = site ?? new URL('https://example.com');
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap-index.xml', origin)}\n`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
