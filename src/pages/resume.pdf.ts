import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function GET() {
  const resume = await readFile(resolve(process.cwd(), 'assests/Resume.pdf'));

  return new Response(resume, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="Rushi-Balapure-Resume.pdf"',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
