import { BasicRecord, BasicStorage } from "../records";
import { MiscRecordId } from "../agent.types";
import { OperationPendingRecord } from "../records/operationPendingRecord";
import { OperationFailedData } from "../records/notificationRecord.types";

export class OperationFailureQueue {
  private readonly FAILED_OPERATIONS_KEY = MiscRecordId.FAILED_OPERATIONS;
  private readonly MAX_RETRIES = 5;
  private readonly BACKOFF_DELAYS = [1000, 5000, 15000, 45000, 90000];

  constructor(private readonly basicStorage: BasicStorage) { }

  async add(
    operation: OperationPendingRecord,
    error: Error
  ): Promise<void> {
    const failedOperationsRecord = await this.basicStorage.findById(
      this.FAILED_OPERATIONS_KEY
    );

    const failedData: OperationFailedData = {
      attempts: 1,
      lastAttempt: Date.now(),
      operation,
      error: error.message,
    };

    const content = {
      ...(failedOperationsRecord?.content || {}),
      [operation.id]: failedData,
    };

    await this.basicStorage.createOrUpdateBasicRecord(
      new BasicRecord({
        id: this.FAILED_OPERATIONS_KEY,
        content,
      })
    );

    console.error(
      `Operation failed and added to queue. ID: ${operation.id}, Type: ${operation.recordType}, Error: ${error.message}`
    );
  }

  async processQueue(
    processor: (op: OperationPendingRecord) => Promise<void>
  ): Promise<void> {
    const failedOperationsRecord = await this.basicStorage.findById(this.FAILED_OPERATIONS_KEY);
    if (!failedOperationsRecord || !failedOperationsRecord.content) return;

    const failedOperations = failedOperationsRecord.content as Record<string, OperationFailedData>;
    const now = Date.now();
    const updatedContent = { ...failedOperations };
    let hasChanges = false;

    for (const [operationId, data] of Object.entries(failedOperations)) {
      const delay = this.getBackoffDelay(data.attempts);
      if (now - data.lastAttempt >= delay) {
        try {
          await processor(data.operation);

          delete updatedContent[operationId];
          hasChanges = true;
        } catch (error) {
          if (data.attempts + 1 >= this.MAX_RETRIES) {
            delete updatedContent[operationId];
          } else {
            updatedContent[operationId] = {
              ...data,
              attempts: data.attempts + 1,
              lastAttempt: now,
              error: (error as Error).message,
            };
          }
          hasChanges = true;
        }
      }
    }

    if (hasChanges) {
      await this.basicStorage.createOrUpdateBasicRecord(
        new BasicRecord({
          id: this.FAILED_OPERATIONS_KEY,
          content: updatedContent,
        })
      );
    }
  }

  public async isInFailureQueue(operationId: string): Promise<boolean> {
    const failedOperationsRecord = await this.basicStorage.findById(this.FAILED_OPERATIONS_KEY);
    if (!failedOperationsRecord || !failedOperationsRecord.content) return false;

    const failedOperations = failedOperationsRecord.content;
    return Object.keys(failedOperations).includes(operationId);
  }

  private getBackoffDelay(attempts: number): number {
    const index = Math.min(attempts - 1, this.BACKOFF_DELAYS.length - 1);
    return index >= 0 ? this.BACKOFF_DELAYS[index] : 0;
  }
}