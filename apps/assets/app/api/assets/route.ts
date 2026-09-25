import { getAssets } from '@/db/queries';
import { respond } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = () => respond(() => getAssets('all'));
