import type { MetadataRoute } from 'next';

/** Lets sol — desk be installed on a phone's home screen (Safari → Share → Add to Home Screen). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'sol — desk',
    short_name: 'sol',
    description: 'A private planner.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#191919',
    theme_color: '#121212',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
