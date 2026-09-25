import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMailMock, closeMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn();
  const closeMock = vi.fn();
  const createTransportMock = vi.fn(() => ({
    sendMail: sendMailMock,
    close: closeMock,
  }));
  return { sendMailMock, closeMock, createTransportMock };
});

vi.mock('nodemailer', () => ({
  default: {
    createTransport: createTransportMock,
  },
}));

import { sendRunReportEmail, type SmtpConfig } from '../email.js';

function createRunSummary(overrides: Partial<Parameters<typeof sendRunReportEmail>[2]> = {}) {
  return {
    runId: 'run-123-uuid-value',
    status: 'failed',
    total: 100,
    passed: 90,
    failed: 8,
    flaky: 1,
    skipped: 1,
    durationMs: 45000,
    branch: 'feat/login',
    dashboardUrl: 'http://dashboard.local/runs/run-123',
    ...overrides,
  };
}

const smtp: SmtpConfig = {
  host: 'smtp.mail.test',
  port: 465,
  secure: true,
  user: 'robot@mail.test',
  pass: 'secret',
};

describe('sendRunReportEmail', () => {
  beforeEach(() => {
    createTransportMock.mockClear();
    sendMailMock.mockReset();
    closeMock.mockReset();
    sendMailMock.mockResolvedValue({ messageId: 'test-id' });
  });

  it('creates transport with SMTP config and sends HTML email', async () => {
    const run = createRunSummary();

    await sendRunReportEmail(smtp, ['a@test.dev', 'b@test.dev'], run);

    expect(createTransportMock).toHaveBeenCalledWith({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const message = sendMailMock.mock.calls[0][0] as {
      from: string;
      to: string;
      subject: string;
      html: string;
    };

    expect(message.from).toBe('robot@mail.test');
    expect(message.to).toBe('a@test.dev, b@test.dev');
    expect(message.subject).toBe('❌ Test Run FAILED — 90/100 passed');
    expect(message.html).toContain('90.0%');
    expect(message.html).toContain('45s');
    expect(message.html).toContain('>90<');
    expect(message.html).toContain('>8<');
    expect(message.html).toContain('>1<');
    expect(message.html).toContain('View in Dashboard');
    expect(message.html).toContain('href="http://dashboard.local/runs/run-123"');
    expect(message.html).toContain('background:#ef4444');
  });

  it('omits dashboard button when dashboardUrl is absent', async () => {
    await sendRunReportEmail(smtp, ['solo@test.dev'], createRunSummary({ dashboardUrl: undefined }));

    const message = sendMailMock.mock.calls[0][0] as { html: string };
    expect(message.html).not.toContain('View in Dashboard');
  });

  it.each([
    ['passed', '#22c55e', '✅ Test Run PASSED — 90/100 passed'],
    ['failed', '#ef4444', '❌ Test Run FAILED — 90/100 passed'],
    ['running', '#f59e0b', '⚠️ Test Run RUNNING — 90/100 passed'],
  ])('uses expected status color and subject for %s', async (status, color, subject) => {
    await sendRunReportEmail(smtp, ['status@test.dev'], createRunSummary({ status }));

    const message = sendMailMock.mock.calls[0][0] as { subject: string; html: string };
    expect(message.subject).toBe(subject);
    expect(message.html).toContain(`background:${color}`);
  });

  it('closes transport in finally when sendMail throws', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('smtp failure'));

    await expect(sendRunReportEmail(smtp, ['a@test.dev'], createRunSummary())).rejects.toThrow('smtp failure');
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('uses N/A duration when durationMs is missing', async () => {
    await sendRunReportEmail(smtp, ['a@test.dev'], createRunSummary({ durationMs: undefined }));

    const message = sendMailMock.mock.calls[0][0] as { html: string };
    expect(message.html).toContain('>N/A<');
  });

  it('shows 0% pass rate when total is zero', async () => {
    await sendRunReportEmail(smtp, ['a@test.dev'], createRunSummary({ total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 }));

    const message = sendMailMock.mock.calls[0][0] as { html: string };
    // When total is 0, passRate falls back to '0' (not '0.0%')
    expect(message.html).toContain('>0%<');
  });

  it('closes transport in finally even when sendMail succeeds', async () => {
    await sendRunReportEmail(smtp, ['a@test.dev'], createRunSummary());

    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('sends to multiple recipients as comma-separated string', async () => {
    await sendRunReportEmail(smtp, ['one@test.dev', 'two@test.dev', 'three@test.dev'], createRunSummary());

    const message = sendMailMock.mock.calls[0][0] as { to: string };
    expect(message.to).toBe('one@test.dev, two@test.dev, three@test.dev');
  });

  it('omits branch from run header when branch is not provided', async () => {
    await sendRunReportEmail(smtp, ['a@test.dev'], createRunSummary({ branch: undefined }));

    const message = sendMailMock.mock.calls[0][0] as { html: string };
    // When branch is undefined, the template should not append ' · branch'
    expect(message.html).not.toMatch(/Run [a-f0-9]+ · /);
  });
});
