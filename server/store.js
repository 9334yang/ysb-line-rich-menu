import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class Store {
  constructor(directory) { this.directory = directory; this.tail = Promise.resolve(); }
  async read() {
    try { return JSON.parse(await readFile(join(this.directory, 'state.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  async write(state) {
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `state-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, join(this.directory, 'state.json'));
  }
  // One instance with a persistent disk. Serialize the whole operation, including LINE calls.
  exclusive(operation) {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => {});
    return result;
  }
}
