import { readFileSync, writeFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { placementFiles } from '../../../simulator/tools/generate-placement-parity'

vi.mock('node:fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs')>(), writeFileSync: vi.fn(), mkdirSync: vi.fn(),
}))

it('matches the committed Rust parity inputs to the current TypeScript scorer without regenerating them', () => {
  expect(vi.mocked(writeFileSync).mock.calls.length).toBe(0)
  for (const { path, contents } of placementFiles) expect(readFileSync(path, 'utf8'), path).toBe(contents)
})
