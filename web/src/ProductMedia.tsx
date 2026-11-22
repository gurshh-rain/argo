import { useState } from 'react'
import type { ProductMedia as ProductMediaConfig } from './landingMedia'
import { Brand, Icon } from './ui'

export function ProductMedia({ media, caption }: { media: ProductMediaConfig; caption?: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const available = !!media.src && failedSource !== media.src

  return <figure className={`product-media media-${media.kind}`}>
    <div className="product-media-frame" style={{ aspectRatio: media.aspectRatio ?? '16 / 9' }}>
      {available ? media.kind === 'video' ? (
        <video key={media.src} controls playsInline preload="metadata" poster={media.poster} aria-label={media.alt} style={{ objectFit: media.fit ?? 'contain' }} onError={() => setFailedSource(media.src)}>
          <source src={media.src} />
          Your browser does not support video playback. <a href={media.src}>Download the video</a>.
        </video>
      ) : (
        <img src={media.src} alt={media.alt} loading="lazy" decoding="async" style={{ objectFit: media.fit ?? 'contain' }} onError={() => setFailedSource(media.src)} />
      ) : (
        <div className="media-placeholder" role="img" aria-label={`${media.alt} — coming soon`}>
          <Brand />
          <span className="media-placeholder-rule" />
          <p>{media.kind === 'video' ? 'Your crew. In motion.' : 'Everything, in view.'}</p>
          <span className="media-placeholder-note"><Icon name={media.kind === 'video' ? 'play' : 'monitor'} width="15" height="15" />{media.kind === 'video' ? 'Product film coming soon' : 'App preview coming soon'}</span>
        </div>
      )}
    </div>
    {caption && <figcaption>{caption}</figcaption>}
  </figure>
}
