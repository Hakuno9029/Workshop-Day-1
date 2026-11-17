import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = join(root, 'bundle');
const push = process.argv.includes('--push');

function run(command, args, cwd = root) {
  const isWindowsNpm = process.platform === 'win32' && command === 'npm';
  const result = isWindowsNpm
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${command} ${args.join(' ')}`], {
        cwd,
        stdio: 'inherit',
      })
    : spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function git(args, cwd = root, options = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: options.silent ? 'pipe' : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`git ${args.join(' ')} failed with exit code ${result.status}`);
  }
  return result;
}

function writeBundleFile(name, content) {
  writeFileSync(join(bundleDir, name), content, 'utf8');
}

try {
  run('git', ['submodule', 'update', '--init', '--remote', 'backend', 'frontend', 'cli']);
  run('npm', ['ci'], join(root, 'frontend'));
  run('npm', ['run', 'build'], join(root, 'frontend'));

  const frontendOutput = join(root, 'frontend', 'dist', 'snip-frontend', 'browser');
  const indexFile = join(frontendOutput, 'index.html');
  if (!existsSync(indexFile)) {
    throw new Error(`Frontend build output is missing: ${indexFile}`);
  }
  for (const [source, label] of [
    [join(root, 'backend', 'server.js'), 'backend server'],
    [join(root, 'cli', 'cli.js'), 'CLI'],
  ]) {
    if (!existsSync(source)) throw new Error(`Required ${label} is missing: ${source}`);
  }
  if (!existsSync(join(bundleDir, '.git'))) {
    throw new Error('bundle is not an initialized submodule; run git submodule add -b bundle first.');
  }

  rmSync(join(bundleDir, 'public'), { recursive: true, force: true });
  mkdirSync(bundleDir, { recursive: true });
  cpSync(join(root, 'backend', 'server.js'), join(bundleDir, 'server.js'));
  cpSync(join(root, 'cli', 'cli.js'), join(bundleDir, 'cli.js'));
  cpSync(frontendOutput, join(bundleDir, 'public'), { recursive: true });
  writeBundleFile('.env', 'PUBLIC_DIR=./public\n');
  writeBundleFile('package.json', `${JSON.stringify({
    name: 'snip-bundle',
    private: true,
    scripts: { start: 'bun server.js' },
  }, null, 2)}\n`);
  writeBundleFile('Dockerfile', [
    'FROM oven/bun:1-alpine',
    'WORKDIR /app',
    'COPY . .',
    'ENV PORT=3000',
    'EXPOSE 3000',
    'CMD ["bun", "server.js"]',
    '',
  ].join('\n'));
  writeBundleFile('.dockerignore', [
    '.git',
    '.env.*',
    'node_modules',
    'npm-debug.log*',
    '',
  ].join('\n'));
  writeBundleFile('railway.json', `${JSON.stringify({
    $schema: 'https://railway.app/railway.schema.json',
    build: { builder: 'DOCKERFILE' },
  }, null, 2)}\n`);

  run('git', ['add', '-A'], bundleDir);
  const staged = git(['diff', '--cached', '--quiet'], bundleDir, { allowFailure: true });
  if (staged.status === 1) {
    run('git', ['commit', '-m', 'Build Snip release bundle'], bundleDir);
    git(['add', 'bundle']);
    const pointerDiff = git(['diff', '--cached', '--quiet'], root, { allowFailure: true });
    if (pointerDiff.status === 1) {
      run('git', ['commit', '-m', 'Update generated bundle'], root);
      if (push) {
        run('git', ['push', 'origin', 'HEAD:bundle'], bundleDir);
        run('git', ['push', 'origin', 'main'], root);
      }
    } else if (pointerDiff.status !== 0) {
      throw new Error(`Could not inspect staged bundle pointer (git diff exited ${pointerDiff.status}).`);
    }
    console.log('Bundle updated.');
  } else if (staged.status === 0) {
    console.log('Bundle unchanged.');
  } else {
    throw new Error(`Could not inspect staged bundle changes (git diff exited ${staged.status}).`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
