'use client';

import { cn } from '@/utils/cn';
import { useSelectedLayoutSegments } from 'next/navigation';

const NOT_MIGRATED_PAGES = ['reports'];

export default function LayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const segments = useSelectedLayoutSegments();

  if (segments[0] && NOT_MIGRATED_PAGES.includes(segments[0])) {
    return (
      <div className="pb-20 transition-all max-w-screen-2xl">
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'pb-20 transition-all mt-12 max-w-screen-2xl',
        segments.includes('chat') && 'pb-0',
      )}
    >
      {children}
    </div>
  );
}
