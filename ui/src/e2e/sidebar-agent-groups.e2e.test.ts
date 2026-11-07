import path from "node:path";
import { expect, it } from "vitest";
import { installMockGateway } from "../test-helpers/control-ui-e2e.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";
import { installNativeWebChrome } from "./native-nav.test-support.ts";

const suite = createControlUiE2eSuite({ name: "Agent chat groups and native agent tooltip" });

suite.define(() => {
  it.each(["category", "none"])(
    "creates a visible empty chat group from the agent toolbar (grouping=%s)",
    async (grouping) => {
      await suite.withPage(
        { locale: "en-US", viewport: { width: 1280, height: 800 } },
        async ({ page }) => {
          await page.addInitScript((value) => {
            localStorage.setItem("openclaw:sidebar:sessions:grouping", value);
            localStorage.setItem("openclaw:sidebar:sessions:hide-empty-groups", "true");
          }, grouping);
          const gateway = await installMockGateway(page);
          await page.goto(`${suite.server.baseUrl}chat`);
          const sidebar = page.locator("openclaw-app-sidebar:visible");
          await sidebar.locator(".sidebar-session-toolbar").waitFor();
          await page.screenshot({
            path: path.join(suite.artifactDir, `groups-${grouping}-entry.png`),
            animations: "disabled",
          });
          const create = sidebar.getByRole("button", { name: "New group", exact: true });
          expect(await create.count()).toBe(1);
          await create.click();
          const dialog = page.getByRole("dialog", { name: "New group", exact: true });
          await dialog.getByRole("textbox").fill("Academy");
          await dialog.getByRole("button", { name: "Create group", exact: true }).click();
          await dialog.waitFor({ state: "detached" });
          const group = sidebar.locator('[data-session-section="category:Academy"]');
          await group.waitFor();
          const writes = await gateway.getRequests("sessions.groups.put");
          expect(writes).toHaveLength(1);
          expect(writes[0]?.params).toMatchObject({ names: expect.arrayContaining(["Academy"]) });
          await page.screenshot({
            path: path.join(suite.artifactDir, `groups-${grouping}-created.png`),
            animations: "disabled",
          });
          await group.locator(".sidebar-recent-sessions__head").hover();
          await group.getByRole("link", { name: "New session in Academy", exact: true }).click();
          await expect.poll(() => page.url()).toContain("group=Academy");
        },
      );
    },
  );

  it("keeps the agent name to the right of its avatar below native window controls", async () => {
    await suite.withPage(
      { locale: "en-US", viewport: { width: 1280, height: 800 } },
      async ({ page }) => {
        await installNativeWebChrome(page);
        await installMockGateway(page);
        await page.goto(`${suite.server.baseUrl}chat`);
        const trigger = page.locator(".sidebar-rail .sidebar-agent-card__main");
        await trigger.waitFor();
        await trigger.focus();
        const tooltip = page.locator("openclaw-tooltip[open] .tooltip-surface");
        await tooltip.waitFor();
        const avatar = (await trigger.boundingBox())!;
        const hint = (await tooltip.boundingBox())!;
        await page.screenshot({
          path: path.join(suite.artifactDir, "native-agent-tooltip.png"),
          animations: "disabled",
        });
        expect(hint.x).toBeGreaterThanOrEqual(avatar.x + avatar.width);
        expect(hint.y).toBeGreaterThanOrEqual(52);
      },
    );
  });
});
