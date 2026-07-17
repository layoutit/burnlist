import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { buildSkillMarkdown, FALLBACK_CLI_HELP } from './skill-content.mjs';

const SITE_URL = 'https://burnlist.dev';
const docsDirectory = path.resolve('src/content/docs');
const outputDirectory = path.resolve('dist/docs');
const cliEntrypoint = path.resolve('../bin/burnlist.mjs');

function readCliHelp() {
  try {
    return execFileSync(process.execPath, [cliEntrypoint, '--help'], { encoding: 'utf8' }).trimEnd();
  } catch {
    // Standalone build without the repo-root CLI available (e.g. a published
    // package checkout): fall back to the last-known-accurate help text.
    return FALLBACK_CLI_HELP;
  }
}

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

const header = [
  '# Burnlist',
  '',
  '> A repo-local burndown tracker with a read-only observer dashboard and declarative Ovens. MIT licensed.',
  '',
];
const index = documents.map(({ slug, title }) => `- [${title}](${SITE_URL}/docs/${slug}.md)`);
const footer = ['', '- GitHub: https://github.com/layoutit/burnlist', '- License: MIT', ''];
const skillMarkdown = buildSkillMarkdown({ documents, siteUrl: SITE_URL, cliHelp: readCliHelp() });

// Atomic publish: stage the complete output in a sibling temp dir, then rename
// each artifact into place so a reader never observes a partial file or tree.
const distDirectory = path.resolve('dist');
const stagingDirectory = path.join(distDirectory, `.llms-staging-${process.pid}`);
await rm(stagingDirectory, { recursive: true, force: true });
await mkdir(stagingDirectory, { recursive: true });

try {
  const stagedDocs = path.join(stagingDirectory, 'docs');
  await Promise.all(
    documents.map(async ({ slug, source }) => {
      const destination = path.join(stagedDocs, `${slug}.md`);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(source, destination);
    }),
  );

  await writeFile(path.join(stagingDirectory, 'llms.txt'), [...header, ...index, ...footer].join('\n'));
  await writeFile(
    path.join(stagingDirectory, 'llms-full.txt'),
    [...header, ...documents.flatMap(({ title, body }) => [`## ${title}`, '', body.trim(), '']), ...footer].join('\n'),
  );
  await writeFile(path.join(stagingDirectory, 'skill.md'), skillMarkdown);

  await rm(outputDirectory, { recursive: true, force: true });
  await rename(stagedDocs, outputDirectory);
  await rename(path.join(stagingDirectory, 'llms.txt'), path.join(distDirectory, 'llms.txt'));
  await rename(path.join(stagingDirectory, 'llms-full.txt'), path.join(distDirectory, 'llms-full.txt'));
  await rename(path.join(stagingDirectory, 'skill.md'), path.join(distDirectory, 'skill.md'));
} finally {
  await rm(stagingDirectory, { recursive: true, force: true });
}

console.log(`Generated llms.txt, llms-full.txt, skill.md, and ${documents.length} documentation file(s).`);
