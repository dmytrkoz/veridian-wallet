import { OperationPendingRecord } from "../records/operationPendingRecord";
import { OperationPendingStorage } from "../records";

export class OperationRetryManager {
  private readonly BACKOFF_DELAYS = [
    1000, 2500, 5000, 10000, 30000, 60000, 300000, 900000,
  ];

  private readonly operationPendingStorage: OperationPendingStorage;

  constructor(operationPendingStorage: OperationPendingStorage) {
    this.operationPendingStorage = operationPendingStorage;
  }

  public async scheduleRetry(
    operation: OperationPendingRecord,
    error: Error
  ): Promise<void> {
    const currentAttempts = operation.retryData?.attempts ?? 0;

    operation.retryData = {
      attempts: currentAttempts + 1,
      lastAttempt: Date.now(),
      lastError: error.message,
    };

    await this.operationPendingStorage.update(operation);

    /* eslint-disable no-console */
    console.warn(
      `Operation scheduled for retry. ID: ${operation.id}, Type: ${operation.recordType}, Attempts: ${operation.retryData.attempts}, Error: ${error.message}`
    );
  }

  public getBackoffDelay(attempts: number): number {
    if (attempts <= 0) attempts = 1;
    const index = Math.min(attempts - 1, this.BACKOFF_DELAYS.length - 1);
    return this.BACKOFF_DELAYS[index];
  }
}
