import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand } from '@aws-sdk/client-sqs';
import type { Delivery, Envelope, Transport, WorkClass } from './dispatch.js';
export function parseEnvelope(body: string): Envelope {
  const value = JSON.parse(body);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'class,jobId,version'
    || typeof value.jobId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.jobId)
    || !Number.isSafeInteger(value.version) || value.version < 1 || !['emergency', 'ordinary'].includes(value.class)) throw new Error('Invalid queue envelope');
  return { jobId: value.jobId.toLowerCase(), version: value.version, class: value.class };
}
export function createSqsTransport(region: string, queues: Record<WorkClass, string>, client = new SQSClient({ region, maxAttempts: 3,
  requestHandler: { connectionTimeout: 3000, requestTimeout: 25000 } })): Transport & { close(): void } {
  if (!region || Object.values(queues).some(url => !url.startsWith('https://'))) throw new Error('AWS region and HTTPS SQS URLs required');
  return {
    async publish(body, signal) {
      const message = parseEnvelope(JSON.stringify(body));
      await client.send(new SendMessageCommand({ QueueUrl: queues[message.class], MessageBody: JSON.stringify(message) }), { abortSignal: signal });
    },
    async receive(kind, signal) {
      const result = await client.send(new ReceiveMessageCommand({ QueueUrl: queues[kind], WaitTimeSeconds: 20, MaxNumberOfMessages: 10, VisibilityTimeout: 30 }), { abortSignal: signal });
      const deliveries: Delivery[] = [];
      for (const message of result.Messages ?? []) {
        if (!message.ReceiptHandle) continue;
        try {
          const body = parseEnvelope(message.Body ?? '');
          if (body.class !== kind) throw new Error('Wrong queue class');
          deliveries.push({ body, receipt: message.ReceiptHandle });
        } catch {
          // Invalid transport cannot grant authority; SQL scanner independently preserves valid work.
          await client.send(new DeleteMessageCommand({ QueueUrl: queues[kind], ReceiptHandle: message.ReceiptHandle }), { abortSignal: signal });
        }
      }
      return deliveries;
    },
    async ack(kind, receipt, signal) { await client.send(new DeleteMessageCommand({ QueueUrl: queues[kind], ReceiptHandle: receipt }), { abortSignal: signal }); },
    async defer(kind, receipt, signal) {
      // Keep saturated channels out of the immediate receive cycle; no attempt is authorized here.
      await client.send(new ChangeMessageVisibilityCommand({ QueueUrl: queues[kind], ReceiptHandle: receipt, VisibilityTimeout: 30 }), { abortSignal: signal });
    },
    close() { client.destroy(); }
  };
}
