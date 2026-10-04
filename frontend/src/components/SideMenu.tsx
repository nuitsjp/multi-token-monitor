import { Link, useRouterState } from '@tanstack/react-router';
import { NavLink } from '@mantine/core';
import { useOverview } from '../app/overview.tsx';
import { buildAccounts } from '../limits.ts';
import { MenuIcon } from './MenuIcon.tsx';
import { ProviderIcon } from './ProviderIcon.tsx';

// 名前はデータの値をそのまま表示する。空文字で届く値は並べない。
export const joinLabels = (...values: (string | null)[]) => values.filter(Boolean).join(' · ');

export const contractLabel = (account: { provider: string; planLabel: string | null }) =>
  joinLabels(account.provider, account.planLabel);

// 左の縦メニュー。Usage limits は Hub → 契約の階層。選択中のページを含む階層は開いておく。
export function SideMenu() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { overview } = useOverview();
  const hubs = overview?.hubs ?? [];
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
        to="/by-device"
        label="By device"
        leftSection={<MenuIcon name="devices" />}
        active={pathname === '/by-device'}
      />
      <NavLink
        label="Usage limits"
        leftSection={<MenuIcon name="limits" />}
        defaultOpened={inside('/limits')}
      >
        {hubs.map((hub) => {
          const hubPath = `/limits/${encodeURIComponent(hub.hubId)}`;
          const contracts = buildAccounts(
            (overview?.limitWindows ?? []).filter((row) => row.hubId === hub.hubId),
          );
          return (
            <NavLink
              key={hub.hubId}
              label={hub.name}
              defaultOpened={inside(hubPath)}
              disabled={contracts.length === 0}
            >
              {contracts.map((account) => (
                <NavLink
                  key={account.key}
                  renderRoot={(props) => (
                    <Link
                      to="/limits/$hubId/$contract"
                      params={{ hubId: hub.hubId, contract: account.key }}
                      {...props}
                    />
                  )}
                  label={contractLabel(account)}
                  leftSection={<ProviderIcon provider={account.provider} size={16} />}
                  active={pathname === `${hubPath}/${encodeURIComponent(account.key)}`}
                />
              ))}
            </NavLink>
          );
        })}
      </NavLink>
    </nav>
  );
}
