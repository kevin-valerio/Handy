import { expect, test } from "@playwright/test";

const originalKey = "sk-test-original";
const editedKey = "sk-test-edited";

type TestWindow = Window & {
  apiKeyTest: {
    failNextSave: boolean;
    holdNextSave: boolean;
    releaseSave: () => void;
    saveCalls: { providerId: string; apiKey: string }[];
    savedKey: () => string;
    storeKey: () => string;
  };
};

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  // Mount only ModelsSettings. All Tauri calls stay inside this fake backend;
  // the component, generated bindings, and settings store use their real code.
  await page.route("**/openai-api-key-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html>
        <html><body><div id="root"></div><script type="module">
          import RefreshRuntime from "/@react-refresh";
          import React from "/node_modules/.vite/deps/react.js";
          import ReactDOM from "/node_modules/.vite/deps/react-dom_client.js";
          import { mockIPC, mockWindows } from "/node_modules/@tauri-apps/api/mocks.js";

          RefreshRuntime.injectIntoGlobalHook(window);
          window.$RefreshReg$ = () => {};
          window.$RefreshSig$ = () => (type) => type;
          window.__vite_plugin_react_preamble_installed__ = true;
          window.__TAURI_OS_PLUGIN_INTERNALS__ = { platform: "linux" };

          const storageKey = "test.openai-api-key";
          if (localStorage.getItem(storageKey) === null) {
            localStorage.setItem(storageKey, ${JSON.stringify(originalKey)});
          }
          const settings = () => ({
            app_language: "en",
            post_process_api_keys: { openai: localStorage.getItem(storageKey) },
          });
          window.apiKeyTest = {
            failNextSave: false,
            holdNextSave: false,
            saveCalls: [],
            savedKey: () => localStorage.getItem(storageKey),
          };
          mockIPC(async (command, args) => {
            if (command === "get_app_settings") return settings();
            if (command === "change_post_process_api_key_setting") {
              window.apiKeyTest.saveCalls.push(args);
              if (window.apiKeyTest.holdNextSave) {
                window.apiKeyTest.holdNextSave = false;
                await new Promise((resolve) => {
                  window.apiKeyTest.releaseSave = resolve;
                });
              }
              if (window.apiKeyTest.failNextSave) {
                window.apiKeyTest.failNextSave = false;
                throw "Simulated disk write failure";
              }
              localStorage.setItem(storageKey, args.apiKey);
              return null;
            }
            throw new Error("Unexpected Tauri command: " + command);
          }, { shouldMockEvents: true });
          mockWindows("main");

          const { useSettingsStore } = await import("/src/stores/settingsStore.ts");
          const { useModelStore } = await import("/src/stores/modelStore.ts");
          useSettingsStore.setState({ settings: settings(), isLoading: false });
          useModelStore.setState({ loading: false });
          window.apiKeyTest.storeKey = () =>
            useSettingsStore.getState().settings.post_process_api_keys.openai;
          await import("/src/i18n/index.ts");
          const { ModelsSettings } = await import("/src/components/settings/models/ModelsSettings.tsx");
          ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(ModelsSettings));
        </script></body></html>`,
    }),
  );
  await page.goto("/openai-api-key-test");
  await expect(page.getByLabel("OpenAI API key", { exact: true })).toHaveValue(
    originalKey,
  );
});

test("reveals the key and saves edits only when Save is clicked", async ({
  page,
}) => {
  const input = page.getByLabel("OpenAI API key", { exact: true });
  await expect(input).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await expect(input).toHaveAttribute("type", "text");
  await input.fill(` ${editedKey} `);
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(input).toHaveAttribute("type", "password");
  expect(
    await page.evaluate(() => (window as TestWindow).apiKeyTest.saveCalls),
  ).toEqual([]);

  await page.evaluate(() => {
    (window as TestWindow).apiKeyTest.holdNextSave = true;
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await expect(input).toBeDisabled();
  await page.evaluate(() => (window as TestWindow).apiKeyTest.releaseSave());

  await expect(page.getByRole("status")).toHaveText("API key saved.");
  expect(
    await page.evaluate(() => ({
      calls: (window as TestWindow).apiKeyTest.saveCalls,
      saved: (window as TestWindow).apiKeyTest.savedKey(),
      store: (window as TestWindow).apiKeyTest.storeKey(),
    })),
  ).toEqual({
    calls: [{ providerId: "openai", apiKey: editedKey }],
    saved: editedKey,
    store: editedKey,
  });
  await page.reload();
  await expect(input).toHaveValue(editedKey);
});

test("keeps the draft after a rejected save and allows retry", async ({
  page,
}) => {
  const input = page.getByLabel("OpenAI API key", { exact: true });
  await input.fill(editedKey);
  await page.evaluate(() => {
    (window as TestWindow).apiKeyTest.failNextSave = true;
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Could not save the API key. Try again.",
  );
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(input).toHaveValue(editedKey);
  expect(
    await page.evaluate(() => ({
      saved: (window as TestWindow).apiKeyTest.savedKey(),
      store: (window as TestWindow).apiKeyTest.storeKey(),
    })),
  ).toEqual({ saved: originalKey, store: originalKey });

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("API key saved.");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate(() => ({
      calls: (window as TestWindow).apiKeyTest.saveCalls.length,
      saved: (window as TestWindow).apiKeyTest.savedKey(),
      store: (window as TestWindow).apiKeyTest.storeKey(),
    })),
  ).toEqual({ calls: 2, saved: editedKey, store: editedKey });
});
