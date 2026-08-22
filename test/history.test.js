import test from "node:test";
import assert from "node:assert/strict";

import { resumableDayEdit, warnBeforeUnload } from "../src/useHistoryView.js";

test("only a retained past-day edit history entry can resume", () => {
  const today = "2026-08-21";

  assert.equal(
    resumableDayEdit({ view: "day", day: "2026-08-20", edit: true }, today),
    "2026-08-20",
  );
  assert.equal(
    resumableDayEdit({ view: "day", day: "2025-07-17", edit: true }, today),
    "2025-07-17",
  );
  assert.equal(
    resumableDayEdit({ view: "day", day: "2025-07-16", edit: true }, today),
    null,
  );
  assert.equal(
    resumableDayEdit({ view: "day", day: "2026-08-21", edit: true }, today),
    null,
  );
  assert.equal(
    resumableDayEdit({ view: "day", day: "2026-08-20", edit: false }, today),
    null,
  );
  assert.equal(
    resumableDayEdit({ view: "day", day: "2026-08-2", edit: true }, today),
    null,
  );
});

test("beforeunload is blocked only for a dirty past-day draft", () => {
  let prevented = false;
  const cleanEvent = {
    returnValue: undefined,
    preventDefault: () => {
      prevented = true;
    },
  };

  assert.equal(warnBeforeUnload({ dirty: false }, cleanEvent), false);
  assert.equal(prevented, false);
  assert.equal(cleanEvent.returnValue, undefined);

  const dirtyEvent = {
    returnValue: undefined,
    preventDefault: () => {
      prevented = true;
    },
  };
  assert.equal(warnBeforeUnload({ dirty: true }, dirtyEvent), true);
  assert.equal(prevented, true);
  assert.equal(dirtyEvent.returnValue, "");
});
