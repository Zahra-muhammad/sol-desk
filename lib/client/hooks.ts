'use client';

import { useEffect, useState } from 'react';

/** Re-render every `ms` so clocks, greetings, "late" flags and "next" stay current. */
export function useNow(ms = 60000) {
  const [, setT] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setT((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}
