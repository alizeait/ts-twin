import { execFile } from 'node:child_process';
import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { IGNORED_DIRS, normalizePath, shouldScanFile } from './shared';

const exec = promisify(execFile);

export async function listFiles(
  root: string,
  includeTests = false,
): Promise<string[]> {
  try {
    const result = await exec(
      'git',
      ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard'],
      {
        maxBuffer: 1024 * 1024 * 20,
      },
    );
    return result.stdout
      .split(/\r?\n/u)
      .filter(Boolean)
      .map(normalizePath)
      .filter((file) => shouldScanFile(file, includeTests));
  } catch {
    return walkFiles(root, root, includeTests);
  }
}

async function walkFiles(
  root: string,
  dir: string,
  includeTests: boolean,
  visited: Set<string> = new Set(),
): Promise<string[]> {
  const realDir = await realpath(dir);
  if (visited.has(realDir)) return [];
  visited.add(realDir);

  const files: string[] = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        files.push(
          ...(await walkFiles(
            root,
            path.join(dir, entry.name),
            includeTests,
            visited,
          )),
        );
      }
      continue;
    }

    const file = normalizePath(path.relative(root, path.join(dir, entry.name)));
    if (shouldScanFile(file, includeTests)) files.push(file);
  }

  return files;
}
