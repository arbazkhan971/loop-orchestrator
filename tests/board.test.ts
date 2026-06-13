import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addEvent,
  addTask,
  BoardTask,
  boardPaths,
  boardSummary,
  foldBoard,
  initBoard,
  isComplete
} from "../src/board.js";

function ts(offset = 0): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, offset)).toISOString();
}

function makeTask(over: Partial<BoardTask> = {}): BoardTask {
  return {
    id: "t1",
    title: "Build the thing",
    assignee: "backend",
    createdBy: "pm",
    description: "Implement the thing",
    acceptanceCriteria: ["tests pass"],
    dependsOn: [],
    priority: 5,
    createdAt: ts(),
    ...over
  };
}

function freshBoard(): string {
  return join(mkdtempSync(join(tmpdir(), "loop-test-")), "board");
}

describe("board", () => {
  it("initBoard creates the three JSONL files", () => {
    const dir = freshBoard();
    initBoard(dir);
    const paths = boardPaths(dir);
    expect(existsSync(paths.tasks)).toBe(true);
    expect(existsSync(paths.events)).toBe(true);
    expect(existsSync(paths.messages)).toBe(true);
  });

  it("addTask + addEvent then foldBoard yields the advancing status", () => {
    const dir = freshBoard();
    initBoard(dir);
    addTask(dir, makeTask());

    let views = foldBoard(dir);
    expect(views).toHaveLength(1);
    expect(views[0].status).toBe("open");

    addEvent(dir, { ts: ts(1), role: "backend", taskId: "t1", status: "claimed" });
    addEvent(dir, { ts: ts(2), role: "backend", taskId: "t1", status: "in-progress", summary: "coding" });

    views = foldBoard(dir);
    expect(views[0].status).toBe("in-progress");
    expect(views[0].claimedBy).toBe("backend");
    expect(views[0].lastSummary).toBe("coding");
  });

  it("first claim wins when two roles claim the same task", () => {
    const dir = freshBoard();
    initBoard(dir);
    addTask(dir, makeTask());

    addEvent(dir, { ts: ts(1), role: "backend", taskId: "t1", status: "claimed" });
    addEvent(dir, { ts: ts(2), role: "frontend", taskId: "t1", status: "claimed" });

    const view = foldBoard(dir)[0];
    expect(view.claimedBy).toBe("backend");
    expect(view.status).toBe("claimed");
  });

  it("isComplete is true only when every task is done or rejected", () => {
    const dir = freshBoard();
    initBoard(dir);
    // empty board is not complete
    expect(isComplete(dir)).toBe(false);

    addTask(dir, makeTask({ id: "t1" }));
    addTask(dir, makeTask({ id: "t2", assignee: "qa" }));
    expect(isComplete(dir)).toBe(false);

    addEvent(dir, { ts: ts(1), role: "backend", taskId: "t1", status: "done" });
    expect(isComplete(dir)).toBe(false); // t2 still open

    addEvent(dir, { ts: ts(2), role: "qa", taskId: "t2", status: "rejected" });
    expect(isComplete(dir)).toBe(true); // done + rejected both count
  });

  it("boardSummary counts tasks by status", () => {
    const dir = freshBoard();
    initBoard(dir);
    addTask(dir, makeTask({ id: "t1" }));
    addTask(dir, makeTask({ id: "t2" }));
    addTask(dir, makeTask({ id: "t3" }));

    addEvent(dir, { ts: ts(1), role: "backend", taskId: "t1", status: "done" });
    addEvent(dir, { ts: ts(2), role: "backend", taskId: "t2", status: "claimed" });

    const summary = boardSummary(dir);
    expect(summary.total).toBe(3);
    expect(summary.byStatus.done).toBe(1);
    expect(summary.byStatus.claimed).toBe(1);
    expect(summary.byStatus.open).toBe(1);
  });
});
