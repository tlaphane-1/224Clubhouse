/**
 * Live-DB contract test for 20261109120000_store_image_folders.
 *
 * A store with an upload folder (tenants.upload_folder) may only upload to and
 * delete from that folder in product-images / event-images; a store without
 * one may use the buckets anywhere except another store's folder only if it is
 * 224 (default_tenant()); any other store without a folder may use nothing.
 *
 *   POSITIVE — each store's admin uploads inside its own area.
 *   NEGATIVE — each store's admin cannot upload into, or delete from, the
 *              other store's area (a refused delete removes nothing).
 *
 * Uses the vitest-b test store, given the folder `vitest-b-uploads` here.
 *
 *   npm run test:local -- src/__tests__/storeImageFolders.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  anonClient, serviceClient, probeMigration, describeGate, createTestUser,
  createTenantUser, signInAs, signInClient, deleteTestUsers, mustSucceed,
  ensureTestTenant, TEST_TENANT, TEST_PASSWORD, RUN_TAG,
} from './helpers/liveFixtures.js'

const gate = await probeMigration({
  migration: '20261109120000_store_image_folders',
  label: 'tenants.upload_folder',
  probe: async () => serviceClient().from('tenants').select('upload_folder').limit(1),
})
const SKIP = !gate.applied

const FOLDER = 'vitest-b-uploads'
const PNG = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' })
const BUCKETS = ['product-images', 'event-images']
const otherPath = `${FOLDER}/products/vitest-${RUN_TAG}.png`
const mainPath = `products/vitest-${RUN_TAG}.png`

const admin = SKIP ? null : serviceClient()
let mainAdminUser, otherAdminUser, mainAdmin, otherAdmin

describe.skipIf(SKIP)('Store image folders contract', () => {
  beforeAll(async () => {
    await ensureTestTenant(admin)
    mustSucceed('test store folder', await admin.from('tenants')
      .update({ upload_folder: FOLDER }).eq('slug', TEST_TENANT))

    mainAdminUser = await createTestUser(admin, 'images-224-admin')
    mustSucceed('224 admin', await admin.from('admin_users')
      .insert({ id: mainAdminUser.id, email: mainAdminUser.email }))
    mainAdmin = anonClient()
    await signInAs(mainAdmin, mainAdminUser.email)

    otherAdminUser = await createTenantUser(admin, 'images-b-admin', TEST_TENANT)
    mustSucceed('vitest-b admin', await admin.from('admin_users')
      .insert({ id: otherAdminUser.id, email: otherAdminUser.email, tenant: TEST_TENANT }))
    otherAdmin = await signInClient(otherAdminUser.email, TEST_PASSWORD)
  })

  afterAll(async () => {
    if (!admin) return
    for (const bucket of BUCKETS) await admin.storage.from(bucket).remove([otherPath, mainPath])
    await deleteTestUsers(admin, mainAdminUser?.id, otherAdminUser?.id)
  })

  for (const bucket of BUCKETS) {
    it(`POSITIVE: each store's admin uploads to its own area of ${bucket}`, async () => {
      mustSucceed('224 upload', await mainAdmin.storage.from(bucket).upload(mainPath, PNG))
      mustSucceed('vitest-b upload', await otherAdmin.storage.from(bucket).upload(otherPath, PNG))
    })

    it(`NEGATIVE: neither store's admin can upload into the other's area of ${bucket}`, async () => {
      const intoOther = await mainAdmin.storage.from(bucket).upload(`${FOLDER}/products/x-${RUN_TAG}.png`, PNG)
      expect(intoOther.error).toBeTruthy()
      const intoMain = await otherAdmin.storage.from(bucket).upload(`products/x-${RUN_TAG}.png`, PNG)
      expect(intoMain.error).toBeTruthy()
    })

    it(`NEGATIVE: neither store's admin can delete the other's ${bucket} files`, async () => {
      await mainAdmin.storage.from(bucket).remove([otherPath])
      await otherAdmin.storage.from(bucket).remove([mainPath])
      const [folder, ...rest] = otherPath.split('/')
      const otherLeft = await admin.storage.from(bucket).list(`${folder}/${rest[0]}`, { search: rest[1] })
      expect((otherLeft.data ?? []).map(f => f.name)).toContain(rest[1])
      const mainLeft = await admin.storage.from(bucket).list('products', { search: mainPath.split('/')[1] })
      expect((mainLeft.data ?? []).map(f => f.name)).toContain(mainPath.split('/')[1])
    })
  }

  it('NEGATIVE: a store other than 224 with no folder cannot upload anywhere', async () => {
    mustSucceed('clear test store folder', await admin.from('tenants')
      .update({ upload_folder: null }).eq('slug', TEST_TENANT))
    try {
      for (const bucket of BUCKETS) {
        const atRoot = await otherAdmin.storage.from(bucket).upload(`products/nofolder-${RUN_TAG}.png`, PNG)
        expect(atRoot.error).toBeTruthy()
      }
    } finally {
      mustSucceed('restore test store folder', await admin.from('tenants')
        .update({ upload_folder: FOLDER }).eq('slug', TEST_TENANT))
    }
  })
})

describeGate('Store image folders contract', gate)
