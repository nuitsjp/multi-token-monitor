import { providerIcons, providerImages } from './providerIcons.ts';

// ツール（提供元）のアイコン。メニューとHomeの利用枠の見出しで同じものを使う。
export function ProviderIcon({ provider, size = 20 }: { provider: string; size?: number }) {
  const icon = providerIcons[provider];
  const image = providerImages[provider];
  if (image !== undefined)
    return (
      <img
        src={image}
        width={size}
        height={size}
        alt=""
        style={{ borderRadius: 4, transform: `translateY(${size * 0.06}px)` }}
      />
    );
  if (icon === undefined) return null;
  return (
    <svg
      width={size - 4}
      height={size - 4}
      viewBox="0 0 24 24"
      aria-hidden
      style={{ transform: `translateY(${size * 0.06}px)` }}
    >
      <path fill="#b4b6bf" d={icon} />
    </svg>
  );
}
