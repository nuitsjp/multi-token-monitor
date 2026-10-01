import { createFileRoute } from '@tanstack/react-router';
import { useOverview } from '../app/overview.tsx';
import { NotImplemented } from '../components/NotImplemented.tsx';
import { joinLabels } from '../components/SideMenu.tsx';

export const Route = createFileRoute('/devices/$deviceId')({ component: DevicePage });

function DevicePage() {
  const { deviceId } = Route.useParams();
  const { overview } = useOverview();
  const device = overview?.devices.find((row) => row.deviceId === deviceId);
  return <NotImplemented title={joinLabels('Devices', device?.hostname ?? deviceId)} />;
}
