// Opt in to the real App entry while retaining isolated UI preview support.
export async function openUserPreview(page, url) {
  if (process.env.INTEGRATED_APP === '1') {
    await page.route('**/api/auth/login', route => route.fulfill({ json: {
      access_token: '', token_type: 'demo', role: 'user', display_name: '사용자',
    } }));
  }
  await page.goto(url);
  if (process.env.INTEGRATED_APP === '1') {
    await page.getByLabel('아이디', { exact: true }).fill('user');
    await page.locator('form button[type="submit"]').click();
  }
}
