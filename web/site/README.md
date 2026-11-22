# Public website

This standalone build reuses the landing page in `../src` without bundling the Wasp console, server, or database. The existing Wasp app continues to run with `web/dev.sh`.

## Vercel

Import the repository and set **Root Directory** to **web**. The tracked `web/vercel.json` supplies the installation command, build command, and output directory. No backend environment variables are required.

To build locally from `web/`:

```sh
npm --prefix site install --workspaces=false
npm --prefix site run build
```

The deployable static files are in `web/site/dist/`.

## Product media

Place video and image files in `web/public/media/`, then set their `/media/filename` URLs in `web/src/landingMedia.ts`. Each slot supports images or videos, an optional video poster, aspect ratio, and contain/cover fitting. Until assets are supplied, the page shows branded placeholders.
