'use client';

import { ReactNode } from 'react';
import { UploadProvider } from '@/context/UploadContext';

export default function Providers({ children }: { children: ReactNode }) {
  return <UploadProvider>{children}</UploadProvider>;
}
