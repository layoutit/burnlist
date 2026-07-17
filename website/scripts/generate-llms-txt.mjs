import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SITE_URL = 'https://burnlist.dev';
const docsDirectory = path.resolve('src/content/docs');
const outputDirectory = path.resolve('dist/docs');

async function walkDir(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? walkDir(entryPath) : [entryPath];
    }),
  );
  return files.flat();
}

function extractFrontmatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { title: undefined, body: source };
  const title = match[1].match(/^title:\s*['"]?(.+?)['"]?\s*$/m)?.[1];
  return { title, body: source.slice(match[0].length) };
}

function getSlug(file) {
  return path
    .relative(docsDirectory, file)
    .replace(/\.(md|mdx)$/, '')
    .split(path.sep)
    .join('/');
}

const files = (await walkDir(docsDirectory)).filter((file) => /\.mdx?$/.test(file));
const documents = await Promise.all(
  files.map(async (file) => {
    const source = await readFile(file, 'utf8');
    const { title, body } = extractFrontmatter(source);
    return { slug: getSlug(file), title: title ?? getSlug(file), body, source: file };
  }),
);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await Promise.all(
  documents.map(async ({ slug, source }) => {
    const destination = path.join(outputDirectory, `${slug}.md`);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination);
  }),
);

const header = [
  '# Burnlist',
  '',
  '> A repo-local burndown tracker and multi-agent build-loop runner. MIT licensed.',
  '',
];
const index = documents.map(({ slug, title }) => `- [${title}](${SITE_URL}/docs/${slug}.md)`);
const footer = ['', '- GitHub: https://github.com/layoutit/burnlist', '- License: MIT', ''];

await writeFile(path.resolve('dist/llms.txt'), [...header, ...index, ...footer].join('\n'));
await writeFile(
  path.resolve('dist/llms-full.txt'),
  [...header, ...documents.flatMap(({ title, body }) => [`## ${title}`, '', body.trim(), '']), ...footer].join('\n'),
);

console.log(`Generated llms.txt, llms-full.txt, and ${documents.length} documentation file(s).`);
