import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { takeControlUiScreenshotFrame } from "../test-helpers/control-ui-e2e-screenshot.ts";
import {
  controlUiBundledSettingsStorageKey,
  installMockGateway,
  controlUiSessionUrl,
} from "../test-helpers/control-ui-e2e.ts";
import { createControlUiSessionRow as sessionRow } from "../test-helpers/control-ui-session-fixtures.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";
import { chooseSidebarOwner } from "./sidebar-session-menu.test-support.ts";

const suite = createControlUiE2eSuite({ name: "Retained project folders and localized filters" });
const groups = ["Research", "Teaching", "Planning", "Reviews", "Settings"];

suite.define(() => {
  it("keeps authorized project folders through My sessions filtering and a full reload", async () => {
    await suite.withPage(
      { locale: "en-US", serviceWorkers: "block", viewport: { width: 1280, height: 800 } },
      async ({ page }) => {
        const viewer = { type: "human" as const, id: "viewer", label: "Viewer" };
        const agent = { type: "agent" as const, id: "main", label: "Assistant" };
        const own = sessionRow("agent:main:mine", "My conversation", 100, {
          owner: { actor: viewer },
          model: "test-model",
        });
        const other = Array.from({ length: 4 }, (_, i) =>
          sessionRow(`agent:main:other-${i}`, `Agent conversation ${i}`, 100, {
            owner: { actor: agent },
            model: "test-model",
            category: groups[0],
          }),
        );
        await page.addInitScript(
          ({ key }) => {
            if (!localStorage.getItem(key)) {
              localStorage.setItem(
                key,
                JSON.stringify({ sidebarAgentsMode: "chip", navWidth: 360 }),
              );
            }
          },
          { key: controlUiBundledSettingsStorageKey(suite.server.baseUrl) },
        );
        const gateway = await installMockGateway(page, {
          authMethod: "trusted-proxy",
          authMode: "trusted-proxy",
          agentModel: "openai/test-model",
          models: [{ id: "test-model", name: "Test model", provider: "openai" }],
          sessions: [own, ...other],
          sessionKey: own.key,
          sessionGroups: groups,
          presenceUsers: [{ id: viewer.id, name: viewer.label, self: true }],
          heldMethods: ["connect"],
          methodResponses: {
            "sessions.list": {
              ts: 100,
              path: "",
              count: 5,
              sessions: [own, ...other],
              defaults: {},
              owners: [viewer, agent],
            },
          },
        });
        await page.goto(controlUiSessionUrl(suite.server.baseUrl, own.key, "chat"));
        await gateway.waitForRequest("connect");
        await gateway.resolveDeferred("connect");
        const sidebar = page.locator("openclaw-app-sidebar");
        await sidebar.locator("#sidebar-session-owner-title").waitFor();
        await chooseSidebarOwner(page, "all");
        await sidebar.locator('[data-session-key="agent:main:other-0"]').waitFor();
        for (const group of groups) {
          await sidebar.locator(`[data-session-section="category:${group}"]`).waitFor();
        }
        await chooseSidebarOwner(page, "owner:viewer");
        await expect
          .poll(() => sidebar.locator('[data-session-key="agent:main:other-0"]').count())
          .toBe(0);
        await sidebar.locator('[data-session-key="agent:main:mine"]').waitFor();
        const sidebarFrame = await takeControlUiScreenshotFrame(
          page,
          page.locator("aside.sidebar"),
          [],
          {
            animations: "disabled",
            elements: [page.locator("aside.sidebar")],
          },
        );
        await writeFile(
          path.join(suite.artifactDir, "my-sessions-project-folders.png"),
          sidebarFrame.elements[0]!.png,
        );
        for (const group of groups) {
          expect(await sidebar.locator(`[data-session-section="category:${group}"]`).count()).toBe(
            1,
          );
        }
        await page.reload();
        await gateway.waitForRequest("connect");
        await gateway.resolveDeferred("connect");
        await page.locator('aside.sidebar[data-snapshot-state="live"]').waitFor();
        await sidebar.locator('[data-session-key="agent:main:mine"]').waitFor();
        for (const group of groups) {
          expect(await sidebar.locator(`[data-session-section="category:${group}"]`).count()).toBe(
            1,
          );
        }
        expect(await sidebar.locator('[data-session-key="agent:main:other-0"]').count()).toBe(0);
      },
    );
  });

  it.each([400, 820, 1280])(
    "contains wrapped Russian status options above the next row at %spx",
    async (width) => {
      await suite.withPage(
        { locale: "ru-RU", serviceWorkers: "block", viewport: { width, height: 900 } },
        async ({ page }) => {
          await installMockGateway(page);
          await page.goto(`${suite.server.baseUrl}chat`);
          if (width <= 900) {
            await page
              .locator(".chat-pane__nav-toggle:visible, .topbar-nav-toggle:visible")
              .first()
              .click();
          }
          await page.locator(".sidebar-session-toolbar .sidebar-session-sort").click();
          const panel = page.locator(".sidebar-session-filter-panel");
          const status = panel.locator("#sidebar-sessions-status");
          const cron = panel.locator("#sidebar-sessions-cron");
          await status.waitFor();
          const frame = await takeControlUiScreenshotFrame(page, panel, [status, cron], {
            animations: "disabled",
            elements: [panel],
          });
          await writeFile(
            path.join(suite.artifactDir, `ru-status-${width}.png`),
            frame.elements[0]!.png,
          );
          const row = (await status.boundingBox())!;
          const next = (await cron.boundingBox())!;
          const options = await status.locator(".settings-segmented__btn").evaluateAll((items) =>
            items.map((item) => {
              const rect = item.getBoundingClientRect();
              return { top: rect.top, bottom: rect.bottom };
            }),
          );
          expect(options).toHaveLength(4);
          for (const option of options) {
            expect(option.top).toBeGreaterThanOrEqual(row.y);
            expect(option.bottom).toBeLessThanOrEqual(row.y + row.height);
            expect(option.bottom).toBeLessThanOrEqual(next.y);
          }
        },
      );
    },
  );
});
