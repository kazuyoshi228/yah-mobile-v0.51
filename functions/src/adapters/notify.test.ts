import { describe, it, expect, vi, beforeEach } from "vitest";

// S9: notifyOwner の到達性（プライマリ失敗時のメールフォールバック／critical時の必達メール）を検証。
// 2026-07 の「単一チャンネルで通知が届かず4日気づかなかった」の再発防止テスト。

vi.mock("firebase-functions/logger", () => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

const { envMock, sendEmailMock } = vi.hoisted(() => ({
  envMock: { ownerEmail: "owner@example.com" },
  sendEmailMock: vi.fn(),
}));
vi.mock("../mailer", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));
vi.mock("../env", () => ({ ENV: envMock }));

import { notifyOwner } from "./notify";

describe("notifyOwner — アラート到達性（S9）", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    envMock.ownerEmail = "owner@example.com";
    process.env.NOTIFY_PROVIDER = "slack";
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.example/xxx";
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("プライマリ成功・非critical → メールは送らない（true）", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const ok = await notifyOwner({ title: "t", content: "c" });
    expect(ok).toBe(true);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("プライマリ失敗 → OWNER_EMAIL にメールでフォールバック（true）", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const ok = await notifyOwner({ title: "down", content: "auth failed" });
    expect(ok).toBe(true);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "owner@example.com" }),
    );
  });

  it("critical=true → プライマリ成功でも必ずメールも送る", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const ok = await notifyOwner({ title: "crit", content: "x", critical: true });
    expect(ok).toBe(true);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("プライマリ失敗 かつ OWNER_EMAIL 未設定 → 全滅で false", async () => {
    envMock.ownerEmail = "";
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const ok = await notifyOwner({ title: "t", content: "c" });
    expect(ok).toBe(false);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
