import { Text } from '@penumbra-zone/ui/Text';
import type { TokenomicsMetrics } from '../server/metrics';

const fmtUM = (n: number): string => {
  if (n >= 1_000_000) {return `${(n / 1_000_000).toFixed(2)}M`;}
  if (n >= 1_000) {return `${(n / 1_000).toFixed(1)}K`;}
  return n.toFixed(0);
};

const fmtPct = (n: number, digits = 2): string => `${n.toFixed(digits)}%`;

interface StatTileProps {
  label: string;
  primary: string;
  secondary?: string;
  accent?: 'orange' | 'teal' | 'red' | 'green' | 'neutral';
}

const accentClass = {
  orange: 'text-orange-400',
  teal: 'text-teal-300',
  red: 'text-red-400',
  green: 'text-green-400',
  neutral: 'text-text-primary',
} as const;

const StatTile = ({ label, primary, secondary, accent = 'neutral' }: StatTileProps) => (
  <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4 desktop:p-6'>
    <Text detail color='text.secondary'>
      {label}
    </Text>
    <div className={`font-mono text-2xl font-medium desktop:text-3xl ${accentClass[accent]}`}>
      {primary}
    </div>
    {secondary && (
      <Text small color='text.secondary'>
        {secondary}
      </Text>
    )}
  </div>
);

const inflationAccentFor = (pct: number | null): StatTileProps['accent'] => {
  if (pct === null) {
    return 'neutral';
  }
  if (pct < 1) {
    return 'green';
  }
  return pct < 3 ? 'teal' : 'orange';
};

export const HeadlineStats = ({ metrics }: { metrics: TokenomicsMetrics }) => {
  const inflationStr =
    metrics.annualizedInflationPct === null
      ? '—'
      : fmtPct(metrics.annualizedInflationPct);
  const inflationAccent = inflationAccentFor(metrics.annualizedInflationPct);

  return (
    <section className='flex flex-col gap-3'>
      <div className='flex flex-col gap-1'>
        <Text variant='h2' color='text.primary'>
          The numbers, right now
        </Text>
        <Text body color='text.secondary'>
          Latest on-chain snapshot — block {metrics.latestHeight.toLocaleString('en-US')}.
        </Text>
      </div>

      <div className='grid grid-cols-2 gap-3 desktop:grid-cols-4'>
        <StatTile
          label='Total supply'
          primary={`${fmtUM(metrics.totalSupply)} UM`}
          secondary={`Genesis: ${fmtUM(metrics.genesisAllocation)} UM`}
        />
        <StatTile
          label='Active stake'
          primary={fmtPct(metrics.activeStakedPct, 1)}
          secondary={`${fmtUM(metrics.activeStakedSupply)} UM securing the chain`}
          accent='teal'
        />
        <StatTile
          label='Annual issuance'
          primary={inflationStr}
          secondary='30d realized, annualized'
          accent={inflationAccent}
        />
        <StatTile
          label='Permanently burned'
          primary={`${fmtUM(metrics.totalBurned)} UM`}
          secondary={`${fmtPct(metrics.burnedPctOfEffective, 2)} of effective supply`}
          accent='orange'
        />
      </div>
    </section>
  );
};
