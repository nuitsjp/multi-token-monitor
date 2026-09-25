import { test, expect } from '../../fixtures.ts';
import { signIn, saveFromUI } from '../../helpers.ts';

test('別ユーザーは他者のメモを参照・更新・削除できない', async ({ page, app, browser }) => {
  // Arrange
  await signIn(page);
  await saveFromUI(page, '所有者別タイトル', 'Aliceの本文');
  const [note] = await (await page.request.get('/api/notes')).json();
  const other = await browser.newContext({ baseURL: app.url });
  try {
    const bob = await other.newPage();
    await signIn(bob, 'Bob');
    const headers = { Origin: app.url };

    // Act
    const read = await bob.request.get(`/api/notes/${note.id}`);
    const update = await bob.request.post('/api/notes/save', {
      headers,
      data: { id: note.id, version: note.version, title: '奪取', body: 'Bobの本文' },
    });
    const remove = await bob.request.post('/api/notes/remove', {
      headers,
      data: { id: note.id, version: note.version },
    });

    // Assert
    await expect(bob.getByRole('button', { name: '所有者別タイトルを編集' })).toHaveCount(0);
    expect([read.status(), update.status(), remove.status()]).toEqual([404, 404, 404]);
    expect(app.rows()).toEqual([
      { owner_id: 'alice', title: '所有者別タイトル', body: 'Aliceの本文', version: 1 },
    ]);
  } finally {
    await other.close();
  }
});
