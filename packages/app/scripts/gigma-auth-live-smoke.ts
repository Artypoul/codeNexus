import { GigmaAuthClient } from "../src/main/services/GigmaAuthClient";

async function main(): Promise<void> {
  const client = new GigmaAuthClient();
  const before = await client.status();
  const started = await client.startLogin();
  const polled = await client.pollLogin();
  const cancelled = started.flowId ? await client.cancelLogin(started.flowId) : null;
  process.stdout.write(
    `${JSON.stringify({
      before: { available: before.available, configured: before.configured, loggedIn: before.loggedIn },
      started: {
        flowIdPresent: Boolean(started.flowId),
        status: started.status,
        hasAuthorizationUrl: Boolean(started.authorizationUrl),
        hasVerificationUri: Boolean(started.verificationUri),
      },
      polled: polled ? { status: polled.status, flowIdPresent: Boolean(polled.flowId) } : null,
      cancelled,
    })}\n`
  );
}

void main();
