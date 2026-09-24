import assert from "node:assert/strict";
import { test } from "node:test";
import { isSupportedPushEndpoint } from "./push-endpoint";

test("accepts supported browser push-service endpoints", () => {
  assert.equal(isSupportedPushEndpoint("https://fcm.googleapis.com/fcm/send/example"), true);
  assert.equal(isSupportedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/example"), true);
  assert.equal(isSupportedPushEndpoint("https://web.push.apple.com/Q/example"), true);
  assert.equal(isSupportedPushEndpoint("https://db5.notify.windows.com/w/?token=example"), true);
});

test("rejects arbitrary and private HTTPS endpoints", () => {
  assert.equal(isSupportedPushEndpoint("https://example.com/internal"), false);
  assert.equal(isSupportedPushEndpoint("https://127.0.0.1/admin"), false);
  assert.equal(isSupportedPushEndpoint("https://10.0.0.1/metadata"), false);
  assert.equal(isSupportedPushEndpoint("https://fcm.googleapis.com.evil.example/send"), false);
  assert.equal(isSupportedPushEndpoint("https://user@fcm.googleapis.com/send"), false);
  assert.equal(isSupportedPushEndpoint("https://fcm.googleapis.com:8443/send"), false);
});