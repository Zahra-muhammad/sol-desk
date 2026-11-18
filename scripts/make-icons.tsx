// npm run icons — render the gradient "S" app icon to PNGs for the home screen and iOS.
// Writes public/icons/* (web app) and, if the iOS project exists, its AppIcon.
import fs from 'node:fs';
import path from 'node:path';
import { ImageResponse } from 'next/og';

/** The same conic gradient "S" avatar as the lock screen, on the desk colour. */
function Icon({ size, padded }: { size: number; padded: boolean }) {
  // Maskable / iOS icons get cropped to a squircle, so keep the art inside the safe zone.
  const disc = padded ? size * 0.72 : size;
  return (
    <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#191919' }}>
      <div
        style={{
          width: disc,
          height: disc,
          borderRadius: disc,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // Satori has no conic-gradient; a diagonal blend of the same three colours reads the same at icon size.
          backgroundImage: 'linear-gradient(140deg, #4c6bff 0%, #ff6fc1 48%, #ffc93c 100%)',
          color: '#111',
          fontSize: disc * 0.46,
          fontWeight: 700,
          fontFamily: 'Inter',
        }}
      >
        S
      </div>
    </div>
  );
}

/** Inter Bold, like the lock screen's "S". Google Fonts serves TTF when no browser user agent is sent. */
let inter: ArrayBuffer | null = null;
async function interBold(): Promise<ArrayBuffer> {
  if (inter) return inter;
  const css = await (await fetch('https://fonts.googleapis.com/css2?family=Inter:wght@700&text=S')).text();
  const url = css.match(/src:\s*url\(([^)]+)\)/)?.[1];
  if (!url) throw new Error('Could not find the Inter font URL');
  inter = await (await fetch(url)).arrayBuffer();
  return inter;
}

async function png(size: number, padded: boolean, out: string) {
  const r = new ImageResponse(<Icon size={size} padded={padded} />, {
    width: size,
    height: size,
    fonts: [{ name: 'Inter', data: await interBold(), weight: 700, style: 'normal' }],
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  console.log('wrote', out);
}

async function main() {
  await png(192, true, 'public/icons/icon-192.png');
  await png(512, true, 'public/icons/icon-512.png');
  await png(512, true, 'public/icons/icon-maskable-512.png');
  await png(180, true, 'public/icons/apple-touch-icon.png');
  const ios = 'ios/App/App/Assets.xcassets/AppIcon.appiconset';
  if (fs.existsSync(ios)) await png(1024, true, path.join(ios, 'AppIcon-512@2x.png'));
  // Launch screen: the desk colour with a small "S" (replaces Capacitor's default logo).
  const splash = 'ios/App/App/Assets.xcassets/Splash.imageset';
  if (fs.existsSync(splash)) {
    const r = new ImageResponse(
      (
        <div style={{ width: 2732, height: 2732, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#191919' }}>
          <Icon size={360} padded={false} />
        </div>
      ),
      { width: 2732, height: 2732, fonts: [{ name: 'Inter', data: await interBold(), weight: 700, style: 'normal' }] },
    );
    const buf = Buffer.from(await r.arrayBuffer());
    for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
      fs.writeFileSync(path.join(splash, f), buf);
      console.log('wrote', path.join(splash, f));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
