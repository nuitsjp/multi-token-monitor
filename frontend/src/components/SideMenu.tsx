import { Link, useRouterState } from '@tanstack/react-router';
import { NavLink } from '@mantine/core';
import { useOverview } from '../app/overview.tsx';
import { MenuIcon } from './MenuIcon.tsx';

// 名前はデータの値をそのまま表示する。空文字で届く値は並べない。
export const joinLabels = (...values: (string | null)[]) => values.filter(Boolean).join(' · ');

// 左の縦メニュー。Devices は端末の階層。選択中のページを含む階層は開いておく。
export function SideMenu() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { overview } = useOverview();
  const devices = [...new Map((overview?.devices ?? []).map((d) => [d.deviceId, d])).values()];
  const inside = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

  return (
    <nav aria-label="Menu" className="side-menu">
      <div className="brand">
        <span className="brand-logo">
          <MenuIcon name="logo" size={17} />
        </span>
        <span className="brand-name">Token Monitor Analytics</span>
      </div>
      <NavLink
        component={Link}
        to="/"
        label="Home"
        leftSection={<MenuIcon name="home" />}
        active={pathname === '/'}
      />
      <NavLink
        component={Link}
        to="/by-hub"
        label="By hub"
        leftSection={<MenuIcon name="hub" />}
        active={pathname === '/by-hub'}
      />
      <NavLink
        component={Link}
        to="/by-model"
        label="By model"
        leftSection={<MenuIcon name="model" />}
        active={pathname === '/by-model'}
      />
      <NavLink
        component={Link}
        to="/limits"
        label="Usage limits"
        leftSection={<MenuIcon name="limits" />}
        active={pathname === '/limits'}
      />
      <NavLink
        label="Devices"
        leftSection={<MenuIcon name="devices" />}
        defaultOpened={inside('/devices')}
      >
        {devices.map((device) => (
          <NavLink
            key={device.deviceId}
            renderRoot={(props) => (
              <Link to="/devices/$deviceId" params={{ deviceId: device.deviceId }} {...props} />
            )}
            label={device.hostname}
            active={pathname === `/devices/${encodeURIComponent(device.deviceId)}`}
          />
        ))}
      </NavLink>
    </nav>
  );
}
