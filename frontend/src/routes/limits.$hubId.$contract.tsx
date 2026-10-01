import { createFileRoute } from '@tanstack/react-router';
import { useOverview } from '../app/overview.tsx';
import { NotImplemented } from '../components/NotImplemented.tsx';
import { contractLabel, joinLabels } from '../components/SideMenu.tsx';
import { buildAccounts } from '../limits.ts';

export const Route = createFileRoute('/limits/$hubId/$contract')({ component: ContractPage });

function ContractPage() {
  const { hubId, contract } = Route.useParams();
  const { overview } = useOverview();
  const hub = overview?.hubs.find((row) => row.hubId === hubId);
  const account = buildAccounts(
    (overview?.limitWindows ?? []).filter((row) => row.hubId === hubId),
  ).find((row) => row.key === contract);
  return (
    <NotImplemented
      title={joinLabels(
        'Usage limits',
        hub?.name ?? hubId,
        account === undefined ? contract : contractLabel(account),
      )}
    />
  );
}
