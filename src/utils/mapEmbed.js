// The Maps Embed key ships in the page by nature of an embed, so it lives in
// env (restricted by referrer in Google Cloud) rather than in source. With no
// key the caller omits the map instead of rendering a broken iframe.
export function mapEmbedUrl(key, query) {
  if (!key || !key.trim()) return null
  return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}`
}
