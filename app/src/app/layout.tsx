import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Knowledge Graph Viewer — Mathematics',
  description: 'Interactive visualization of the Learning Commons Knowledge Graph (math-only slice).',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
