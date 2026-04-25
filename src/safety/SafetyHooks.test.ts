/**
 * Safety Hooks の振る舞い: 危険操作検出、承認要否、イベント保存を確認する。
 */
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { ConsoleApprovalGate, formatApprovalPrompt, type ApprovalGate } from "./ApprovalGate.js";
import { detectSafetyIssues } from "./CommandDetector.js";
import { reviewSafety, type SafetyEventStore } from "./SafetyHooks.js";
import { SafetyPolicy } from "./SafetyPolicy.js";

class FakeStore implements SafetyEventStore {
  events: Parameters<NonNullable<SafetyEventStore["addAgentEvent"]>>[0][] = [];

  addAgentEvent(input: Parameters<NonNullable<SafetyEventStore["addAgentEvent"]>>[0]): void {
    this.events.push(input);
  }
}

const approvingGate: ApprovalGate = {
  async requestApproval() {
    return {
      approved: true,
      response: "yes",
      decidedAt: "2026-04-25T00:00:00.000Z",
    };
  },
};

describe("Safety Hooks", () => {
  it("危険コマンドと秘密情報参照を検出する", () => {
    const findings = detectSafetyIssues("rm -rf .\ncat .env\nprint OPENAI_API_KEY");

    expect(findings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining(["rm-recursive-force", "dotenv-file", "well-known-secret-env"]),
    );
  });

  it("検出がある場合だけ承認を要求する", () => {
    const policy = new SafetyPolicy();

    expect(policy.evaluate("echo safe").requiresApproval).toBe(false);
    expect(policy.evaluate("git reset --hard").requiresApproval).toBe(true);
  });

  it("非TTYでは承認を拒否として扱う", async () => {
    const gate = new ConsoleApprovalGate({
      input: new PassThrough(),
      output: new PassThrough(),
      now: () => new Date("2026-04-25T00:00:00.000Z"),
    });

    await expect(
      gate.requestApproval({
        sessionId: "session-1",
        agent: "codex",
        content: "git reset --hard",
        decision: new SafetyPolicy().evaluate("git reset --hard"),
      }),
    ).resolves.toMatchObject({
      approved: false,
      response: "non-interactive",
    });
  });

  it("検出イベントと承認結果を保存する", async () => {
    const store = new FakeStore();
    const result = await reviewSafety({
      sessionId: "session-1",
      agent: "codex",
      content: "git clean -fdx",
      store,
      approvalGate: approvingGate,
    });

    expect(result.approval?.approved).toBe(true);
    expect(store.events).toHaveLength(2);
    expect(store.events[0]).toMatchObject({
      sessionId: "session-1",
      agent: "codex",
      eventType: "safety.detected",
    });
    expect(store.events[1]).toMatchObject({
      eventType: "safety.approved",
    });
  });

  it("承認プロンプトには検出内容が含まれる", () => {
    const decision = new SafetyPolicy().evaluate("cat id_rsa");
    expect(
      formatApprovalPrompt({
        sessionId: "session-1",
        agent: "codex",
        content: "cat id_rsa",
        decision,
      }),
    ).toContain("private-key-file");
  });
});
