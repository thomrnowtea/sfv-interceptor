import assert from "node:assert/strict";
import { join } from "node:path";

// A separate context lets another library wrap XHR before the production hook runs.
export async function checkXhrCompatibility({
  browser,
  origin,
  extensionRoot,
  probe,
}) {
  const context = await browser.newContext();
  try {
    for (const shape of [
      "native",
      "subclass",
      "deep subclass",
      "data timeout",
      "locked timeout",
    ]) {
      for (const mode of [
        "unmatched",
        "request-only",
        "static",
        "mutable timeout",
      ]) {
        await probe(
          "XHR wrapper compatibility: " + shape + " / " + mode,
          async () => {
            const page = await context.newPage();
            const errors = [];
            page.on("pageerror", (error) => errors.push(error.message));
            page.on("console", (message) => {
              if (message.type() === "error") errors.push(message.text());
            });
            try {
              await page.goto(origin);
              const before = await page.evaluate((shape) => {
                const Native = window.XMLHttpRequest;
                const wrapped =
                  shape === "native"
                    ? Native
                    : class WrappedXHR extends Native {};
                if (shape === "deep subclass")
                  window.XMLHttpRequest = class extends wrapped {};
                else window.XMLHttpRequest = wrapped;
                if (shape === "data timeout")
                  Object.defineProperty(wrapped.prototype, "timeout", {
                    configurable: true,
                    enumerable: true,
                    writable: true,
                    value: 0,
                  });
                if (shape === "locked timeout")
                  Object.defineProperty(wrapped.prototype, "timeout", {
                    ...Object.getOwnPropertyDescriptor(
                      Native.prototype,
                      "timeout",
                    ),
                    configurable: false,
                  });
                return {
                  installed: Reflect.ownKeys(window).some(
                    (key) =>
                      typeof key === "symbol" && window[key]?._sfvi === 1,
                  ),
                  ownTimeout: Boolean(
                    Object.getOwnPropertyDescriptor(
                      XMLHttpRequest.prototype,
                      "timeout",
                    ),
                  ),
                  ownUpload: Boolean(
                    Object.getOwnPropertyDescriptor(
                      XMLHttpRequest.prototype,
                      "upload",
                    ),
                  ),
                };
              }, shape);
              assert.equal(
                before.installed,
                false,
                "Compatibility fixture must precede hook installation",
              );
              assert.equal(
                before.ownTimeout,
                ["native", "data timeout", "locked timeout"].includes(shape),
              );
              assert.equal(before.ownUpload, shape === "native");
              await page.addScriptTag({
                path: join(extensionRoot, "page-hook.js"),
              });
              const result = await page.evaluate(async (mode) => {
                const hook = Reflect.ownKeys(window)
                  .map((key) => (typeof key === "symbol" ? window[key] : null))
                  .find((value) => value?._sfvi === 1);
                hook.updateApis(
                  mode === "unmatched"
                    ? []
                    : [
                        {
                          ruleId: "wrapper-audit",
                          name: "Wrapper audit",
                          regex: "/api/wrapped/",
                          responseType: "static",
                          responseBody:
                            mode === "static" ? '{"changed":true}' : "",
                        },
                      ],
                );
                return new Promise((resolve, reject) => {
                  const xhr = new XMLHttpRequest();
                  const events = [];
                  let upload = 0;
                  const guard = setTimeout(
                    () => reject(new Error("Wrapped XHR did not finish")),
                    2000,
                  );
                  xhr.open(
                    "POST",
                    "/api/wrapped/" +
                      (mode === "mutable timeout" ? "slow" : "target"),
                  );
                  xhr.timeout = 1500;
                  xhr.upload.onprogress = () => upload++;
                  for (const type of [
                    "load",
                    "timeout",
                    "error",
                    "abort",
                    "loadend",
                  ])
                    xhr.addEventListener(type, () => events.push(type));
                  xhr.onloadend = () => {
                    clearTimeout(guard);
                    resolve({
                      status: xhr.status,
                      text: xhr.responseText,
                      timeout: xhr.timeout,
                      events,
                      upload,
                    });
                  };
                  xhr.send("original");
                  if (mode === "mutable timeout")
                    setTimeout(() => {
                      xhr.timeout = 60;
                    }, 15);
                });
              }, mode);
              assert.deepEqual(errors, []);
              if (mode === "mutable timeout" && shape !== "data timeout") {
                assert.equal(result.status, 0);
                assert.equal(result.timeout, 60);
                assert.deepEqual(result.events, ["timeout", "loadend"]);
              } else {
                assert.equal(result.status, 200);
                assert.equal(
                  result.timeout,
                  mode === "mutable timeout" ? 60 : 1500,
                );
                assert.deepEqual(result.events, ["load", "loadend"]);
                assert.ok(
                  result.upload > 0,
                  "Upload handlers must remain usable",
                );
                const body = JSON.parse(result.text);
                if (
                  mode === "static" &&
                  !["data timeout", "locked timeout"].includes(shape)
                )
                  assert.deepEqual(body, { changed: true });
                else assert.equal(body.body, "original");
              }
            } finally {
              await page.close();
            }
          },
        );
      }
    }
  } finally {
    await context.close();
  }
}
