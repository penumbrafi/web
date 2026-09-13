import bundleAnalyzer from '@next/bundle-analyzer';
import { execSync } from 'child_process';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

// Look up the specific git commit for the app, to include in the footer.
const getCommitInfo = () => {
  try {
    const commitHash = execSync('git rev-parse HEAD').toString().trim();
    const commitDate = execSync('git log -1 --format=%cI').toString().trim();
    let gitOriginUrl = execSync('git remote get-url origin')
      .toString()
      .trim()
      .replace(/\.git$/, '');

    if (gitOriginUrl.startsWith('git@github.com:')) {
      gitOriginUrl = gitOriginUrl.replace('git@github.com:', 'https://github.com/');
    }

    return {
      COMMIT_HASH: commitHash,
      COMMIT_DATE: commitDate,
      GIT_ORIGIN_URL: gitOriginUrl,
    };
  } catch (error) {
    const errorMessage = `Failed to get git commit info for version footer. This is likely because:
1. Git is not installed in the container
2. The .git directory is not available (missing from Docker context)
3. The git repository is not properly initialized
4. Permission issues accessing git commands

Original error: ${error.message}

To fix this in production containers, ensure:
- Git is installed in the container
- The .git directory is included in the Docker build context
- The container has proper permissions to run git commands`;

    console.error(errorMessage);
    throw new Error(errorMessage);
  }
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: getCommitInfo(),
  serverExternalPackages: ['pino-pretty'],
  experimental: {
    optimizePackageImports: [
      '@penumbra-zone/ui',
      'chain-registry',
      'osmo-query',
      'cosmos-kit',
      'recharts',
      'lucide-react',
      '@radix-ui/react-icons',
      'date-fns',
      'dayjs',
    ],
    serverComponentsHmrCache: true,
  },
  turbopack: {
    resolveAlias: {
      '@amplitude/analytics-browser': '@repo/stubs/amplitude-analytics-browser',
    },
    rules: {
      // SVGs load as React components via @svgr/webpack. Options mirror
      // the previous webpack config: SVGO disabled entirely (project
      // ships pre-optimized icons), viewBox preserved by preset-default
      // overrides.
      '*.svg': {
        loaders: [
          {
            loader: '@svgr/webpack',
            options: {
              svgo: false,
              svgoConfig: {
                plugins: [
                  {
                    name: 'preset-default',
                    params: { overrides: { removeViewBox: false } },
                  },
                ],
              },
            },
          },
        ],
        as: '*.js',
      },
    },
  },
  // Turbopack is the default bundler in Next 16 — SVG handling and the
  // amplitude alias live in the `turbopack.rules` / `turbopack.resolveAlias`
  // blocks above. WASM is handled natively. The `pino-pretty` external is
  // covered by top-level `serverExternalPackages`.
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  logging: {
    incomingRequests: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
        port: '',
        pathname: '/cosmos/chain-registry/master/**',
        search: '',
      },
    ],
  },
};

export default withBundleAnalyzer(nextConfig);
