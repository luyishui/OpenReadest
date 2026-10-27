import withSerwistInit from '@serwist/next';
import withBundleAnalyzer from '@next/bundle-analyzer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isDev = process.env['NODE_ENV'] === 'development';
const appPlatform = process.env['NEXT_PUBLIC_APP_PLATFORM'];
const tursoGuestJs = './src-tauri/plugins/tauri-plugin-turso/guest-js/index.ts';
const tursoGuestJsAbs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), tursoGuestJs);

if (isDev) {
  const { initOpenNextCloudflareForDev } = await import('@opennextjs/cloudflare');
  initOpenNextCloudflareForDev();
}

const exportOutput = appPlatform !== 'web' && !isDev;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ensure Next.js uses SSG instead of SSR
  // https://nextjs.org/docs/pages/building-your-application/deploying/static-exports
  output: exportOutput ? 'export' : undefined,
  pageExtensions: exportOutput ? ['jsx', 'tsx'] : ['js', 'jsx', 'ts', 'tsx'],
  // Note: This feature is required to use the Next.js Image component in SSG mode.
  // See https://nextjs.org/docs/messages/export-image-api for different workarounds.
  images: {
    unoptimized: true,
  },
  devIndicators: false,
  // Configure assetPrefix or else the server won't properly resolve your assets.
  assetPrefix: '',
  reactStrictMode: true,
  serverExternalPackages: ['isows'],
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      // tauri-plugin-turso guest bindings are consumed from source (same path as tsconfig).
      'tauri-plugin-turso': tursoGuestJsAbs,
      // Tauri builds use the native turso plugin; keep the WASM engine out of the bundle.
      ...(appPlatform !== 'web' ? { '@tursodatabase/database-wasm': false } : {}),
      // The WASM connector is browser-only; never bundle it into the web server build.
      ...(isServer && appPlatform === 'web' ? { '@readest/turso-database-wasm/webpack': false } : {}),
    };
    return config;
  },
  turbopack: {
    resolveAlias: {
      'tauri-plugin-turso': tursoGuestJs,
      ...(appPlatform !== 'web' ? { '@tursodatabase/database-wasm': './src/utils/stub.ts' } : {}),
    },
  },
  transpilePackages: !isDev
    ? [
        'i18next-browser-languagedetector',
        'react-i18next',
        'i18next',
        '@tauri-apps',
        'highlight.js',
        'foliate-js',
        'marked',
        'js-mdict',
      ]
    : ['js-mdict'],
  async headers() {
    return [
      {
        source: '/.well-known/apple-app-site-association',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/json',
          },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: isDev
              ? 'public, max-age=0, must-revalidate'
              : 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};

const pwaDisabled = isDev || appPlatform !== 'web';

const withPWA = pwaDisabled
  ? (config) => config
  : withSerwistInit({
      swSrc: 'src/sw.ts',
      swDest: 'public/sw.js',
      cacheOnNavigation: true,
      reloadOnOnline: true,
      disable: false,
      register: true,
      scope: '/',
    });

const withAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

export default withPWA(withAnalyzer(nextConfig));
