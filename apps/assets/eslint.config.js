import createConfig from '@penumbra-zone/configs/eslint';
import nextConfig from 'eslint-config-next/core-web-vitals';

const excludePlugins = createConfig.flatMap(config => Object.keys(config.plugins || {}));

export default [
  // eslint-config-next 16 ships native flat config; drop any plugin the
  // shared config already registers so eslint does not see it twice.
  ...(Array.isArray(nextConfig) ? nextConfig : [nextConfig]).filter(cfg =>
    Object.keys(cfg?.plugins || {}).every(plugin => !excludePlugins.includes(plugin)),
  ),
  ...createConfig.filter(config => config.name !== 'custom:turbo-config'),
  {
    name: 'assets:ignores',
    ignores: ['.next/**', 'next-env.d.ts'],
  },
  {
    name: 'assets:react-version',
    settings: { react: { version: 'detect' } },
  },
];
