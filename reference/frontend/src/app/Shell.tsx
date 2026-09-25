import { Outlet, Link } from '@tanstack/react-router';
import { Alert, Badge, Button, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { useIsMutating } from '@tanstack/react-query';
import { DraftProvider, useDraft } from '../shared/DraftContext.tsx';
import { useSession, useSignIn, useSignOut } from '../features/identity/session.ts';
import { useNotesSubscription } from '../features/notes/queries.ts';
import classes from './Shell.module.css';
export function Shell() {
  return (
    <DraftProvider>
      <Application />
    </DraftProvider>
  );
}
function Application() {
  const session = useSession();
  const signIn = useSignIn();
  const signOut = useSignOut();
  const busy = useIsMutating() > 0;
  const draft = useDraft();
  const ready = useNotesSubscription(session.data?.user?.id);
  if (session.isPending)
    return (
      <div className={classes.center}>
        <Loader />
        <Text>起動しています</Text>
      </div>
    );
  if (session.isError)
    return (
      <div className={classes.center}>
        <Alert color="red">サーバーへ接続できませんでした。</Alert>
        <Button onClick={() => void session.refetch()}>再試行</Button>
      </div>
    );
  if (!session.data.user)
    return (
      <main className={classes.login}>
        <div className={classes.brand}>AIDD / REACT + .NET TEMPLATE</div>
        <Title order={1}>対話から、保存まで。</Title>
        <Text c="dimmed">React · ASP.NET Core · SQLite</Text>
        <div className={classes.card}>
          <Title order={2} size="h3">
            参照実装を開始する
          </Title>
          {session.data.mode === 'demo' ? (
            <Stack mt="md">
              <Alert color="yellow">
                ローカル参照用のユーザー選択です。認証機能ではありません。
              </Alert>
              <Group>
                <Button loading={signIn.isPending} onClick={() => signIn.mutate('alice')}>
                  Aliceで開始
                </Button>
                <Button
                  variant="light"
                  loading={signIn.isPending}
                  onClick={() => signIn.mutate('bob')}
                >
                  Bobで開始
                </Button>
              </Group>
              {signIn.error && <Alert color="red">ユーザーの選択に失敗しました。</Alert>}
            </Stack>
          ) : (
            <Alert color="red" mt="md">
              認証プロキシから利用者情報が渡されていません。
            </Alert>
          )}
        </div>
      </main>
    );
  return (
    <div className={classes.layout}>
      <aside className={classes.sidebar}>
        <div className={classes.brand}>AIDD</div>
        <Title order={2} size="h4">
          React + .NET Template
        </Title>
        <Text size="sm" c="gray.4" mt={8}>
          ユースケース駆動の参照実装
        </Text>
        <nav className={classes.nav}>
          <Link to="/notes" activeProps={{ className: classes.active }}>
            01 メモを編集
          </Link>
          <Link to="/import" activeProps={{ className: classes.active }}>
            02 一括登録
          </Link>
        </nav>
        <div className={classes.sidebarBottom}>
          <Badge variant="outline" color="teal.2">
            SQLite / WAL
          </Badge>
          <Text size="xs" mt="sm" c="gray.4">
            対話はReact、保存は.NET。
            <br />
            サンプルデータはDBへ保存されます。
          </Text>
        </div>
      </aside>
      <div className={classes.workspace}>
        <header className={classes.header}>
          <Group gap="xs">
            <Badge variant="light">参照実装</Badge>
            {__MOCK__ && <Badge color="red">モック</Badge>}
            <Text size="sm" c="dimmed" role="status" aria-label="通知接続">
              {ready ? '変更通知 接続済み' : '変更通知 再接続中'}
            </Text>
          </Group>
          <Group>
            <Text size="sm">{session.data.user.name}</Text>
            {session.data.mode === 'demo' && (
              <Button
                size="xs"
                variant="subtle"
                disabled={busy}
                onClick={() => {
                  if (!draft.current || window.confirm('未保存の入力を破棄して終了しますか？'))
                    signOut.mutate();
                }}
              >
                ユーザーを切り替え
              </Button>
            )}
          </Group>
        </header>
        <main className={classes.main}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
