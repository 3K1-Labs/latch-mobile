import { Glob } from 'bun';

const patterns = [
  'app/**/*.test.{ts,tsx}',
  'app/**/*.spec.{ts,tsx}',
  'hooks/**/*.test.{ts,tsx}',
  'hooks/**/*.spec.{ts,tsx}',
  'src/**/*.test.{ts,tsx}',
  'src/**/*.spec.{ts,tsx}',
];

const testFiles = (
  await Promise.all(
    patterns.map(async (pattern) => {
      const glob = new Glob(pattern);
      const matches: string[] = [];

      for await (const file of glob.scan({ cwd: process.cwd(), onlyFiles: true })) {
        matches.push(file);
      }

      return matches;
    }),
  )
).flat();

if (testFiles.length === 0) {
  console.log('No app test files found.');
  process.exit(0);
}

const testProcess = Bun.spawn(['bun', 'test', ...testFiles], {
  stdout: 'inherit',
  stderr: 'inherit',
});

process.exit(await testProcess.exited);
