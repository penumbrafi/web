import { Dashboard } from '@/ui/dashboard';

// The page itself is a static shell: every query lives behind the /api/*
// route handlers so `next build` needs no database and the deploy health
// check on `/` answers immediately even while the indexer is down.
const Page = () => (
  <main className='mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8'>
    <header className='flex flex-wrap items-baseline justify-between gap-2'>
      <div>
        <h1 className='text-xl font-medium text-text-primary'>Penumbra Assets</h1>
        <p className='text-sm text-text-secondary'>
          Shielded pool balances on penumbra-1, from pindexer.
        </p>
      </div>
    </header>
    <Dashboard />
  </main>
);

export default Page;
