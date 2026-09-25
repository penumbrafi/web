'use client';

import { makeAutoObservable } from 'mobx';

const STORAGE_KEY = 'veil:hide-balances';

/**
 * Whether the portfolio blurs balances and values. Per browser, off by
 * default. Prices and percentages stay visible: they say nothing about
 * what the viewer holds.
 */
class BalanceVisibilityStore {
  hidden = false;

  constructor() {
    makeAutoObservable(this);
    if (typeof window !== 'undefined') {
      try {
        this.hidden = window.localStorage.getItem(STORAGE_KEY) === '1';
      } catch {
        /* storage blocked: stay visible */
      }
    }
  }

  toggle() {
    this.hidden = !this.hidden;
    try {
      window.localStorage.setItem(STORAGE_KEY, this.hidden ? '1' : '0');
    } catch {
      /* storage blocked: the toggle still works for this page */
    }
  }
}

export const balanceVisibility = new BalanceVisibilityStore();
