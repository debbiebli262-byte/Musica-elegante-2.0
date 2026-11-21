import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

test('Vercel API local ESM imports have explicit extensions', () => {
  const dir = join(process.cwd(), 'api');
  for (const file of readdirSync(dir).filter(file => file.endsWith('.ts'))) {
    const source = readFileSync(join(dir, file), 'utf8');
    const imports = [...source.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)];
    for (const [, specifier] of imports) {
      assert.match(specifier, /\.(?:js|json)$/, file + ': extensionless ESM import ' + specifier);
    }
  }
});
