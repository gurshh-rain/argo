export type ProductMedia = {
  kind: 'video' | 'image'
  /** Put assets in web/public/media and use /media/filename, or use a hosted URL. */
  src: string
  alt: string
  poster?: string
  aspectRatio?: string
  fit?: 'contain' | 'cover'
}

// ProductMedia can be moved elsewhere on the page with the same config.
export const landingMedia: { hero: ProductMedia } = {
  hero: {
    kind: 'video',
    src: '/media/argo.mp4',
    alt: 'Argo product animation',
    aspectRatio: '16 / 9',
    fit: 'contain',
  },
}
