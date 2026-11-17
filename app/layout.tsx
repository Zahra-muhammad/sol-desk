import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-inter', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'sol — desk',
  description: 'A private planner.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The theme is mirrored in a cookie so the lock screen is already the right colour before login.
  const theme = (await cookies()).get('sol_theme')?.value;
  const cls = [inter.variable, mono.variable, theme === 'light' ? 'lite' : theme === 'dark' ? 'dk' : ''].filter(Boolean).join(' ');
  // `--font-ui` is just the self-hosted Inter family, without next/font's Arial-based fallback, so glyphs
  // Inter's latin subset lacks (like →) fall through to system-ui exactly as they do in the prototype.
  const ui = { '--font-ui': inter.style.fontFamily.split(',')[0].trim() } as React.CSSProperties;
  return (
    <html lang="en" className={cls} style={ui}>
      <body className="locked">{children}</body>
    </html>
  );
}
