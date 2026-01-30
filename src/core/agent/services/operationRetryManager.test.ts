import { OperationRetryManager } from "./operationRetryManager";

const now = new Date("2026-01-01T00:00:00Z");
jest.useFakeTimers();
jest.setSystemTime(now.getTime());

const OperationPendingStorageMock = {
  update: jest.fn(),
  findAllByQuery: jest.fn(),
  deleteById: jest.fn(),
};

const createMockOperation = (
  id: string,
  attempts = 0,
  lastAttempt?: number
) => {
  return {
    id,
    recordType: "testType",
    retryData: attempts
      ? {
          attempts,
          lastAttempt: lastAttempt ?? now.getTime() - 60000,
          lastError: "Some error",
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

describe("OperationRetryManager", () => {
  describe("scheduleRetry", () => {
    test("should update operation with incremented attempts and log warning", async () => {
      const mockOperation = createMockOperation("op-1", 2);
      const error = new Error("Test error");

      await operationRetryManager.scheduleRetry(mockOperation, error);

      expect(OperationPendingStorageMock.update).toHaveBeenCalledWith({
        ...mockOperation,
        retryData: {
          attempts: 3,
          lastAttempt: now.getTime(),
          lastError: "Test error",
        },
      });
    });
  });

  describe("getBackoffDelay", () => {
    test("should return correct backoff delay", () => {
      let backoffDelay;

      backoffDelay = (operationRetryManager as any).getBackoffDelay(0);
      expect(backoffDelay).toBe(1000);

      backoffDelay = (operationRetryManager as any).getBackoffDelay(1);
      expect(backoffDelay).toBe(1000);

      backoffDelay = (operationRetryManager as any).getBackoffDelay(2);
      expect(backoffDelay).toBe(2500);

      backoffDelay = (operationRetryManager as any).getBackoffDelay(3);
      expect(backoffDelay).toBe(5000);

      backoffDelay = (operationRetryManager as any).getBackoffDelay(4);
      expect(backoffDelay).toBe(10000);

      backoffDelay = (operationRetryManager as any).getBackoffDelay(5);
      expect(backoffDelay).toBe(30000);

      backoffDelay = (operationRetryManager as any).getBackoffDelay(6);
      expect(backoffDelay).toBe(60000);

      backoffDelay = (operationRetryManager as any).getBackoffDelay(7);
      expect(backoffDelay).toBe(300000);

      backoffDelay = (operationRetryManager as any).getBackoffDelay(8);
      expect(backoffDelay).toBe(900000);

      backoffDelay = (operationRetryManager as any).getBackoffDelay(9);
      expect(backoffDelay).toBe(900000);
    });
  });
});
