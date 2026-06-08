import type { ReactElement } from 'react';

/** One row in the home FlashList. `key` doubles as the recycler item-type so
    heterogeneous sections never reuse each other's cells. `render` may return
    null (the section decides whether it has anything to show). */
export type HomeSection = { key: string; render: () => ReactElement | null };
