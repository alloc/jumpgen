import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { jumpgen } from '../src/generator.js'

const cleanup: (() => void)[] = []

function createProject({
  files,
}: {
  files?: Record<string, string>
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpgen-test.'))
  cleanup.push(() => {
    fs.rmSync(root, { recursive: true })
  })
  if (files) {
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(root, name), content)
    }
  }
  return root
}

describe('fs.scan', () => {
  test('adding an empty file', async () => {
    const root = createProject()
    const spy = vi.fn()
    const generate = jumpgen('', ({ fs }) => {
      spy(fs.scan('*'))
    })

    const runner = generate({ root, watch: true })
    cleanup.push(() => runner.destroy())
    await runner

    expect(spy).toHaveBeenCalledTimes(1)

    fs.writeFileSync(path.join(root, 'foo.txt'), '')
    await runner.waitForStart()
    await runner

    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenCalledWith(['foo.txt'])
  })
})

afterAll(() => {
  cleanup.forEach(fn => fn())
})
