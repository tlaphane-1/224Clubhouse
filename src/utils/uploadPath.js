import { tenant } from '../tenant'

// Storage object path for an admin image upload. A store may set
// images.uploadFolder in tenant.json so its uploads sit under their own folder
// (e.g. "e420/products/…"); 224 has none, so its paths are unchanged
// ("products/…"). The buckets are shared, so this only keeps stores' files
// apart — the storage policies, not the path, decide who may write.
export function uploadPath(kind, fileName) {
  const folder = tenant.images.uploadFolder
  return folder ? `${folder}/${kind}/${fileName}` : `${kind}/${fileName}`
}
