import bundleAnalyzer from '@next/bundle-analyzer';
import { execSync } from 'child_process';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

// Look up the specific git commit for the app, to include in the footer.
//
// Precedence: CI-provided `GITHUB_SHA` (the exact commit the workflow
// checked out, guaranteed to exist on the remote) over local
// `git rev-parse HEAD` (which after a `git pull --rebase` can point at
// an orphaned pre-rebase SHA GitHub 404s on). CI also gets
// GITHUB_SERVER_URL + GITHUB_REPOSITORY, which together always resolve
// to a real "…/commit/<sha>" that lands on a real page — no more dead
// footer links on the deployed build.
const getCommitInfo = () => {
  try {
    const ciSha = process.env.GITHUB_SHA?.trim();
    const commitHash = ciSha || execSync('git rev-parse HEAD').toString().trim();

    // Date from CI's SHA if we have it, else local git. `git show -s`
    // reads any object in the local repo, so it works for both.
    let commitDate;
    try {
      commitDate = execSync(`git show -s --format=%cI ${commitHash}`).toString().trim();
    } catch {
      commitDate = execSync('git log -1 --format=%cI').toString().trim();
    }

    let gitOriginUrl;
    if (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY) {
      gitOriginUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`;
    } else {
      gitOriginUrl = execSync('git remote get-url origin')
        .toString()
        .trim()
        .replace(/\.git$/, '');
      if (gitOriginUrl.startsWith('git@github.com:')) {
        gitOriginUrl = gitOriginUrl.replace('git@github.com:', 'https://github.com/');
      }
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
  // /inspect/* became /explore/* in the May 2026 route rename, without
  // redirects, so old links (e.g. /inspect/lp/<id> shared around) 404'd.
  async redirects() {
    return [{ source: '/inspect/:path*', destination: '/explore/:path*', permanent: true }];
  },
  env: getCommitInfo(),
  serverExternalPackages: ['pino-pretty'],
  // Ship source maps in production while we're chasing a React #310 in the
  // trade page that we can't map back to source from minified stacks.
  // Trivial bandwidth cost on a page reload; devtools resolve real
  // file:line for every stack frame instead of showing `sz`, `zi`, etc.
  productionBrowserSourceMaps: true,
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
