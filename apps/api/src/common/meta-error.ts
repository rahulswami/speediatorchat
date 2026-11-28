import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { WhatsAppApiError, describeMetaError } from '@speediator/whatsapp';

/** Turns a Meta API failure into a response the dashboard can show as-is. */
export function rethrowMetaError(prefix: string) {
  return (err: unknown): never => {
    if (err instanceof WhatsAppApiError) {
      const reason = describeMetaError(err);
      throw err.status >= 500
        ? new BadGatewayException(`WhatsApp is unavailable: ${reason}`)
        : new BadRequestException(`${prefix}: ${reason}`);
    }
    throw err;
  };
}
