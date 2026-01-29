import { OperationRetryManager } from './operationRetryManager';

const now = new Date('2026-01-01T00:00:00Z');
jest.useFakeTimers();
jest.setSystemTime(now.getTime());

const OperationPendingStorageMock = {
  update: jest.fn(),
  findAllByQuery: jest.fn(),
  deleteById: jest.fn(),
};

const createMockOperation = (id: string, attempts = 0, lastAttempt?: number) => {
  return {
    id,
    recordType: 'testType',
    retryData: attempts
      ? {
        attempts,
        lastAttempt: lastAttempt ?? now.getTime() - 60000,
        lastError: 'Some error',
      }
      : undefined,
  } as any;
};

const operationRetryManager = new OperationRetryManager(
  OperationPendingStorageMock as any
);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('OperationRetryManager', () => {
  describe('scheduleRetry', () => {
    test('should update operation with incremented attempts and log warning', async () => {
      const mockOperation = createMockOperation('op-1', 2);
      const error = new Error('Test error');

      await operationRetryManager.scheduleRetry(mockOperation, error);

      expect(OperationPendingStorageMock.update).toHaveBeenCalledWith({
        ...mockOperation,
        retryData: {
          attempts: 3,
          lastAttempt: now.getTime(),
          lastError: 'Test error',
        },
      });
    });
  });

  describe('getOperationsToRetry', () => {
    test('should return operations that are due for retry', async () => {
      const op1 = createMockOperation('op-1', 1);
      const op2 = createMockOperation('op-2', 2);
      const op3 = createMockOperation('op-3', 3);
      const op4 = createMockOperation('op-4', 4);
      const op5 = createMockOperation('op-5', 5);

      OperationPendingStorageMock.findAllByQuery.mockResolvedValue([
        op1,
        op2,
        op3,
        op4,
        op5,
      ]);

      const result = await operationRetryManager.getOperationsToRetry();

      expect(result).toEqual([op1, op2, op3, op4]);
    });

    test('should not return operations that are not due for retry', async () => {
      const op2 = createMockOperation('op-2', 2, now.getTime() - 1000);
      const op3 = createMockOperation('op-3', 3, now.getTime() - 10000);
      const op4 = createMockOperation('op-4', 4, now.getTime() - 40000);
      const op5 = createMockOperation('op-5', 5, now.getTime() - 50000);

      OperationPendingStorageMock.findAllByQuery.mockResolvedValue([
        op2,
        op3,
        op4,
        op5,
      ]);

      const result = await operationRetryManager.getOperationsToRetry();

      expect(result).toEqual([]);
    });
  });

  describe('remove', () => {
    test('should delete operation by ID', async () => {
      const operationId = 'op.to-remove';

      await operationRetryManager.remove(operationId);

      expect(OperationPendingStorageMock.deleteById).toHaveBeenCalledWith(
        operationId
      );
    });
  });

  describe('Private - getBackoffDelay', () => {
    test('should return correct backoff delay', () => {
      let backoffDelay;

      backoffDelay = (operationRetryManager as any).getBackoffDelay(0);
      expect(backoffDelay).toBe(1000);

      backoffDelay = (operationRetryManager as any).getBackoffDelay(1);
      expect(backoffDelay).toBe(1000);

      backoffDelay = (operationRetryManager as any).getBackoffDelay(2);
      expect(backoffDelay).toBe(5000);

      backoffDelay = (operationRetryManager as any).getBackoffDelay(3);
      expect(backoffDelay).toBe(15000);

      backoffDelay = (operationRetryManager as any).getBackoffDelay(4);
      expect(backoffDelay).toBe(45000);

      backoffDelay = (operationRetryManager as any).getBackoffDelay(5);
      expect(backoffDelay).toBe(90000);

      backoffDelay = (operationRetryManager as any).getBackoffDelay(6);
      expect(backoffDelay).toBe(90000);
    });
  });
});