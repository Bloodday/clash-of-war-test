import { useEffect, useState } from 'preact/hooks';

/** Vuelve a renderizar el componente cada vez que el origen notifique un cambio. */
export function useSubscription(source: { subscribe(fn: () => void): () => void }): void {
  const [, setVersion] = useState(0);
  useEffect(() => source.subscribe(() => setVersion((n) => n + 1)), [source]);
}
