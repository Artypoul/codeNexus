import { GigmaAuthClient } from "../src/main/services/GigmaAuthClient";

async function main(): Promise<void> {
  const status = await new GigmaAuthClient().status();
  process.stdout.write(
    `${JSON.stringify({
      available: status.available,
      configured: status.configured,
      loggedIn: status.loggedIn,
      provider: status.provider,
      error: status.error,
    })}\n`
  );
}

void main();
