import { OperationPendingRecord } from '../records/operationPendingRecord';
import { OperationPendingStorage } from '../records';

export class OperationRetryManager {
  private readonly BACKOFF_DELAYS = [1000, 5000, 15000, 45000, 90000];

  private readonly operationPendingStorage: OperationPendingStorage

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

  public async getOperationsToRetry(): Promise<OperationPendingRecord[]> {
    const now = Date.now();

    const potentiallyRetryableOperations = await this.operationPendingStorage.findAllByQuery({
      $not: {
        retryLastAttempt: undefined,
      },
    });

    return potentiallyRetryableOperations.filter((operation) => {
      const { attempts, lastAttempt } = operation.retryData!;
      const delay = this.getBackoffDelay(attempts);
      return now - lastAttempt >= delay;
    });
  }

  public async remove(operationId: string): Promise<void> {
    await this.operationPendingStorage.deleteById(operationId);
  }

  private getBackoffDelay(attempts: number): number {
    const index = Math.min(attempts - 1, this.BACKOFF_DELAYS.length - 1);
    return this.BACKOFF_DELAYS[index];
  }
}
