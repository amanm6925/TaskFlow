import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';

export const metadata: Metadata = {
  title: 'TaskFlow',
  description: 'Multi-tenant task management',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100 min-h-screen font-mono antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
