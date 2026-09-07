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
  // The standalone staking page is gone — staking is part of the Explore
  // validators view, where the validator list already lives. A routing-layer
  // redirect (rather than a stub page calling `redirect()`) gives a real 308
  // and forwards the query string automatically, so existing links carrying
  // `?delegate=<bech32 identity>` still open the delegate dialog on arrival.
  async redirects() {
    return [
      {
        source: '/portfolio/staking',
        destination: '/explore/validators',
        permanent: true,
      },
    ];
  },
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
      '*.svg': {
        loaders: ['@svgr/webpack'],
        as: '*.js',
      },
    },
  },
  webpack: config => {
    config.externals.push('pino-pretty');

    config.resolve.alias['@amplitude/analytics-browser'] =
      '@repo/stubs/amplitude-analytics-browser';

    // Make Next.js's default file/asset rule for SVGs ignore them so that
    // the @svgr/webpack rule below is the only handler.
    const fileLoaderRule = config.module.rules.find(
      rule => rule.test instanceof RegExp && rule.test.test('.svg'),
    );
    if (fileLoaderRule) {
      fileLoaderRule.exclude = /\.svg$/i;
    }

    config.module.rules.push({
      test: /\.svg$/i,
      use: [
        {
          loader: '@svgr/webpack',
          options: {
            svgo: false,
            svgoConfig: {
              plugins: [
                {
                  name: 'preset-default',
                  params: {
                    overrides: {
                      removeViewBox: false,
                    },
                  },
                },
              ],
            },
          },
        },
      ],
    });

    // .graphql files are loaded as parsed AST nodes via graphql-tag/loader,
    // so explorer queries/subscriptions can be `import`-ed directly.
    config.module.rules.push({
      test: /\.graphql$/i,
      exclude: /node_modules/,
      loader: 'graphql-tag/loader',
    });

    config.experiments.asyncWebAssembly = true;

    return config;
  },
  output: 'standalone',
  eslint: {
    ignoreDuringBuilds: true,
  },
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
