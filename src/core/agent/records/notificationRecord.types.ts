import { Notification } from "../services/keriaNotificationService.types";
import { OperationPendingRecord } from "./operationPendingRecord";

interface LinkedRequest {
  accepted: boolean;
  current?: string;
  previous?: string;
}

interface NotificationAttempts {
  attempts: number;
  lastAttempt: number;
  notification: Notification;
}

interface OperationFailedData {
  attempts: number;
  lastAttempt: number;
  operation: OperationPendingRecord;
  error: string;
}

export type { LinkedRequest, NotificationAttempts, OperationFailedData };
