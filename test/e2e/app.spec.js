import { expect, test } from "@playwright/test";

async function waitForWorld(page) {
  await expect(page.locator("#game canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#status")).not.toContainText("起動に失敗", {
    timeout: 30_000,
  });
}

test("boots the production bundle and renders the world shell", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");

  await expect(page).toHaveTitle(/SuperGame/);
  await expect(page.getByRole("heading", { name: "現実世界を、歩けるゲームへ。" })).toBeVisible();
  await expect(page.getByRole("button", { name: "世界に入る" })).toBeVisible();
  await waitForWorld(page);

  expect(pageErrors).toEqual([]);
});

test("supports entering the world, coordinate travel, and car mode", async ({ page }) => {
  await page.goto("/");
  await waitForWorld(page);

  await page.getByRole("button", { name: "世界に入る" }).click();
  await expect(page.locator("#overlay")).toBeHidden();

  const locationInput = page.getByLabel("地名または座標");
  await locationInput.fill("35.6895,139.6917");
  await page.getByRole("button", { name: "移動" }).click();
  await expect(page.locator("#status")).toContainText("到着しました", {
    timeout: 30_000,
  });

  await page.locator('[data-mode="car"]').click();
  await expect(page.locator("#status")).toContainText("車モード");
  await expect(page.locator("#speed")).toContainText("車");
});
