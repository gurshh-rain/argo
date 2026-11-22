export type ProductMedia = {
  kind: 'video' | 'image'
  /** Put assets in web/public/media and use /media/filename, or use a hosted URL. */
  src: string
  alt: string
  poster?: string
  aspectRatio?: string
  fit?: 'contain' | 'cover'
}

// Swap either slot between video and image without changing the page layout.
// ProductMedia can also be rendered elsewhere on the page with the same config.
export const landingMedia: { hero: ProductMedia; workspace: ProductMedia } = {
  hero: {
    kind: 'video',
    src: '',
    alt: 'Argo product animation',
    aspectRatio: '16 / 9',
    fit: 'contain',
  },
  workspace: {
    kind: 'image',
    src: '',
    alt: 'The Argo Mac app workspace',
    aspectRatio: '16 / 10',
    fit: 'contain',
  },
}
