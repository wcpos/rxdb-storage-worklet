import assert from 'node:assert/strict';
import { fillWithDefaultSettings } from '../../plugins/core/index.mjs';
import { WORKLET_STORAGE } from './worklet-opfs-storage.js';

describe('worklet public channel', () => {
  it('round trips all binary byte values without fetch', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = undefined as any;
    const storage = WORKLET_STORAGE.getStorage();
    assert.equal(storage.name, 'remote');
    const instance = await storage.createStorageInstance({
      databaseInstanceToken: 'binary-channel', databaseName: 'binary-channel', collectionName: 'binary',
      schema: fillWithDefaultSettings({ version: 0, primaryKey: 'id', type: 'object', properties: { id: { type: 'string', maxLength: 100 } }, required: ['id'], attachments: {} }),
      options: {}, multiInstance: false, devMode: true,
    });
    try {
      const bytes = Uint8Array.from({ length: 32768 }, (_, index) => index % 256);
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const document = { id: 'binary', _rev: '1-binary', _deleted: false, _meta: { lwt: Date.now() }, _attachments: { binary: { data: blob, length: blob.size, type: blob.type, digest: 'binary-digest' } } };
      assert.deepEqual((await instance.bulkWrite([{ document }], 'binary')).error, []);
      const read = await instance.getAttachmentData('binary', 'binary', 'binary-digest');
      assert.deepEqual(new Uint8Array(await read.arrayBuffer()), bytes);
    } finally { await instance.remove(); globalThis.fetch = original; }
  });
});
