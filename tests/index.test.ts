import assert from "node:assert/strict";
import test from "node:test";

import { serviceName } from "../src/index.js";

test("reports the service name", () => {
  assert.equal(serviceName(), "tbm-unicloudconnect");
});
