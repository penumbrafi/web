import Link from 'next/link';
import { MoonStar, ArrowUpFromDot, Coins, BookOpen, Star } from 'lucide-react';
import { PagePath } from '@/shared/const/pages';

export const HEADER_LINKS = [
  {
    // Root `/`. The landing/market page (DEX pairs + stats).
    as: Link,
    tabProps: { href: PagePath.Home },
    label: 'Home',
    value: PagePath.Home,
    icon: Coins,
  },
  {
    as: Link,
    tabProps: { href: PagePath.Portfolio },
    label: 'Portfolio',
    value: PagePath.Portfolio,
    icon: Coins,
  },
  {
    as: Link,
    tabProps: { href: PagePath.Trade },
    label: 'Trade',
    value: PagePath.Trade,
    icon: ArrowUpFromDot,
  },
  {
    // /tournament — always listed. Whether the tournament is running is read
    // from the chain (useLqtStatus), and the page shows an explicit "not
    // running" state instead of disappearing, so the link never needs hiding
    // or un-hiding by hand again.
    as: Link,
    tabProps: { href: PagePath.Tournament },
    label: 'Tournament',
    value: PagePath.Tournament,
    icon: Star,
  },
  {
    // /explore — on-chain explorer (blocks, txs, validators, governance,
    // IBC, LPs).
    as: Link,
    tabProps: { href: PagePath.Explore },
    label: 'Explore',
    value: PagePath.Explore,
    icon: MoonStar,
  },
  {
    // /learn — hub for tokenomics, FAQ, and other educational content.
    // SEO-friendly: each sub-page is statically rendered with relevant
    // Schema.org structured data so search engines can build rich
    // snippets that point at our DEX as the canonical destination.
    as: Link,
    tabProps: { href: PagePath.Learn },
    label: 'Learn',
    value: PagePath.Learn,
    icon: BookOpen,
  },
];
