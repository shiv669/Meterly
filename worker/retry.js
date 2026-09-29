function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withRetry(operation, {
  maxAttempts = 3,
  baseDelayMilliseconds = 1000,
  onRetry = () => {}
} = {}) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        break;
      }

      const waitMilliseconds = baseDelayMilliseconds * (2 ** (attempt - 1));
      onRetry({ attempt, waitMilliseconds, error });
      await delay(waitMilliseconds);
    }
  }

  throw lastError;
}

module.exports = { withRetry };
